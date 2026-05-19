import { app, BrowserWindow, ipcMain } from 'electron'
import adb from './adb'
import scrcpy from './scrcpy'
const remoteMain = require('@electron/remote/main')
remoteMain.initialize()

/**
 * Set `__static` path to static files in production
 */
if (process.env.NODE_ENV !== 'development') {
	global.__static = require('path').join(__dirname, '/static').replace(/\\/g, '\\\\')
}

let mainWindow
const winURL = process.env.NODE_ENV === 'development'
	? 'http://localhost:9080'
	: `file://${__dirname}/index.html`

function createWindow() {
  /**
   * Initial window options
   */
	mainWindow = new BrowserWindow({
		height: 800,
		width: 513,
		titleBarStyle: 'hiddenInset',
		title: 'DroidScreen',
		fullscreenable: false,
		vibrancy: 'under-window',
		center: true,
		show: false,
		webPreferences: {
			backgroundThrottling: false,
			nodeIntegration: true,
			contextIsolation: false
		},
		// resizable: false
	})

	remoteMain.enable(mainWindow.webContents)
	mainWindow.setMenu(null)

	mainWindow.loadURL(winURL)
	mainWindow.once('ready-to-show', () => {
		mainWindow.show()
		// mainWindow.webContents.openDevTools()
	})
	mainWindow.on('close', () => {
		// listeners are registered once globally; nothing to clean here
	})

	mainWindow.on('closed', () => {
		mainWindow = null
	})

	mainWindow.webContents.on('did-finish-load', function () {
		adb.onDevices(mainWindow.webContents)
	})
}

// Register IPC handlers once (survives page reloads in dev)
function registerIpcHandlers() {
	const channels = ['open', 'connect', 'disconnect', 'mdns', 'pair', 'connectDirect', 'qrPairStart', 'qrPairStop']
	channels.forEach(ch => ipcMain.removeAllListeners(ch))
	ipcMain.on('open', scrcpy.open)
	ipcMain.on('connect', adb.connect)
	ipcMain.on('disconnect', adb.disconnect)
	ipcMain.on('mdns', adb.mdnsDiscover)
	ipcMain.on('pair', adb.pairDevice)
	ipcMain.on('connectDirect', adb.connectDirect)
	ipcMain.on('qrPairStart', adb.qrPairStart)
	ipcMain.on('qrPairStop', () => adb.qrPairStop())
}

app.on('ready', () => {
	registerIpcHandlers()
	createWindow()
})

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') {
		app.quit()
	}
})

app.on('activate', () => {
	if (mainWindow === null) {
		createWindow()
	}
})

/*
import { autoUpdater } from 'electron-updater'

autoUpdater.on('update-downloaded', () => {
  autoUpdater.quitAndInstall()
})

app.on('ready', () => {
  if (process.env.NODE_ENV === 'production') autoUpdater.checkForUpdates()
})
 */
