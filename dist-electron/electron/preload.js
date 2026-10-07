"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const api = {
    browser: {
        navigate: (url) => electron_1.ipcRenderer.invoke("browser:navigate", url),
        getUrl: () => electron_1.ipcRenderer.invoke("browser:url"),
    },
    agent: {
        run: (instruction) => electron_1.ipcRenderer.invoke("agent:run", instruction),
        onEvent: (callback) => {
            const listener = (_event, data) => {
                callback(data);
            };
            electron_1.ipcRenderer.on("agent:event", listener);
            return () => {
                electron_1.ipcRenderer.removeListener("agent:event", listener);
            };
        },
    },
};
electron_1.contextBridge.exposeInMainWorld("vangrex", api);
