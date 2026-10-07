import { chromium, type Browser, type Locator, type Page } from "playwright";

export interface InteractiveElement {
  id: string;
  role: string;
  name: string;
  text: string;
  tag: string;
  type?: string;
  placeholder?: string;
  value?: string;
  href?: string;
  disabled?: boolean;
  checked?: boolean;
  pressed?: boolean;
}

export interface MediaState {
  tag: "video" | "audio";
  currentTime: number;
  duration: number;
  paused: boolean;
  muted: boolean;
  volume: number;
  src: string;
}

export interface PageSnapshot {
  url: string;
  title: string;
  text: string;
  media: MediaState[];
  elements: InteractiveElement[];
}

interface ElementReference {
  page: Page;
  locator: Locator;
  meta: InteractiveElement;
}

export class PlaywrightManager {
  private browser: Browser | null = null;
  private currentPage: Page | null = null;

  private elementRefs = new Map<string, ElementReference>();

  // --------------------------------------------------
  // CONNECTION
  // --------------------------------------------------

  async connect(): Promise<void> {
    if (this.browser) {
      return;
    }

    console.log("[Playwright] Connecting to Electron Chromium...");

    this.browser = await chromium.connectOverCDP("http://127.0.0.1:9222");

    console.log("[Playwright] Connected.");

    console.log("[Playwright] Contexts:", this.browser.contexts().length);

    await this.findCurrentPage();
  }

  // --------------------------------------------------
  // CURRENT PAGE
  // --------------------------------------------------

  private async findCurrentPage(): Promise<Page> {
    if (this.currentPage && !this.currentPage.isClosed()) {
      return this.currentPage;
    }

    if (!this.browser) {
      await this.connect();
    }

    if (!this.browser) {
      throw new Error("Playwright browser connection unavailable.");
    }

    const contexts = this.browser.contexts();

    if (contexts.length === 0) {
      throw new Error("No Playwright browser context found.");
    }

    const context = contexts[0];

    const pages = context.pages();

    console.log(
      "[Playwright] Pages:",
      pages.map((page) => page.url()),
    );

    /*
     * Prefer the external browser page.
     *
     * The React UI itself is also a Playwright page,
     * so we must never accidentally operate on it.
     */
    const externalPage = pages.find((page) => {
      const url = page.url();

      return (
        (url.startsWith("http://") || url.startsWith("https://")) &&
        !url.includes("127.0.0.1:5173") &&
        !url.includes("localhost:5173")
      );
    });

    if (externalPage) {
      this.currentPage = externalPage;

      return externalPage;
    }

    if (pages.length > 0) {
      this.currentPage = pages[pages.length - 1];

      return this.currentPage;
    }

    throw new Error("No browser page found.");
  }

  async getBrowserPage(): Promise<Page> {
    return this.findCurrentPage();
  }

  // --------------------------------------------------
  // PAGE INFO
  // --------------------------------------------------

  async getPageInfo(): Promise<{
    url: string;
    title: string;
  }> {
    const page = await this.getBrowserPage();

    return {
      url: page.url(),
      title: await page.title(),
    };
  }

  /*
   * Keeps Playwright's current page synchronized
   * with the page currently visible in Electron.
   *
   * IMPORTANT:
   * This does NOT navigate anywhere.
   *
   * It only finds the page that already exists.
   */
  async syncVisibleUrl(visibleUrl?: string): Promise<{
    url: string;
    title: string;
  }> {
    if (!this.browser) {
      await this.connect();
    }

    if (!this.browser) {
      throw new Error("Playwright browser connection unavailable.");
    }

    const contexts = this.browser.contexts();

    if (contexts.length === 0) {
      throw new Error("No Playwright browser context found.");
    }

    const pages = contexts[0].pages();

    /*
     * If Electron tells us exactly which URL is visible,
     * prefer the page with that URL.
     */
    if (visibleUrl) {
      const matchingPage = pages.find(
        (page) => !page.isClosed() && page.url() === visibleUrl,
      );

      if (matchingPage) {
        this.currentPage = matchingPage;

        return {
          url: matchingPage.url(),
          title: await matchingPage.title(),
        };
      }
    }

    /*
     * Otherwise preserve the existing current page
     * whenever possible.
     */
    if (this.currentPage && !this.currentPage.isClosed()) {
      return {
        url: this.currentPage.url(),
        title: await this.currentPage.title(),
      };
    }

    const page = await this.findCurrentPage();

    return {
      url: page.url(),
      title: await page.title(),
    };
  }

