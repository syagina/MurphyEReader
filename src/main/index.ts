import { app, BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';
import { join } from 'path';
import { openDb } from './db';
import { registerIpcHandlers } from './ipc/handlers';
import { createSafeStorageSecretStore } from './settings/secret-store';

let mainWindow: BrowserWindow | null = null;
let db: Database.Database | null = null;

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow = win;
  win.on('closed', () => {
    mainWindow = null;
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  const database = openDb(join(app.getPath('userData'), 'paperlens.db'));
  db = database;
  const secret = createSafeStorageSecretStore();

  registerIpcHandlers({
    db: database,
    secret,
    emit: (channel, payload) => {
      const win = mainWindow;
      if (win !== null && !win.isDestroyed()) {
        win.webContents.send(channel, payload);
      }
    },
    mainWindow: () => mainWindow,
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('will-quit', () => {
  db?.close();
  db = null;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
