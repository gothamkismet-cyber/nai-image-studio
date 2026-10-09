const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  loadPromptLib: () => ipcRenderer.invoke("promptlib:load"),
  pickPromptLibDir: () => ipcRenderer.invoke("promptlib:pick"),
  copyImage: (png) => ipcRenderer.invoke("image:copy", png),
  updateInfo: () => ipcRenderer.invoke("updates:info"),
  checkLatestRelease: () => ipcRenderer.invoke("updates:check-latest"),
  openReleases: () => ipcRenderer.invoke("updates:open-releases"),
  chooseUpdate: () => ipcRenderer.invoke("updates:choose"),
  installUpdate: (id) => ipcRenderer.invoke("updates:install", id),
});
