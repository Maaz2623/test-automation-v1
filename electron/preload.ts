import { contextBridge, ipcRenderer } from "electron";

const api = {
  browser: {
    navigate: (url: string) => ipcRenderer.invoke("browser:navigate", url),

    getUrl: () => ipcRenderer.invoke("browser:url"),
  },

  agent: {
    run: (instruction: string) => ipcRenderer.invoke("agent:run", instruction),

    onEvent: (callback: (event: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: unknown) => {
        callback(data);
      };

      ipcRenderer.on("agent:event", listener);

      return () => {
        ipcRenderer.removeListener("agent:event", listener);
      };
    },
  },
};

contextBridge.exposeInMainWorld("vangrex", api);

export type VangrexAPI = typeof api;
