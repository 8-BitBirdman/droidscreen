<template>
	<el-card>

		<!-- ───────────────── QUICK CONNECT ───────────────── -->
		<div class="quick-connect">
			<div class="qc-header">
				<span class="qc-title">⚡ {{ $t('quickConnect.title') }}</span>
				<span class="qc-subtitle">{{ $t('quickConnect.subtitle') }}</span>
			</div>

			<div class="qc-btn-row">
				<el-button
					:loading="scanning"
					@click="scanDevices"
					size="small"
					round
				>
					{{ scanning ? $t('quickConnect.scanning') : $t('quickConnect.scan') }}
				</el-button>

				<el-button
					@click="openQrDialog"
					size="small"
					round
				>
					{{ $t('quickConnect.qrButton') }}
				</el-button>

				<el-button
					@click="openManualPairDialog"
					size="small"
					round
				>
					{{ $t('quickConnect.manualPairButton') }}
				</el-button>
			</div>

			<div v-if="scanned && mdnsDevices.length === 0" class="qc-empty">
				{{ $t('quickConnect.noDevices') }}
			</div>

			<div v-if="mdnsDevices.length > 0" class="qc-device-list">
				<div
					v-for="device in mdnsDevices"
					:key="device.serial"
					class="qc-device-row"
				>
					<div class="qc-device-info">
						<span class="qc-device-icon">📱</span>
						<div>
							<span class="qc-device-name">{{ device.name }}</span>
							<span class="qc-device-addr" v-if="device.connectAddr">{{ device.connectAddr }}</span>
						</div>
					</div>
					<div class="qc-device-actions">
						<el-button
							v-if="device.pairAddr"
							size="mini"
							type="warning"
							plain
							@click="openPairDialog(device)"
						>{{ pairedSerials.includes(device.serial) ? $t('quickConnect.paired') : $t('quickConnect.pair') }}</el-button>
						<el-button
							v-if="device.connectAddr"
							size="mini"
							type="success"
							plain
							:loading="connectingSerial === device.serial"
							@click="quickConnectDevice(device)"
						>{{ $t('quickConnect.connect') }}</el-button>
					</div>
				</div>
			</div>
		</div>

		<!-- ───────────────── PAIR DIALOG ───────────────── -->
		<el-dialog
			:title="$t('quickConnect.pairDialog.title')"
			:visible.sync="pairDialogVisible"
			width="360px"
			class="pair-dialog"
			:append-to-body="true"
		>
			<p class="pair-hint">{{ $t('quickConnect.pairDialog.hint') }}</p>
			<el-input
				v-model="pairingCode"
				:placeholder="$t('quickConnect.pairDialog.placeholder')"
				maxlength="6"
				size="medium"
				autofocus
				@keyup.enter.native="submitPair"
			/>
			<span slot="footer">
				<el-button @click="pairDialogVisible = false">{{ $t('quickConnect.pairDialog.cancel') }}</el-button>
				<el-button
					type="primary"
					:loading="pairing"
					:disabled="pairingCode.length < 6"
					@click="submitPair"
				>{{ $t('quickConnect.pairDialog.confirm') }}</el-button>
			</span>
		</el-dialog>

		<!-- ───────────────── QR PAIR DIALOG ───────────────── -->
		<el-dialog
			:title="$t('quickConnect.qrDialog.title')"
			:visible.sync="qrDialogVisible"
			width="380px"
			class="pair-dialog"
			:append-to-body="true"
			@close="closeQrDialog"
		>
			<p class="pair-hint">{{ $t('quickConnect.qrDialog.hint') }}</p>
			<div class="qr-wrap">
				<canvas ref="qrCanvas"></canvas>
			</div>
			<p v-if="qrWaiting" class="qr-status">
				<i class="el-icon-loading"></i> {{ $t('quickConnect.qrDialog.waiting') }}
			</p>
			<span slot="footer">
				<el-button @click="qrDialogVisible = false">{{ $t('quickConnect.pairDialog.cancel') }}</el-button>
			</span>
		</el-dialog>

		<!-- ───────────────── MANUAL PAIR DIALOG (IP:port + code) ───────────────── -->
		<el-dialog
			:title="$t('quickConnect.manualPairDialog.title')"
			:visible.sync="manualPairDialogVisible"
			width="380px"
			class="pair-dialog"
			:append-to-body="true"
		>
			<p class="pair-hint">{{ $t('quickConnect.manualPairDialog.hint') }}</p>
			<el-input
				v-model="manualPairAddr"
				:placeholder="$t('quickConnect.manualPairDialog.addrPlaceholder')"
				size="medium"
				autofocus
				style="margin-bottom: 10px"
			/>
			<el-input
				v-model="manualPairCode"
				:placeholder="$t('quickConnect.manualPairDialog.codePlaceholder')"
				maxlength="6"
				size="medium"
				@keyup.enter.native="submitManualPair"
			/>
			<span slot="footer">
				<el-button @click="manualPairDialogVisible = false">{{ $t('quickConnect.pairDialog.cancel') }}</el-button>
				<el-button
					type="primary"
					:loading="manualPairing"
					:disabled="!manualPairAddr || manualPairCode.length < 6"
					@click="submitManualPair"
				>{{ $t('quickConnect.pairDialog.confirm') }}</el-button>
			</span>
		</el-dialog>

		<!-- ───────────────── DEVICE LIST ───────────────── -->
		<el-divider><i class="el-icon-mobile-phone"></i></el-divider>
		<div v-if="currentDevices.length > 0">
			<el-table
				:data="currentDevices"
				@selection-change="selectionChange"
				tooltip-effect="dark"
				style="width:100%"
				stripe
				border
			>
				<el-table-column type="selection" width="40"></el-table-column>
				<el-table-column label="ID" prop="id"
					><template slot-scope="scope">
						<el-tag size="medium" type="warning">{{
							scope.row.id
						}}</el-tag></template
					></el-table-column
				>
				<el-table-column :label="$t('management.devices.name')">
					<editable-cell
						prop="name"
						slot-scope="{ row }"
						:can-edit="editModeEnabled"
						v-model="row.name"
						:toolTipContent="$t('management.devices.edit')"
						@input="newName => rename(row, newName)"
					>
						<span slot="content">{{ row.name }}</span>
					</editable-cell>
				</el-table-column>
				<el-table-column
					prop="method"
					:label="$t('management.devices.method.label')"
					width="90"
					:filters="[
						{
							text: $t('management.devices.method.wired'),
							value: $t('management.devices.method.wired')
						},
						{
							text: $t('management.devices.method.wireless'),
							value: $t('management.devices.method.wireless')
						}
					]"
					:filter-method="filterTag"
					filter-placement="bottom-end"
				>
					<template slot-scope="scope">
						<el-tag
							:type="
								scope.row.method === $t('management.devices.method.wired')
									? 'primary'
									: 'success'
							"
							>{{ scope.row.method }}</el-tag
						>
					</template>
				</el-table-column>

				<el-table-column
					fixed="right"
					:label="$t('management.devices.operation')"
					width="85"
				>
					<template slot-scope="scope">
						<el-button
							@click.native.prevent="disconnect(scope.$index, scope.row.id)"
							type="text"
							size="small"
							:disabled="
								scope.row.method === $t('management.devices.method.wired')
							"
						>
							{{ $t("management.devices.disconnect") }}
						</el-button>
					</template>
				</el-table-column>
			</el-table>
			<div class="wrap-button">
				<el-button
					type="primary"
					@click.native.prevent="open(selectedDevices)"
					:disabled="selectedDevices.length === 0"
					plain
					v-waves
				>
					{{ $t("management.button.open") }}
				</el-button>
			</div>
		</div>
		<div class="when-empty" v-else>
			<span> {{ $t("management.whenEmpty") }} </span>
		</div>

		<!-- ───────────────── MANUAL IP (collapsed) ───────────────── -->
		<el-divider content-position="right">
			<el-button type="text" size="mini" @click="showManual = !showManual">
				{{ showManual ? $t('quickConnect.hideManual') : $t('quickConnect.showManual') }}
			</el-button>
		</el-divider>
		<div v-if="showManual" class="wrap-form">
			<el-autocomplete
				v-model="ip"
				:fetch-suggestions="getWirelessDevices"
				prefix-icon="el-icon-position"
				@select="handleSelect"
			>
				<template slot-scope="{ item }">
					<div class="item-name">
						<span style="color:#999">{{ $t("management.devices.name") }}: </span
						>{{ item.name }}
					</div>
					<span class="item-id">{{ item.id }}</span>
					<el-button
						class="item-remove"
						@click.native.prevent="deleteWirelessDevice(item.id)"
						type="text"
						size="small"
					>
						{{ $t("management.ip.remove") }}
					</el-button>
				</template>
			</el-autocomplete>
			<br /><br />
			<el-button
				type="success"
				@click.native.prevent="connect"
				:disabled="ip === ''"
				plain
				v-waves
				>{{ $t("management.ip.connect") }}</el-button
			>
		</div>
	</el-card>
