import { contextBridge, ipcRenderer } from 'electron';
import type { PaperLensApi } from '../shared/ipc';

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => {
    callback(payload);
  };
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const api: PaperLensApi = {
  papers: {
    list: () => ipcRenderer.invoke('papers:list'),
    get: (id) => ipcRenderer.invoke('papers:get', id),
    importOriginal: () => ipcRenderer.invoke('papers:import'),
    attachTranslated: (id) => ipcRenderer.invoke('papers:attachTranslated', id),
    update: (id, patch) => ipcRenderer.invoke('papers:update', id, patch),
    remove: (id) => ipcRenderer.invoke('papers:remove', id),
    markRead: (id, version, pageNo) =>
      ipcRenderer.invoke('papers:markRead', id, version, pageNo),
    checkFiles: () => ipcRenderer.invoke('papers:checkFiles'),
    relocate: (id, version) => ipcRenderer.invoke('papers:relocate', id, version),
  },
  folders: {
    list: () => ipcRenderer.invoke('folders:list'),
    create: (name) => ipcRenderer.invoke('folders:create', name),
    rename: (id, name) => ipcRenderer.invoke('folders:rename', id, name),
    remove: (id) => ipcRenderer.invoke('folders:remove', id),
  },
  pdf: {
    load: (paperId, version) => ipcRenderer.invoke('pdf:load', paperId, version),
  },
  conversations: {
    list: (paperId) => ipcRenderer.invoke('conversations:list', paperId),
    create: (paperId, title) => ipcRenderer.invoke('conversations:create', paperId, title),
    rename: (id, title) => ipcRenderer.invoke('conversations:rename', id, title),
    remove: (id) => ipcRenderer.invoke('conversations:remove', id),
  },
  messages: {
    list: (conversationId) => ipcRenderer.invoke('messages:list', conversationId),
  },
  chat: {
    send: (req) => ipcRenderer.invoke('chat:send', req),
    abort: (requestId) => ipcRenderer.invoke('chat:abort', requestId),
    onDelta: (cb) => subscribe('chat:delta', cb),
    onDone: (cb) => subscribe('chat:done', cb),
    onError: (cb) => subscribe('chat:error', cb),
  },
  translate: {
    text: (input) => ipcRenderer.invoke('translate:text', input),
  },
  translation: {
    engineStatus: () => ipcRenderer.invoke('translation:engineStatus'),
    chooseEnginePath: () => ipcRenderer.invoke('translation:chooseEnginePath'),
    install: () => ipcRenderer.invoke('translation:install'),
    warmup: () => ipcRenderer.invoke('translation:warmup'),
    cancel: (jobId) => ipcRenderer.invoke('translation:cancel', jobId),
    start: (paperId) => ipcRenderer.invoke('translation:start', paperId),
    getState: () => ipcRenderer.invoke('translation:getState'),
    onProgress: (cb) => subscribe('translation:progress', cb),
    onDone: (cb) => subscribe('translation:done', cb),
    onFailed: (cb) => subscribe('translation:failed', cb),
    onCanceled: (cb) => subscribe('translation:canceled', cb),
    onToolProgress: (cb) => subscribe('tool:progress', cb),
    onToolDone: (cb) => subscribe('tool:done', cb),
    onState: (cb) => subscribe('translation:state', cb),
  },
  notes: {
    list: (paperId) => ipcRenderer.invoke('notes:list', paperId),
    create: (input) => ipcRenderer.invoke('notes:create', input),
    update: (id, patch) => ipcRenderer.invoke('notes:update', id, patch),
    remove: (id) => ipcRenderer.invoke('notes:remove', id),
    generate: (kind, params) => ipcRenderer.invoke('notes:generate', kind, params),
  },
  search: {
    global: (query) => ipcRenderer.invoke('search:global', query),
  },
  exportFile: {
    save: (suggestedName, content, context) =>
      ipcRenderer.invoke('export:save', suggestedName, content, context),
    saveDocx: (suggestedName, data, context) =>
      ipcRenderer.invoke('export:saveDocx', suggestedName, data, context),
    printPdf: (suggestedName, title, markdown, context) =>
      ipcRenderer.invoke('export:printPdf', suggestedName, title, markdown, context),
    getJob: (token) => ipcRenderer.invoke('export:getJob', token),
    ready: (token) => ipcRenderer.invoke('export:ready', token),
    fail: (token, message) => ipcRenderer.invoke('export:fail', token, message),
  },
  window: {
    setFullscreen: (fullscreen) => ipcRenderer.invoke('window:setFullscreen', fullscreen),
    onFullscreenChange: (cb) => subscribe('window:fullscreen-changed', cb),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (input) => ipcRenderer.invoke('settings:set', input),
    test: (input) => ipcRenderer.invoke('settings:test', input),
  },
  appSettings: {
    get: () => ipcRenderer.invoke('appSettings:get'),
    update: (patch) => ipcRenderer.invoke('appSettings:update', patch),
  },
  storage: {
    getInfo: () => ipcRenderer.invoke('storage:getInfo'),
    migrateLegacy: () => ipcRenderer.invoke('storage:migrateLegacy'),
    chooseRoot: () => ipcRenderer.invoke('storage:chooseRoot'),
    changeRoot: (newRoot) => ipcRenderer.invoke('storage:changeRoot', newRoot),
    importFolder: () => ipcRenderer.invoke('storage:importFolder'),
    cancelImport: () => ipcRenderer.invoke('storage:cancelImport'),
    openRoot: () => ipcRenderer.invoke('storage:openRoot'),
    revealPaper: (paperId) => ipcRenderer.invoke('storage:revealPaper', paperId),
    onBusy: (cb) => subscribe('storage:busy', cb),
    onMigrated: (cb) => subscribe('storage:migrated', cb),
    onImportProgress: (cb) => subscribe('storage:importProgress', cb),
  },
};

contextBridge.exposeInMainWorld('api', api);