  // --------------------------------------------------
  // MEDIA
  // --------------------------------------------------

  private async getMediaState(page: Page): Promise<MediaState[]> {
    return page
      .locator("video, audio")
      .evaluateAll((elements) => {
        return elements.slice(0, 10).map((element) => {
          const media = element as HTMLMediaElement;

          return {
            tag: media.tagName.toLowerCase() as "video" | "audio",

            currentTime: Number.isFinite(media.currentTime)
              ? media.currentTime
              : 0,

            duration: Number.isFinite(media.duration) ? media.duration : 0,

            paused: media.paused,

            muted: media.muted,

            volume: media.volume,

            src: media.currentSrc || media.src || "",
          };
        });
      })
      .catch(() => []);
  }

  // --------------------------------------------------
  // PAGE STATE
  // --------------------------------------------------

  async getPageState(): Promise<{
    url: string;
    title: string;
    media: MediaState[];
  }> {
    const page = await this.getBrowserPage();

    return {
      url: page.url(),

      title: await page.title(),

      media: await this.getMediaState(page),
    };
  }

  // --------------------------------------------------
  // INSPECTION
  // --------------------------------------------------

  async inspectPage(): Promise<PageSnapshot> {
    const page = await this.getBrowserPage();

    /*
     * IDs only live for the current inspection.
     */
    this.elementRefs.clear();

    const url = page.url();

    const title = await page.title();

    const text = await page
      .locator("body")
      .innerText()
      .catch(() => "");

    const media = await this.getMediaState(page);

    const elements = await this.collectInteractiveElements(page);

    return {
      url,
      title,
      text: text.slice(0, 5000),
      media,
      elements,
    };
  }

  // --------------------------------------------------
  // INTERACTIVE ELEMENT DISCOVERY
  // --------------------------------------------------

