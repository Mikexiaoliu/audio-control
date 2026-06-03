const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('audioControl', {
  addAudioFiles: () => ipcRenderer.invoke('dialog:add-audio-files'),
  addAudioFolder: () => ipcRenderer.invoke('dialog:add-audio-folder'),
  fileExists: (filePath) => ipcRenderer.invoke('file:exists', filePath),
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings)
});
