const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  pickFiles: () => ipcRenderer.invoke('dialog:pickFiles'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url)
});