  private async collectInteractiveElements(
    page: Page,
  ): Promise<InteractiveElement[]> {
    const selector = [
      "button",
      "[role='button']",
      "a",
      "input",
      "textarea",
      "select",
      "[contenteditable='true']",
      "[role='checkbox']",
      "[role='radio']",
      "[role='switch']",
      "[role='combobox']",
      "[role='tab']",
      "[role='menuitem']",
    ].join(",");

    const candidates = page.locator(selector);

    const count = Math.min(await candidates.count(), 150);

    const result: InteractiveElement[] = [];

    for (let index = 0; index < count; index++) {
      const candidate = candidates.nth(index);

      try {
        if (!(await candidate.isVisible())) {
          continue;
        }

        const metadata = await candidate.evaluate((element) => {
          const el = element as HTMLElement &
            HTMLInputElement &
            HTMLButtonElement;

          const tag = element.tagName.toLowerCase();

          const explicitRole = element.getAttribute("role");

          const type = element.getAttribute("type") ?? undefined;

          let role = explicitRole ?? "";

          if (!role) {
            if (tag === "button") {
              role = "button";
            } else if (tag === "a") {
              role = "link";
            } else if (tag === "textarea") {
              role = "textbox";
            } else if (tag === "select") {
              role = "combobox";
            } else if (tag === "input") {
              if (type === "checkbox") {
                role = "checkbox";
              } else if (type === "radio") {
                role = "radio";
              } else if (type === "search") {
                role = "searchbox";
              } else {
                role = "textbox";
              }
            } else if (element.getAttribute("contenteditable") === "true") {
              role = "textbox";
            }
          }

          const ariaLabel = element.getAttribute("aria-label");

          const title = element.getAttribute("title");

          const placeholder = element.getAttribute("placeholder") ?? undefined;

          const text = (element.textContent ?? "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 300);

          let name = ariaLabel || title || placeholder || text;

          if (!name && "value" in element) {
            name = String((el as HTMLInputElement).value ?? "");
          }

          const href =
            tag === "a"
              ? (element.getAttribute("href") ?? undefined)
              : undefined;

          const disabled =
            "disabled" in el
              ? Boolean(el.disabled)
              : element.getAttribute("aria-disabled") === "true";

          const checked =
            "checked" in el
              ? Boolean(el.checked)
              : element.getAttribute("aria-checked") === "true";

          const pressed = element.getAttribute("aria-pressed") === "true";

          return {
            role,
            name: name.slice(0, 200),
            text,
            tag,
            type,
            placeholder,
            value:
              "value" in element
                ? String((el as HTMLInputElement).value ?? "")
                : undefined,
            href,
            disabled,
            checked,
            pressed,
          };
        });

        if (
          !metadata.name &&
          metadata.role !== "textbox" &&
          metadata.role !== "searchbox"
        ) {
          continue;
        }

        const id = `e${result.length + 1}`;

        /*
         * Keep the exact candidate locator.
         *
         * This is important for dynamic sites like
         * YouTube where many buttons may have similar
         * names.
         */
        const locator = candidate;

        const element: InteractiveElement = {
          id,
          ...metadata,
        };

        this.elementRefs.set(id, {
          page,
          locator,
          meta: element,
        });

        result.push(element);
      } catch {
        // Dynamic element disappeared.
      }
    }

    return result;
  }

  // --------------------------------------------------
  // ELEMENT LOOKUP
  // --------------------------------------------------

  private async getElement(elementId: string): Promise<{
    locator: Locator;
    meta: InteractiveElement;
  }> {
    const reference = this.elementRefs.get(elementId);

    if (!reference) {
      throw new Error(
        `Element ${elementId} is no longer available. Inspect the page again.`,
      );
    }

    const currentPage = await this.getBrowserPage();

    if (reference.page !== currentPage) {
      throw new Error(
        `Element ${elementId} belongs to an old page. Inspect the current page again.`,
      );
    }

    return {
      locator: reference.locator,

      meta: reference.meta,
    };
  }

  // --------------------------------------------------
  // ELEMENT STATE
  // --------------------------------------------------

  private async getElementState(
    locator: Locator,
  ): Promise<Record<string, unknown>> {
    try {
      return await locator.evaluate((element) => {
        const el = element as HTMLElement &
          HTMLInputElement &
          HTMLButtonElement;

        return {
          tag: element.tagName.toLowerCase(),

          text: (element.textContent ?? "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 300),

          ariaPressed: element.getAttribute("aria-pressed"),

          ariaChecked: element.getAttribute("aria-checked"),

          ariaExpanded: element.getAttribute("aria-expanded"),

          disabled:
            "disabled" in element
              ? Boolean(el.disabled)
              : element.getAttribute("aria-disabled") === "true",

          value: "value" in element ? String(el.value ?? "") : undefined,
        };
      });
    } catch {
      return {};
    }
  }

  // --------------------------------------------------
  // CLICK
  // --------------------------------------------------

  async clickElement(elementId: string) {
    try {
      const { locator, meta } = await this.getElement(elementId);

      const before = await this.getElementState(locator);

      await locator.click({
        timeout: 10000,
      });

      await this.waitForUI();

      const after = await this.getElementState(locator);

      const page = await this.getBrowserPage();

      /*
       * DOM may have completely changed.
       * IDs must therefore be regenerated.
       */
      this.elementRefs.clear();

      return {
        success: true,

        element: meta,

        before,

        after,

        page: {
          url: page.url(),
          title: await page.title(),
        },
      };
    } catch (error) {
      return {
        success: false,

        error: error instanceof Error ? error.message : String(error),

        instruction:
          "Inspect the current page again and retry with a current element ID.",
      };
    }
  }

  // --------------------------------------------------
  // FILL
  // --------------------------------------------------

  async fillElement(elementId: string, value: string) {
    try {
      const { locator, meta } = await this.getElement(elementId);

      await locator.fill(value, {
        timeout: 10000,
      });

      await this.waitForUI();

      const state = await this.getElementState(locator);

      const page = await this.getBrowserPage();

      this.elementRefs.clear();

      return {
        success: true,
        element: meta,
        value,
        state,

        page: {
          url: page.url(),
          title: await page.title(),
        },
      };
    } catch (error) {
      return {
        success: false,

        error: error instanceof Error ? error.message : String(error),

        instruction:
          "Inspect the current page again and retry with a current element ID.",
      };
    }
  }

  // --------------------------------------------------
  // KEYBOARD
  // --------------------------------------------------

  async pressElement(elementId: string, key: string) {
    try {
      const { locator, meta } = await this.getElement(elementId);

      await locator.press(key, {
        timeout: 10000,
      });

      await this.waitForUI();

      const state = await this.getElementState(locator);

      const page = await this.getBrowserPage();

      this.elementRefs.clear();

      return {
        success: true,
        element: meta,
        key,
        state,

        page: {
          url: page.url(),
          title: await page.title(),
        },
      };
    } catch (error) {
      return {
        success: false,

        error: error instanceof Error ? error.message : String(error),

        instruction:
          "Inspect the current page again and retry with a current element ID.",
      };
    }
  }

  // --------------------------------------------------
  // CHECK
  // --------------------------------------------------

  async checkElement(elementId: string) {
    try {
      const { locator, meta } = await this.getElement(elementId);

      await locator.check({
        timeout: 10000,
      });

      await this.waitForUI();

      const state = await this.getElementState(locator);

      this.elementRefs.clear();

      return {
        success: true,
        element: meta,
        state,
      };
    } catch (error) {
      return {
        success: false,

        error: error instanceof Error ? error.message : String(error),

        instruction:
          "Inspect the current page again and retry with a current element ID.",
      };
    }
  }

  // --------------------------------------------------
  // UNCHECK
  // --------------------------------------------------

  async uncheckElement(elementId: string) {
    try {
      const { locator, meta } = await this.getElement(elementId);

      await locator.uncheck({
        timeout: 10000,
      });

      await this.waitForUI();

      const state = await this.getElementState(locator);

      this.elementRefs.clear();

      return {
        success: true,
        element: meta,
        state,
      };
    } catch (error) {
      return {
        success: false,

        error: error instanceof Error ? error.message : String(error),

        instruction:
          "Inspect the current page again and retry with a current element ID.",
      };
    }
  }

  // --------------------------------------------------
  // SELECT
  // --------------------------------------------------

  async selectElement(elementId: string, value: string) {
    try {
      const { locator, meta } = await this.getElement(elementId);

      await locator.selectOption(value, {
        timeout: 10000,
      });

      await this.waitForUI();

      const state = await this.getElementState(locator);

      this.elementRefs.clear();

      return {
        success: true,
        element: meta,
        value,
        state,
      };
    } catch (error) {
      return {
        success: false,

        error: error instanceof Error ? error.message : String(error),

        instruction:
          "Inspect the current page again and retry with a current element ID.",
      };
    }
  }

  // --------------------------------------------------
  // NAVIGATION
  // --------------------------------------------------

  async navigate(url: string): Promise<string> {
    const page = await this.getBrowserPage();

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    this.elementRefs.clear();

    this.currentPage = page;

    return page.url();
  }

  // --------------------------------------------------
  // SCREENSHOT
  // --------------------------------------------------

  async screenshot(): Promise<string> {
    const page = await this.getBrowserPage();

    const buffer = await page.screenshot({
      type: "png",
    });

    return buffer.toString("base64");
  }

  // --------------------------------------------------
  // UI WAIT
  // --------------------------------------------------

  private async waitForUI(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 350));
  }

  // --------------------------------------------------
  // CLOSE
  // --------------------------------------------------

  async close(): Promise<void> {
    if (!this.browser) {
      return;
    }

    try {
      await this.browser.close();
    } catch {
      // Ignore shutdown errors.
    }

    this.browser = null;
    this.currentPage = null;
    this.elementRefs.clear();
  }
}
