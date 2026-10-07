import "dotenv/config";

import {
  app,
  BrowserWindow,
  ipcMain,
  WebContentsView,
} from "electron";

import path from "node:path";

import {
  PlaywrightManager,
} from "./browser/playwright-manager.js";

import {
  BrowserAgent,
} from "./agent/browser-agent.js";

const isDev =
  !app.isPackaged;

let mainWindow:
  | BrowserWindow
  | null = null;

let browserView:
  | WebContentsView
  | null = null;

let playwrightManager:
  | PlaywrightManager
  | null = null;

let browserAgent:
  | BrowserAgent
  | null = null;

const CHAT_WIDTH = 480;

function createWindow(): void {
  mainWindow =
    new BrowserWindow({
      width: 1400,
      height: 850,

      minWidth: 1000,
      minHeight: 650,

      webPreferences: {
        preload: path.join(
          __dirname,
          "preload.js",
        ),

        contextIsolation: true,
        nodeIntegration: false,
      },
    });

  mainWindow.loadURL(
    isDev
      ? "http://127.0.0.1:5173"
      : `file://${path.join(
          __dirname,
          "../dist/index.html",
        )}`,
  );

  createBrowserView();

  mainWindow.on(
    "resize",
    updateBrowserBounds,
  );

  mainWindow.on(
    "closed",
    () => {
      mainWindow = null;
      browserView = null;
    },
  );
}

function createBrowserView(): void {
  if (!mainWindow) {
    return;
  }

  browserView =
    new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

  mainWindow.contentView.addChildView(
    browserView,
  );

  updateBrowserBounds();

  void browserView.webContents.loadURL(
    "https://www.google.com",
  );
}

function updateBrowserBounds(): void {
  if (
    !mainWindow ||
    !browserView
  ) {
    return;
  }

  const bounds =
    mainWindow.getContentBounds();

  browserView.setBounds({
    x: 0,
    y: 0,

    width: Math.max(
      1,
      bounds.width - CHAT_WIDTH,
    ),

    height: bounds.height,
  });
}

async function waitForBrowserView(): Promise<void> {
  if (!browserView) {
    throw new Error(
      "Browser view has not been created.",
    );
  }

  if (
    browserView.webContents.isLoading()
  ) {
    await new Promise<void>(
      (resolve) => {
        browserView?.webContents.once(
          "did-finish-load",
          () => resolve(),
        );
      },
    );
  }
}

async function initializeAutomation(): Promise<void> {
  if (!browserView) {
    throw new Error(
      "Browser view has not been created.",
    );
  }

  playwrightManager =
    new PlaywrightManager();

  await playwrightManager.connect();

  /**
   * Tell Playwright which page Electron is
   * currently displaying.
   *
   * This does NOT navigate.
   */
  await playwrightManager.syncVisibleUrl(
    browserView.webContents.getURL(),
  );

  browserAgent =
    new BrowserAgent(
      playwrightManager,
      (event) => {
        mainWindow?.webContents.send(
          "agent:event",
          event,
        );
      },
    );

  console.log(
    "[Vangrex] Browser automation ready.",
  );

  console.log(
    "[Vangrex] Current browser:",
    await playwrightManager.getPageInfo(),
  );
}

/**
 * Explicit browser navigation.
 *
 * This is NOT used automatically by the agent.
 */
ipcMain.handle(
  "browser:navigate",
  async (
    _event,
    url: string,
  ) => {
    if (!playwrightManager) {
      throw new Error(
        "Playwright is not initialized.",
      );
    }

    const finalUrl =
      await playwrightManager.navigate(
        url,
      );

    return {
      success: true,
      url: finalUrl,
    };
  },
);

ipcMain.handle(
  "agent:run",
  async (
    _event,
    instruction: string,
  ) => {
    if (!browserAgent) {
      throw new Error(
        "Browser agent is not initialized.",
      );
    }

    return browserAgent.run(
      instruction,
    );
  },
);

ipcMain.handle(
  "browser:url",
  async () => {
    if (playwrightManager) {
      const info =
        await playwrightManager.getPageInfo();

      return info.url;
    }

    return (
      browserView?.webContents.getURL() ??
      ""
    );
  },
);

/**
 * CDP must be enabled BEFORE app ready.
 */
app.commandLine.appendSwitch(
  "remote-debugging-port",
  "9222",
);

app.whenReady().then(
  async () => {
    try {
      createWindow();

      await waitForBrowserView();

      await initializeAutomation();

      app.on(
        "activate",
        () => {
          if (
            BrowserWindow.getAllWindows()
              .length === 0
          ) {
            createWindow();
          }
        },
      );
    } catch (error) {
      console.error(
        "[Vangrex] Initialization failed:",
        error,
      );
    }
  },
);

app.on(
  "window-all-closed",
  () => {
    if (
      process.platform !==
      "darwin"
    ) {
      app.quit();
    }
  },
);

app.on(
  "before-quit",
  () => {
    if (playwrightManager) {
      void playwrightManager.close();
      playwrightManager = null;
    }
  },
);