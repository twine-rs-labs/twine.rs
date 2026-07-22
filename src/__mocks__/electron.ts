export const app = {
	disableHardwareAcceleration: jest.fn(),
	getAppMetrics: jest.fn(() => []),
	getName() {
		return `mock-electron-app-name`;
	},
	getPath(name: string) {
		return `mock-electron-app-path-${name}`;
	},
	on: jest.fn(),
	quit: jest.fn(),
	relaunch: jest.fn(),
	setName: jest.fn(),
	setPath: jest.fn()
};

export class BrowserWindow {
	static instances: BrowserWindow[] = [];

	constructor() {
		BrowserWindow.instances.push(this);
		(this as any).webContents = {
			on: jest.fn(),
			setWindowOpenHandler: jest.fn()
		};
	}

	loadURL() {}
	on() {}
	once() {}

	static getFocusedWindow = jest.fn();
}

export const dialog = {
	showErrorBox: jest.fn(),
	showOpenDialog: jest.fn().mockResolvedValue({canceled: true}),
	showMessageBox: jest.fn().mockResolvedValue({response: 0})
};

export const clipboard = {
	writeText: jest.fn()
};

export const ipcMain = {
	handle: jest.fn(),
	on: jest.fn()
};

export const contextBridge = {
	exposeInMainWorld: jest.fn()
};

export const ipcRenderer = {
	invoke: jest.fn(),
	on: jest.fn(),
	once: jest.fn(),
	removeListener: jest.fn(),
	send: jest.fn(),
	sendSync: jest.fn()
};

export const net = {
	fetch: jest.fn()
};

export const protocol = {
	handle: jest.fn(),
	registerSchemesAsPrivileged: jest.fn()
};

export const nativeImage = {
	createFromPath: jest.fn(() => ({
		getSize: jest.fn(() => ({height: 480, width: 640}))
	}))
};

export const webUtils = {
	getPathForFile: jest.fn()
};

export const screen = {
	getPrimaryDisplay() {
		return {workAreaSize: {height: 480, width: 640}};
	}
};

export const shell = {
	openExternal: jest.fn(),
	openPath: jest.fn(),
	showItemInFolder: jest.fn(),
	trashItem: jest.fn()
};

export const Menu = {
	buildFromTemplate: (template: any) => template,
	setApplicationMenu: jest.fn()
};
