# Architecture

## High-Level

```
┌──────────────────────────────────────────────────────────────┐
│                       DroidScreen.app                        │
│                                                              │
│  ┌─────────────────────┐         ┌──────────────────────┐    │
│  │  Renderer Process   │  IPC    │   Main Process       │    │
│  │  (Vue 2 + Element)  │ ◄─────► │   (Node.js)          │    │
│  │                     │         │                      │    │
│  │  • Management.vue   │         │  • adb/index.js      │    │
│  │  • Configuration.vue│         │  • scrcpy/index.js   │    │
│  │  • Tray / Menu      │         │  • IPC handlers      │    │
│  └─────────────────────┘         └─────────┬────────────┘    │
│                                            │                 │
└────────────────────────────────────────────┼─────────────────┘
                                             │ spawn / TCP
                              ┌──────────────┼──────────────┐
                              ▼              ▼              ▼
                       ┌──────────┐   ┌──────────┐   ┌──────────┐
                       │  scrcpy  │   │   adb    │   │  adbkit  │
                       │ (binary) │   │ (binary) │   │  (TCP)   │
                       └──────────┘   └──────────┘   └──────────┘
                              │              │              │
                              └──────────────┴──────────────┘
                                          │
                                          ▼
                                   ┌──────────────┐
                                   │ Android Device│
                                   └──────────────┘
```

## Process Responsibilities

### Main Process (`src/main/`)

Node.js context with full system access. Handles:

- **App lifecycle** — `index.js` creates the BrowserWindow, registers IPC, initializes `@electron/remote`
- **Device tracking** — `adb/index.js` uses `adbkit` to keep an open `trackDevices()` stream and broadcasts changes via the `devices` IPC channel
- **mDNS discovery** — `adb/index.js` shells out to `adb mdns services` and parses the result
- **Pairing & connecting** — `adb/index.js` shells out to `adb pair <addr> <code>` and `adb connect <addr>`
- **scrcpy spawning** — `scrcpy/index.js` builds a CLI argument list from the saved config and spawns one `scrcpy` process per selected device

### Renderer Process (`src/renderer/`)

Browser context with `nodeIntegration: true` (so it can `require` Node modules). Handles:

- **UI** — Vue 2 + Element UI, dark theme via global SCSS overrides
- **Routing** — Vue Router with two views: `Configuration` and `Management`
- **Persistence** — `localstorage` package for device aliases and saved config
- **i18n** — `vue-i18n` (English only)
- **IPC** — sends user actions, listens for device updates and command results

## Key Modules

### `src/main/adb/index.js`

```js
{
  onDevices(sender)        // Start adbkit tracker, push 'devices' updates
  connect({sender}, {id, ip})    // Switch USB device to TCP/IP, then connect
  disconnect({sender}, ip)        // adb disconnect
  mdnsDiscover({sender})          // adb mdns services + parse
  pairDevice({sender}, {addr, code})   // adb pair (validated)
  connectDirect({sender}, {addr})       // adb connect (validated)
  qrPairStart({sender}, {service, password})  // Poll mDNS for QR-scanned phone, auto-pair
  qrPairStop()                          // Cancel in-flight QR poll
}
```

**Validation**: addresses must match `host:port`, codes must be exactly 6 digits. All shell calls use `execFile` (no shell interpolation).

### `src/main/scrcpy/index.js`

Builds an argv list from the saved config and spawns one `scrcpy` process per device. Tracks lifecycle:

- `stdout` data → first chunk triggers `'open'` IPC
- `'exit'` → `'close'` IPC with success flag

### `src/renderer/components/dashboard/Management.vue`

The main device dashboard. Three sections:

1. **Quick Connect** — scan, pair, connect (mDNS + Android 11+)
2. **Device list** — current connected devices, alias editing, mirror launch
3. **Manual IP** (collapsed) — legacy IP-based connection

Subscribes to all device-related IPC channels in `created()` and unsubscribes in `beforeDestroy()`.

### `src/renderer/components/dashboard/Configuration.vue`

A form binding every scrcpy option to a Vuex-like store (backed by `localstorage`). Persists on save.

## Build Pipeline

`webpack` runs two configs in parallel:

- `webpack.main.config.js` → `dist/electron/main.js` (Node target)
- `webpack.renderer.config.js` → `dist/electron/renderer.js` (Electron renderer)

`electron-builder` then packages the result into `build/mac-arm64/DroidScreen.app` and a `.zip`.

## State Flow

```
User clicks "Scan"
       │
       ▼
Renderer: ipcRenderer.send('mdns')
       │
       ▼
Main: ipcMain.on('mdns') → execFile('adb', ['mdns', 'services'])
       │
       ▼
Main: parse output → sender.send('mdns', {success, devices})
       │
       ▼
Renderer: ipcRenderer.on('mdns') → update mdnsDevices array
       │
       ▼
Vue reactive UI re-renders
```

## Why Electron 28 (LTS)?

- Native Apple Silicon (arm64) support — required for macOS 26+ on M-series Macs
- LTS release line, security patches through 2025
- `@electron/remote` v2 still compatible
- Native `titleBarStyle: 'hiddenInset'` replaces deprecated `custom-electron-titlebar`
- `enableRemoteModule` removed; `@electron/remote` initialized via `remote.initialize()` + `remote.enable(webContents)`
