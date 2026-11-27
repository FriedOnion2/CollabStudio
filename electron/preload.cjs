const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  pickFiles: () => ipcRenderer.invoke('dialog:pickFiles'),
  setLanguage: (language) => ipcRenderer.invoke('language:set', language),
  quit: () => ipcRenderer.invoke('app:quit')
});
