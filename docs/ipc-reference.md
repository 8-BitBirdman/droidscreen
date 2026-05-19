# IPC Reference

Every channel between the renderer and main process.

## Renderer → Main

### `open`
Spawn scrcpy for one or more devices.

```js
ipcRenderer.send('open', { config, devices })
// config: full configuration object from Configuration.vue
// devices: [{ id: 'serial-or-ip:port', name: 'alias' }]
```

### `connect`
Switch a USB device to TCP/IP and connect, **or** connect directly to an IP.

```js
ipcRenderer.send('connect', { id, ip })
// id: USB device serial (or null to skip tcpip step)
// ip: target IP address
```

### `disconnect`
Disconnect a wireless device.

```js
ipcRenderer.send('disconnect', ip)
```

### `mdns`
Trigger mDNS discovery for nearby Android 11+ devices.

```js
ipcRenderer.send('mdns')
```

### `pair`
Pair with a device using its 6-digit code.

```js
ipcRenderer.send('pair', { addr, code })
// addr: 'host:port' (validated regex)
// code: 6-digit string (validated regex)
```

### `connectDirect`
Connect to an already-paired device by mDNS-discovered address.

```js
ipcRenderer.send('connectDirect', { addr })
// addr: 'host:port' (validated regex)
```

### `qrPairStart`
Start polling for a phone that scanned a QR pairing code. Auto-runs `adb pair` on discovery.

```js
ipcRenderer.send('qrPairStart', { service, password })
// service: random alphanumeric 1-32 chars (matches mDNS instance name from QR scan)
// password: random alphanumeric 6-32 chars (encoded in QR, used as pairing secret)
// QR payload format: `WIFI:T:ADB;S:<service>;P:<password>;;`
// 120s timeout. Cancel with qrPairStop.
```

### `qrPairStop`
Cancel an in-flight QR pairing poll.

```js
ipcRenderer.send('qrPairStop')
```

---

## Main → Renderer

### `devices`
Pushed whenever the device list changes (USB plug, wireless connect, etc.).

```js
ipcRenderer.on('devices', (event, devices) => {})
// devices: [{ id: 'serial', type: 'device' | 'unauthorized' | ... }]
```

### `open`
A scrcpy process started successfully.

```js
ipcRenderer.on('open', (event, id) => {})
// id: device id passed to the spawn
```

### `close`
A scrcpy process exited.

```js
ipcRenderer.on('close', (event, { success, id }) => {})
// success: true if exit code was 0
```

### `error`
A user-facing error occurred during spawn.

```js
ipcRenderer.on('error', (event, { type }) => {})
// type: i18n key under management.error.* (e.g. 'unknownScrcpyPathException')
```

### `mdns`
Result of an mDNS scan.

```js
ipcRenderer.on('mdns', (event, { success, devices }) => {})
// devices: [{ serial, name, pairAddr?, connectAddr? }]
```

### `pair`
Result of a pair attempt.

```js
ipcRenderer.on('pair', (event, { success }) => {})
```

### `connectDirect`
Result of a direct connect attempt.

```js
ipcRenderer.on('connectDirect', (event, { success }) => {})
```

### `qrPair`
Result of a QR pairing attempt (success, failure, timeout, or invalid input).

```js
ipcRenderer.on('qrPair', (event, { success, message }) => {})
// message: human-readable status ('Paired', 'Pair failed', 'Timeout...', 'Invalid...')
```

### `disconnect`
Result of a disconnect attempt.

```js
ipcRenderer.on('disconnect', (event, { success, message }) => {})
```

---

## Validation Rules

All shell-bound inputs from the renderer are validated in main:

| Input | Regex | Notes |
|:------|:------|:------|
| Device address | `^[0-9a-fA-F.:[\]]+:\d{1,5}$` | Accepts IPv4, IPv6, hostname:port |
| Pairing code | `^\d{6}$` | Exactly 6 digits |
| QR service | `^[A-Za-z0-9_-]{1,32}$` | Alphanumeric, dash, underscore |
| QR password | `length 6-32` | Type-checked string |

Failed validation returns `{ success: false }` without spawning any process.

## Listener Lifecycle

- **Main process**: Listeners registered once at `app.ready` via `registerIpcHandlers()`. Survives renderer reloads.
- **Renderer**: `Management.vue` registers in `created()`, removes all in `beforeDestroy()` to prevent leaks during HMR or route changes.
