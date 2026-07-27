'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('athios', {
  // Actions (renderer -> main)
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  startDownload: (payload) => ipcRenderer.invoke('start-download', payload),
  stopDownload: () => ipcRenderer.invoke('stop-download'),

  // Events (main -> renderer)
  onOutput: (callback) => {
    ipcRenderer.on('wget-output', (_event, text) => callback(text));
  },
  onDone: (callback) => {
    ipcRenderer.on('wget-done', (_event, result) => callback(result));
  }
});