</template>

<script>
import EditableCell from '../components/EditableCell'
import Regular from '@/utils/regular'
import { ipcRenderer } from 'electron'
import QRCode from 'qrcode'
export default {
	name: 'Devices',
	data() {
		return {
			editModeEnabled: true,
			currentDevices: [],
			selectedDevices: [],
			ip: '192.168.0.',
			wirelessDevices: [],
			deletedEvent: false,
			stoppedNotify: false,
			firstLoad: true,
			wired: '',
			wireless: '',
			showManual: false,
			// Quick Connect
			scanning: false,
			scanned: false,
			mdnsDevices: [],
			pairedSerials: [],
			pairDialogVisible: false,
			pairingCode: '',
			pairing: false,
			pendingPairDevice: null,
			connectingSerial: null,
			// QR pairing
			qrDialogVisible: false,
			qrWaiting: false,
			qrService: '',
			qrPassword: '',
			// Manual pair (IP:port + code)
			manualPairDialogVisible: false,
			manualPairAddr: '',
			manualPairCode: '',
			manualPairing: false
		}
	},
	created() {
		this.wireless = this.$t('management.devices.method.wireless')
		this.wired = this.$t('management.devices.method.wired')
		const { wireless, wired } = this

		this.wirelessDevices = this.$store.get('wirelessDevices') || []
		this.pairedSerials = this.$store.get('pairedSerials') || []

		ipcRenderer.on('devices', (event, _devices) => {
			const preDevicesCount = this.currentDevices.length
			const devices = _devices
				.filter(({ id }, idx) => _devices.findIndex((device) => id === device.id) === idx)
				.map(({ id }) => ({ id, name: this.$store.get(id) || id, method: Regular('ip', id) ? wireless : wired }))

			if(this.$store.get('config') && this.$store.get('config').auto){
				const newDevices = devices.filter(device => !this.currentDevices.some(({id}) => id === device.id))
				this.open(newDevices)
			}
			this.currentDevices = devices
			const preWirelessDevicesCount = this.wirelessDevices.length
			this.currentDevices.forEach(({ id, name, method }) => {
				if (method === wired) {
					return
				}
				if (this.wirelessDevices.every((device) => id !== device.id)) {
					this.wirelessDevices.push({ id, name })
				}
			})
			preWirelessDevicesCount !== this.wirelessDevices.length &&
				this.$store.put('wirelessDevices', this.wirelessDevices)
			if (this.firstLoad) {
				this.firstLoad = false
				this.$notify.success(this.$t('management.notify.firstLoad'), 800)
			} else if (!this.stoppedNotify && preDevicesCount > this.currentDevices.length) {
				this.$notify.info(this.$t('management.notify.reduceDevices'))
			} else if (!this.stoppedNotify && preDevicesCount < this.currentDevices.length) {
				this.$notify.success(this.$t('management.notify.newDevices'))
			}
		})
		const opened = {}
		ipcRenderer.on('open', (_, id) => {
			if (!opened[id]) {
				opened[id] = true
				setTimeout(() => {
					this.$notify.success(this.$t('management.notify.open', { name: this.$store.get(id) || id }))
				}, 500)
				setTimeout(() => {
					opened[id] = false
				}, 1000)
			}
		})

		const closed = {}
		ipcRenderer.on('close', (_, { success, id }) => {
			if (!closed[id]) {
				closed[id] = true
				const result = success ? 'success' : 'error'
				this.$notify[result](this.$t(`management.open.${ result}`, { name: this.$store.get(id) || id }))

				setTimeout(() => {
					closed[id] = false
				}, 1000)
			}
		})

		ipcRenderer.on('error', (_, { type }) => {
			console.log(`management.error.${ type}`)
			this.$notify.error(this.$t(`management.error.${ type}`))
		})

		// Quick Connect IPC listeners
		ipcRenderer.on('mdns', (_, { success, devices }) => {
			this.scanning = false
			this.scanned = true
			this.mdnsDevices = success ? devices : []
		})

		ipcRenderer.on('pair', (_, { success }) => {
			this.pairing = false
			this.manualPairing = false
			if (success) {
				this.$notify.success(this.$t('quickConnect.pairSuccess'))
				if (this.pendingPairDevice) {
					// Save paired serial so UI can reflect it
					if (!this.pairedSerials.includes(this.pendingPairDevice.serial)) {
						this.pairedSerials.push(this.pendingPairDevice.serial)
						this.$store.put('pairedSerials', this.pairedSerials)
					}
					// Auto-connect after pairing
					if (this.pendingPairDevice.connectAddr) {
						this.quickConnectDevice(this.pendingPairDevice)
					}
					this.pendingPairDevice = null
				}
				this.pairDialogVisible = false
				this.pairingCode = ''
				if (this.manualPairDialogVisible) {
					this.manualPairDialogVisible = false
					this.manualPairAddr = ''
					this.manualPairCode = ''
					// Trigger rescan to pick up the new device
					setTimeout(() => this.scanDevices(), 800)
				}
			} else {
				this.$notify.error(this.$t('quickConnect.pairFail'))
			}
		})

		ipcRenderer.on('connectDirect', (_, { success }) => {
			this.connectingSerial = null
			if (success) {
				this.$notify.success(this.$t('quickConnect.connectSuccess'))
			} else {
				this.$notify.error(this.$t('quickConnect.connectFail'))
			}
		})

		ipcRenderer.on('qrPair', (_, { success, message }) => {
			const wasOpen = this.qrDialogVisible
			this.qrWaiting = false
			if (success) {
				this.$notify.success(this.$t('quickConnect.pairSuccess'))
				this.qrDialogVisible = false
				// auto-rescan so device shows up in list
				setTimeout(() => this.scanDevices(), 800)
			} else if (wasOpen) {
				this.$notify.error(message || this.$t('quickConnect.pairFail'))
			}
		})
	},
	beforeDestroy() {
		['devices', 'open', 'close', 'error', 'mdns', 'pair', 'connectDirect', 'qrPair'].forEach(ch => {
			ipcRenderer.removeAllListeners(ch)
		})
		ipcRenderer.send('qrPairStop')
	},
	components: {
		EditableCell
	},
	methods: {
		open(devices) {
			this.$notify.info(this.$t('management.open.loading'), 2000)
			const config = this.$store.get('config')
			ipcRenderer.send('open', { config, devices })
		},
		connect() {
			if (!Regular('ip', this.ip)) {
				this.$notify.error(this.$t('management.connect.error.ip'))
				return
			}
			const device = this.currentDevices.find(({ id }) => id === this.ip || id.split(':')[0] === this.ip)
			if (device) {
				this.$notify.warning(this.$t('management.connect.error.exist', { name: device.name }))
				return
			}

			const wireDevice = this.currentDevices.filter(({ method }) => method === this.wired)[0]

			const openedIP = this.ip
			ipcRenderer.send('connect', { id: wireDevice ? wireDevice.id : null, ip: this.ip })

			this.stoppedNotify = true
			this.$notify.info(this.$t('management.connect.loading'))
			setTimeout(() => {
				if (this.currentDevices.every(({ id }) => id !== openedIP && id.split(':')[0] !== openedIP)) {
					this.$notify.error(this.$t('management.connect.fail'))
				} else {
					this.$notify.success(this.$t('management.connect.success'))
				}
			}, 1000)
			setTimeout(() => {
				this.stoppedNotify = false
			}, 2000)
		},
		// Quick Connect methods
		scanDevices() {
			this.scanning = true
			this.scanned = false
			this.mdnsDevices = []
			ipcRenderer.send('mdns')
		},
		openPairDialog(device) {
			this.pendingPairDevice = device
			this.pairingCode = ''
			this.pairDialogVisible = true
		},
		submitPair() {
			if (this.pairingCode.length < 6 || !this.pendingPairDevice) return
			this.pairing = true
			ipcRenderer.send('pair', {
				addr: this.pendingPairDevice.pairAddr,
				code: this.pairingCode
			})
		},
		quickConnectDevice(device) {
			this.connectingSerial = device.serial
			ipcRenderer.send('connectDirect', { addr: device.connectAddr })
		},
		openQrDialog() {
			if (this.qrDialogVisible) return
			// Generate random service name + password
			const rand = (len, chars) => Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
			const alphanum = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
			this.qrService = 'studio-' + rand(8, alphanum)
			this.qrPassword = rand(12, alphanum)
			const payload = `WIFI:T:ADB;S:${this.qrService};P:${this.qrPassword};;`
			this.qrDialogVisible = true
			this.qrWaiting = true
			this.$nextTick(() => {
				QRCode.toCanvas(this.$refs.qrCanvas, payload, {
					width: 280,
					margin: 2,
					color: { dark: '#000000', light: '#ffffff' }
				}, err => {
					if (err) {
						this.$notify.error('QR generation failed')
						this.qrDialogVisible = false
						return
					}
					ipcRenderer.send('qrPairStart', { service: this.qrService, password: this.qrPassword })
				})
			})
		},
		closeQrDialog() {
			this.qrWaiting = false
			ipcRenderer.send('qrPairStop')
		},
		openManualPairDialog() {
			this.manualPairAddr = ''
			this.manualPairCode = ''
			this.manualPairDialogVisible = true
		},
		submitManualPair() {
			if (!this.manualPairAddr || this.manualPairCode.length < 6) return
			this.manualPairing = true
			ipcRenderer.send('pair', {
				addr: this.manualPairAddr.trim(),
				code: this.manualPairCode
			})
		},
		getWirelessDevices(queryString, cb) {
			const wirelessDevices = this.wirelessDevices
			const results = queryString ? wirelessDevices.filter(this.createFilter(queryString)) : wirelessDevices
			cb(results)
		},
		createFilter(queryString) {
			return (device) => device.id.startsWith(queryString)
		},
		filterTag(value, row) {
			return row.method === value
		},
		rename({ id, method }, newName) {
			this.$store.put(id, newName)
			if (method === this.wireless) {
				const device = this.wirelessDevices.find((device) => device.id === id)
				device.name = newName
				this.$store.put('wirelessDevices', this.wirelessDevices)
			}
		},
		disconnect(index, id) {
			this.currentDevices.splice(index, 1)
			ipcRenderer.send('disconnect', id)
			this.$notify.info(this.$t('management.disconnect.success', { name: this.$store.get(id) || id }))
		},
		selectionChange(val) {
			this.selectedDevices = val
		},
		handleSelect(item) {
			this.ip = this.deletedEvent ? '192.168.0.' : item.id
			this.deletedEvent = false
		},
		deleteWirelessDevice(id) {
			this.deletedEvent = true
			const index = this.wirelessDevices.findIndex((device) => device.id === id)
			this.wirelessDevices.splice(index, 1)
			this.$store.put('wirelessDevices', this.wirelessDevices)
		}
	}
}
</script>

