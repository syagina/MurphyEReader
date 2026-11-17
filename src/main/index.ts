import { app, BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';
import { join } from 'path';
import { openDb } from './db';
import { registerIpcHandlers } from './ipc/handlers';
import { createSafeStorageSecretStore } from './settings/secret-store';
import { legacyUserDataDir } from './settings/legacy-user-data';

// The app used to store its data under the pre-rename folder. Keep using that
// folder when it is the only one with a database, so the rename does not open
// an empty library. Must run before the first window is created.
const legacyUserData = legacyUserDataDir(
  app.getPath('userData'),
  app.getPath('appData'),
);
if (legacyUserData !== null) {
  app.setPath('userData', legacyUserData);
}

let mainWindow: BrowserWindow | null = null;
let db: Database.Database | null = null;
// The first quit request with a live external tool job is deferred until the
// shutdown hook has canceled it and cleaned up; the second one goes through.
let shuttingDown = false;

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
  // The OS can leave fullscreen without going through our IPC handler (F11,
  // Escape, window controls); keep the renderer's focus mode in sync.
  win.on('enter-full-screen', () => {
    win.webContents.send('window:fullscreen-changed', true);
  });
  win.on('leave-full-screen', () => {
    win.webContents.send('window:fullscreen-changed', false);
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

  const { startStorageMigration, hasActiveToolJob, shutdown } = registerIpcHandlers({
    db: database,
    secret,
    documentsDir: app.getPath('documents'),
    emit: (channel, payload) => {
      const win = mainWindow;
      if (win !== null && !win.isDestroyed()) {
        win.webContents.send(channel, payload);
      }
    },
    mainWindow: () => mainWindow,
  });

  createWindow();

  // One background pass adopts legacy papers; failures are recorded by the
  // handler and shown in the library, so the window opens regardless.
  void startStorageMigration();

  app.on('before-quit', (event) => {
    if (shuttingDown) {
      return;
    }
    if (!hasActiveToolJob()) {
      return;
    }
    event.preventDefault();
    shuttingDown = true;
    void shutdown().finally(() => {
      app.quit();
    });
  });

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
