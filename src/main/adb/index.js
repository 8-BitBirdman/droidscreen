import adb from 'adbkit'
const { execFile } = require('child_process')
const fixPath = require('fix-path')
fixPath()
const client = adb.createClient()
const debug = require('debug')('scrcpy')

let _tracker = null
const onDevices = sender => {
	if (_tracker) {
		// already tracking; just rebind sender
		_tracker._sender = sender
		return
	}
	client.trackDevices()
		.then(function (tracker) {
			_tracker = tracker
			_tracker._sender = sender
			tracker.on('add', function (device) {
				debug('Device %s was plugged in', device.id)
				client.listDevices().then(function (devices) {
					debug(devices)
					_tracker._sender.send('devices', devices)
				})
			})
			tracker.on('remove', function (device) {
				debug('Device %s was unplugged', device.id)
				client.listDevices().then(function (devices) {
					debug(devices)
					_tracker._sender.send('devices', devices)
				})
			})
			tracker.on('end', function () {
				debug('Tracking stopped')
				_tracker = null
			})
		})
		.catch(function (err) {
			debug('Something went wrong:', err.stack)
		})
}
const connect = ({ sender }, args) => {
	const { id, ip } = args
	const success = 'Successfully opened wireless connection'
	const fail = 'Failed to open wireless connection'
	const tryConnect = (host, port) => {
		const p = port ? client.connect(host, port) : client.connect(host)
		return p.then(() => {
			sender.send('connect', { success: true, message: success })
		}).catch(() => {
			sender.send('connect', { success: false, message: fail })
		})
	}
	if (id) {
		client.tcpip(id)
			.then(port => tryConnect(ip, port))
			.catch(() => tryConnect(ip))
	} else {
		tryConnect(ip)
	}
}

const disconnect = ({ sender }, ip) => {
	client.disconnect(ip).then(id => {
		debug(id)
		sender.send('disconnect', { success: true, message: 'Device shutdown succeeded' })
	}).catch(err => {
		debug(err)
		sender.send('disconnect', { success: false, message: 'Device shutdown failed' })
	})
}

const mdnsDiscover = ({ sender }) => {
	execFile('adb', ['mdns', 'services'], (err, stdout) => {
		if (err) {
			sender.send('mdns', { success: false, devices: [] })
			return
		}
		const lines = stdout.split('\n').filter(l => l.includes('_adb-tls-'))
		const map = {}
		lines.forEach(line => {
			const parts = line.trim().split(/\s+/)
			if (parts.length < 3) return
			const instanceName = parts[0]
			const serviceType = parts[1]
			const addr = parts[parts.length - 1]
			// Serial is embedded in instance name: adb-<serial>-<suffix>
			const match = instanceName.match(/^adb-(.+)-[^-]+$/)
			const serial = match ? match[1] : instanceName
			if (!map[serial]) map[serial] = { serial, name: `Phone (${serial.slice(0, 8)}...)` }
			if (serviceType.includes('pairing')) {
				map[serial].pairAddr = addr
			} else if (serviceType.includes('connect')) {
				map[serial].connectAddr = addr
			}
		})
		sender.send('mdns', { success: true, devices: Object.values(map) })
	})
}

// Validate IP:port format to prevent shell-arg abuse
const ADDR_RE = /^[0-9a-fA-F.:[\]]+:\d{1,5}$/
const CODE_RE = /^\d{6}$/

const pairDevice = ({ sender }, { addr, code }) => {
	if (!ADDR_RE.test(addr) || !CODE_RE.test(code)) {
		sender.send('pair', { success: false })
		return
	}
	execFile('adb', ['pair', addr, code], (err, stdout, stderr) => {
		const output = (stdout + stderr).toLowerCase()
		if (err || output.includes('failed') || output.includes('error')) {
			sender.send('pair', { success: false })
			return
		}
		sender.send('pair', { success: true })
	})
}

const connectDirect = ({ sender }, { addr }) => {
	if (!ADDR_RE.test(addr)) {
		sender.send('connectDirect', { success: false })
		return
	}
	execFile('adb', ['connect', addr], (err, stdout, stderr) => {
		const output = (stdout + stderr).toLowerCase()
		if (err || output.includes('failed') || output.includes('error') || output.includes('unable')) {
			sender.send('connectDirect', { success: false })
			return
		}
		sender.send('connectDirect', { success: true })
	})
}

