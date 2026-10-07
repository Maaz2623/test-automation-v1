"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const electron_1 = require("electron");
const node_path_1 = __importDefault(require("node:path"));
const playwright_manager_js_1 = require("./browser/playwright-manager.js");
const browser_agent_js_1 = require("./agent/browser-agent.js");
const isDev = !electron_1.app.isPackaged;
let mainWindow = null;
let browserView = null;
let playwrightManager = null;
let browserAgent = null;
const CHAT_WIDTH = 480;
function createWindow() {
    mainWindow =
        new electron_1.BrowserWindow({
            width: 1400,
            height: 850,
            minWidth: 1000,
            minHeight: 650,
            webPreferences: {
                preload: node_path_1.default.join(__dirname, "preload.js"),
                contextIsolation: true,
                nodeIntegration: false,
            },
        });
    mainWindow.loadURL(isDev
        ? "http://127.0.0.1:5173"
        : `file://${node_path_1.default.join(__dirname, "../dist/index.html")}`);
    createBrowserView();
    mainWindow.on("resize", updateBrowserBounds);
    mainWindow.on("closed", () => {
        mainWindow = null;
        browserView = null;
    });
}
function createBrowserView() {
    if (!mainWindow) {
        return;
    }
    browserView =
        new electron_1.WebContentsView({
            webPreferences: {
                contextIsolation: true,
                nodeIntegration: false,
            },
        });
    mainWindow.contentView.addChildView(browserView);
    updateBrowserBounds();
    void browserView.webContents.loadURL("https://www.google.com");
}
function updateBrowserBounds() {
    if (!mainWindow ||
        !browserView) {
        return;
    }
    const bounds = mainWindow.getContentBounds();
    browserView.setBounds({
        x: 0,
        y: 0,
        width: Math.max(1, bounds.width - CHAT_WIDTH),
        height: bounds.height,
    });
}
async function waitForBrowserView() {
    if (!browserView) {
        throw new Error("Browser view has not been created.");
    }
    if (browserView.webContents.isLoading()) {
        await new Promise((resolve) => {
            browserView?.webContents.once("did-finish-load", () => resolve());
        });
    }
}
async function initializeAutomation() {
    if (!browserView) {
        throw new Error("Browser view has not been created.");
    }
    playwrightManager =
        new playwright_manager_js_1.PlaywrightManager();
    await playwrightManager.connect();
    /**
     * Tell Playwright which page Electron is
     * currently displaying.
     *
     * This does NOT navigate.
     */
    await playwrightManager.syncVisibleUrl(browserView.webContents.getURL());
    browserAgent =
        new browser_agent_js_1.BrowserAgent(playwrightManager, (event) => {
            mainWindow?.webContents.send("agent:event", event);
        });
    console.log("[Vangrex] Browser automation ready.");
    console.log("[Vangrex] Current browser:", await playwrightManager.getPageInfo());
}
/**
 * Explicit browser navigation.
 *
 * This is NOT used automatically by the agent.
 */
electron_1.ipcMain.handle("browser:navigate", async (_event, url) => {
    if (!playwrightManager) {
        throw new Error("Playwright is not initialized.");
    }
    const finalUrl = await playwrightManager.navigate(url);
    return {
        success: true,
        url: finalUrl,
    };
});
electron_1.ipcMain.handle("agent:run", async (_event, instruction) => {
    if (!browserAgent) {
        throw new Error("Browser agent is not initialized.");
    }
    return browserAgent.run(instruction);
});
electron_1.ipcMain.handle("browser:url", async () => {
    if (playwrightManager) {
        const info = await playwrightManager.getPageInfo();
        return info.url;
    }
    return (browserView?.webContents.getURL() ??
        "");
});
/**
 * CDP must be enabled BEFORE app ready.
 */
electron_1.app.commandLine.appendSwitch("remote-debugging-port", "9222");
electron_1.app.whenReady().then(async () => {
    try {
        createWindow();
        await waitForBrowserView();
        await initializeAutomation();
        electron_1.app.on("activate", () => {
            if (electron_1.BrowserWindow.getAllWindows()
                .length === 0) {
                createWindow();
            }
        });
    }
    catch (error) {
        console.error("[Vangrex] Initialization failed:", error);
    }
});
electron_1.app.on("window-all-closed", () => {
    if (process.platform !==
        "darwin") {
        electron_1.app.quit();
    }
});
electron_1.app.on("before-quit", () => {
    if (playwrightManager) {
        void playwrightManager.close();
        playwrightManager = null;
    }
});