<style>
.el-card__body {
	padding: 12px !important;
}
/* ── Quick Connect ─────────────────────────── */
.quick-connect {
	background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
	border: 1px solid #0f3460;
	border-radius: 10px;
	padding: 16px;
	margin-bottom: 16px;
}
.qc-header {
	display: flex;
	flex-direction: column;
	margin-bottom: 12px;
}
.qc-title {
	font-size: 15px;
	font-weight: 600;
	color: #e0e0e0;
	letter-spacing: 0.5px;
}
.qc-subtitle {
	font-size: 11px;
	color: #666;
	margin-top: 3px;
}
.qc-scan-btn {
	margin-bottom: 12px;
}
.qc-btn-row {
	display: flex;
	gap: 8px;
	margin-bottom: 12px;
}
.qc-btn-row .el-button + .el-button {
	margin-left: 0;
}
.qc-empty {
	font-size: 12px;
	color: #666;
	text-align: center;
	padding: 10px 0;
}
.qc-device-list {
	display: flex;
	flex-direction: column;
	gap: 8px;
}
.qc-device-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	background: rgba(255,255,255,0.04);
	border: 1px solid #2a2a3a;
	border-radius: 8px;
	padding: 10px 12px;
	transition: border-color 0.2s;
}
.qc-device-row:hover {
	border-color: #0f3460;
}
.qc-device-info {
	display: flex;
	align-items: center;
	gap: 10px;
}
.qc-device-icon {
	font-size: 22px;
}
.qc-device-name {
	display: block;
	font-size: 13px;
	color: #ddd;
	font-weight: 500;
}
.qc-device-addr {
	display: block;
	font-size: 11px;
	color: #666;
	margin-top: 2px;
}
.qc-device-actions {
	display: flex;
	gap: 6px;
}
/* ── Pair dialog ─────────────────────────── */
.pair-dialog .el-dialog {
	background: #1e1e1e !important;
	border: 1px solid #333 !important;
	border-radius: 10px !important;
}
.pair-dialog .el-dialog__title {
	color: #e0e0e0 !important;
}
.pair-dialog .el-dialog__header,
.pair-dialog .el-dialog__footer {
	border-color: #333 !important;
}
.pair-hint {
	font-size: 12px;
	color: #888;
	margin: 0 0 12px;
	line-height: 1.5;
}
.qr-wrap {
	display: flex;
	justify-content: center;
	background: #fff;
	padding: 12px;
	border-radius: 8px;
	margin: 0 auto;
	width: fit-content;
}
.qr-status {
	font-size: 12px;
	color: #888;
	text-align: center;
	margin: 12px 0 0;
}
/* ── Device table ─────────────────────────── */
.wrap-button {
	text-align: center;
	margin: 20px auto;
}
.wrap-form {
	text-align: center;
	margin-bottom: 20px;
}
.item-id {
	font-size: 14px;
	color: #666;
}
.item-id::before {
	content: "ID: ";
	color: #999;
}
.item-remove {
	padding: 0 10px;
}
.when-empty {
	margin: 10px auto;
	text-align: center;
}
</style>