// QR pairing: watch mDNS via dns-sd (macOS Bonjour) for our service name, then pair.
// `adb mdns services` is broken on recent macOS, so we use the OS-native discovery directly.
const { spawn } = require('child_process')
let _qrBrowser = null
let _qrTimer = null
let _qrAbort = { v: false }
const QR_TIMEOUT_MS = 120000
const SERVICE_RE = /^[A-Za-z0-9_-]{1,32}$/

const safeSend = (sender, channel, payload) => {
	try {
		if (sender && !sender.isDestroyed()) sender.send(channel, payload)
	} catch (_) { /* sender gone */ }
}

// Resolve "Android_XYZ.local." → IPv4 via dns-sd -G
const resolveHost = (hostname) => new Promise((resolve) => {
	const proc = spawn('dns-sd', ['-G', 'v4', hostname])
	let done = false
	const finish = (ip) => {
		if (done) return
		done = true
		try { proc.kill('SIGTERM') } catch (_) {}
		resolve(ip)
	}
	proc.stdout.on('data', (buf) => {
		const m = buf.toString().match(/\s(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\s/)
		if (m) finish(m[1])
	})
	proc.on('error', () => finish(null))
	setTimeout(() => finish(null), 4000)
})

// Resolve instance → hostname:port via dns-sd -L
const resolveService = (instance) => new Promise((resolve) => {
	const proc = spawn('dns-sd', ['-L', instance, '_adb-tls-pairing._tcp', 'local.'])
	let done = false
	const finish = (hp) => {
		if (done) return
		done = true
		try { proc.kill('SIGTERM') } catch (_) {}
		resolve(hp)
	}
	proc.stdout.on('data', (buf) => {
		const m = buf.toString().match(/can be reached at\s+(\S+):(\d{1,5})/)
		if (m) finish({ host: m[1].replace(/\.$/, ''), port: m[2] })
	})
	proc.on('error', () => finish(null))
	setTimeout(() => finish(null), 4000)
})

const qrPairStart = ({ sender }, { service, password }) => {
	if (!SERVICE_RE.test(service) || typeof password !== 'string' || password.length < 6 || password.length > 32) {
		safeSend(sender, 'qrPair', { success: false, message: 'Invalid service/password' })
		return
	}
	qrPairStop()
	const abort = { v: false }
	_qrAbort = abort
	let pairing = false
	const seen = new Set()

	const tryPair = async (instance) => {
		if (abort.v || pairing) return
		if (!instance.includes(service)) return
		if (seen.has(instance)) return
		seen.add(instance)
		pairing = true
		debug('QR: matched instance %s, resolving', instance)
		const svc = await resolveService(instance)
		if (abort.v) { pairing = false; return }
		if (!svc) { pairing = false; return }
		const ip = await resolveHost(svc.host)
		if (abort.v) { pairing = false; return }
		if (!ip) { pairing = false; return }
		const addr = `${ip}:${svc.port}`
		debug('QR: pairing to %s', addr)
		qrPairStop()
		execFile('adb', ['pair', addr, password], (e, so, se) => {
			pairing = false
			if (abort.v) return
			const out = (so + se).toLowerCase()
			const ok = !e && !out.includes('failed') && !out.includes('error')
			safeSend(sender, 'qrPair', { success: ok, message: ok ? 'Paired' : 'Pair failed' })
		})
	}

	_qrBrowser = spawn('dns-sd', ['-B', '_adb-tls-pairing._tcp', 'local.'])
	_qrBrowser.stdout.on('data', (buf) => {
		if (abort.v) return
		const text = buf.toString()
		// Each "Add" line ends with the instance name
		text.split('\n').forEach(line => {
			const m = line.match(/\bAdd\b.*?\s(\S+)\s*$/)
			if (m) tryPair(m[1].trim())
		})
	})
	_qrBrowser.on('error', (err) => {
		debug('QR: dns-sd error %s', err.message)
		qrPairStop()
		safeSend(sender, 'qrPair', { success: false, message: 'mDNS discovery failed (is dns-sd available?)' })
	})

	_qrTimer = setTimeout(() => {
		if (abort.v || pairing) return
		qrPairStop()
		safeSend(sender, 'qrPair', { success: false, message: 'Timeout: no device scanned the QR code' })
	}, QR_TIMEOUT_MS)
}

const qrPairStop = () => {
	if (_qrAbort) _qrAbort.v = true
	if (_qrTimer) { clearTimeout(_qrTimer); _qrTimer = null }
	if (_qrBrowser) {
		try { _qrBrowser.kill('SIGTERM') } catch (_) {}
		_qrBrowser = null
	}
}

export default {
	connect, disconnect, onDevices, mdnsDiscover, pairDevice, connectDirect, qrPairStart, qrPairStop
}
