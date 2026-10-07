import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";
import { PlaywrightManager } from "../browser/playwright-manager";


export interface AgentEvent {
  type:
    | "thinking"
    | "page-state"
    | "action"
    | "navigation"
    | "completed"
    | "error";

  message: string;
  data?: unknown;
}

export class BrowserAgent {
  private browser: PlaywrightManager;
  private emitEvent: (event: AgentEvent) => void;

  constructor(
    browser: PlaywrightManager,
    emitEvent: (event: AgentEvent) => void,
  ) {
    this.browser = browser;
    this.emitEvent = emitEvent;
  }

  private emit(event: AgentEvent): void {
    this.emitEvent(event);
  }

  async run(instruction: string): Promise<string> {
    if (!instruction.trim()) {
      throw new Error("Instruction is empty.");
    }

    this.emit({
      type: "thinking",
      message: "Inspecting the current browser page...",
    });

    /*
     * IMPORTANT:
     *
     * Always inspect the CURRENT page first.
     *
     * This is what prevents:
     *
     * "Like this video"
     *
     * from reopening YouTube from scratch.
     *
     * The model receives the exact page that is currently
     * visible in the Electron browser.
     */
    const snapshot = await this.browser.inspectPage();

    this.emit({
      type: "page-state",
      message: "Current browser page inspected.",
      data: snapshot,
    });

    const googleApiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;

    if (!googleApiKey) {
      throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is missing from .env");
    }

    const google = createGoogleGenerativeAI({
      apiKey: googleApiKey,
    });

    /*
     * Keep the model name that your project was already using.
     *
     * If you are using a different Gemini model in your .env/project,
     * change only this line.
     */
    const model = google("gemini-3.5-flash-lite");

    const system = `
You are Vangrex, a desktop browser agent.

You control the user's CURRENT VISIBLE browser using Playwright.

==================================================
MOST IMPORTANT RULE
==================================================

The CURRENT PAGE is authoritative.

NEVER reopen, reset, or navigate to a website simply because
the user mentions that website.

For example:

User:
"Like this video"

If YouTube is already open with a video playing:

DO NOT:
- navigate to youtube.com
- search for the video again
- open a new page
- reload the page

INSTEAD:
- inspect the current page
- find the Like button on the current page
- click it
- verify the result

==================================================
WHEN NAVIGATION IS ALLOWED
==================================================

Only use the navigate tool when the user explicitly asks to:

- open a website
- go to a website
- navigate to a URL
- visit a URL
- search for something that requires going somewhere else
- leave the current page for another destination

Examples:

"Open YouTube"
"Go to github.com"
"Search Google for cats"

These can use navigate.

But:

"Like this video"
"Pause the video"
"Subscribe"
"Click the download button"
"Fill this form"
"Press Enter"

MUST operate on the CURRENT PAGE.

==================================================
CURRENT PAGE ACTION WORKFLOW
==================================================

1. Start with the current page snapshot.
2. Look at the current URL and title.
3. Look at the current page's interactive elements.
4. Choose the correct temporary element ID.
5. Perform the action using that element ID.
6. Verify the action using the returned state.
7. If the page changes, inspect the page again before continuing.

==================================================
ELEMENT IDS
==================================================

Element IDs such as:

e1
e2
e3
e17

come from inspectPage.

NEVER invent an element ID.

NEVER invent a CSS selector.

NEVER invent a XPath selector.

Use the element IDs returned by inspectPage.

==================================================
NAVIGATION
==================================================

Do NOT navigate simply to make an action easier.

Do NOT navigate back to a website that is already open.

Navigation is only for explicit navigation requests.

==================================================
VERIFICATION
==================================================

Never claim an action succeeded unless the tool result confirms it.

After clicking:
- inspect the returned state
- check aria-pressed / aria-checked / text / URL / page state
when relevant

After filling:
- verify the value

After navigation:
- verify the URL

==================================================
YOUTUBE
==================================================

YouTube is a dynamic application.

If a video is already playing, preserve the current page.

For requests such as:

"like this video"
"pause"
"resume"
"subscribe"
"open comments"
"click share"

operate on the current YouTube page.

Do NOT reopen YouTube.

Do NOT search for the video again.

Do NOT reset the playback position.

==================================================
GENERAL
==================================================

Perform real browser actions.

Do not merely describe what should be done.

Keep actions focused.

If an action cannot be safely identified, inspect the page again.

Never claim success without verification.
`;

    const tools = {
      /*
       * ==============================================
       * GET CURRENT PAGE
       * ==============================================
       */
      getPage: tool({
        description:
          "Get the current visible browser page state. Use this when you need to refresh the current URL, title, or media state without navigating.",

        inputSchema: z.object({}),

        execute: async () => {
          const result = await this.browser.getPageState();

          this.emit({
            type: "page-state",
            message: "Current page state retrieved.",
            data: result,
          });

          return result;
        },
      }),

      /*
       * ==============================================
       * INSPECT CURRENT PAGE
       * ==============================================
       */
      inspectPage: tool({
        description:
          "Inspect the CURRENT visible page. Returns the current URL, title, media state, text, and interactive elements with temporary IDs. Always use this before choosing an element to interact with.",

        inputSchema: z.object({}),

        execute: async () => {
          const result = await this.browser.inspectPage();

          this.emit({
            type: "page-state",
            message: "Current page inspected.",
            data: result,
          });

          return result;
        },
      }),

      /*
       * ==============================================
       * NAVIGATE
       * ==============================================
       */
      navigate: tool({
        description:
          "Navigate the CURRENT visible browser page to a URL. ONLY use this when the user explicitly asks to open, visit, go to, navigate to, or search for another destination.",

        inputSchema: z.object({
          url: z.string().describe("The complete URL to navigate to."),
        }),

        execute: async ({ url }: { url: string }) => {
          let targetUrl = url.trim();

          if (
            !targetUrl.startsWith("http://") &&
            !targetUrl.startsWith("https://")
          ) {
            targetUrl = `https://${targetUrl}`;
          }

          this.emit({
            type: "navigation",
            message: `Navigating to ${targetUrl}`,
            data: {
              url: targetUrl,
            },
          });

          const finalUrl = await this.browser.navigate(targetUrl);

          const page = await this.browser.getPageState();

          this.emit({
            type: "navigation",
            message: `Navigation completed: ${finalUrl}`,
            data: page,
          });

          return {
            success: true,
            url: finalUrl,
            title: page.title,
          };
        },
      }),

      /*
       * ==============================================
       * CLICK
       * ==============================================
       */
      clickElement: tool({
        description:
          "Click an element on the CURRENT visible page. The elementId MUST come from inspectPage. Do not invent selectors or IDs.",

        inputSchema: z.object({
          elementId: z
            .string()
            .describe(
              "Temporary element ID returned by inspectPage, for example e12.",
            ),
        }),

        execute: async ({ elementId }: { elementId: string }) => {
          this.emit({
            type: "action",
            message: `Clicking ${elementId}...`,
            data: {
              elementId,
            },
          });

          const result = await this.browser.clickElement(elementId);

          this.emit({
            type: "action",
            message: result.success
              ? `Clicked ${elementId}.`
              : `Failed to click ${elementId}.`,
            data: result,
          });

          return result;
        },
      }),

      /*
       * ==============================================
       * FILL
       * ==============================================
       */
      fillElement: tool({
        description:
          "Fill a textbox, search box, textarea, or editable element on the CURRENT visible page. The elementId MUST come from inspectPage.",

        inputSchema: z.object({
          elementId: z
            .string()
            .describe("Temporary element ID returned by inspectPage."),

          value: z.string().describe("The text to enter into the element."),
        }),

        execute: async ({
          elementId,
          value,
        }: {
          elementId: string;
          value: string;
        }) => {
          this.emit({
            type: "action",
            message: `Filling ${elementId}...`,
            data: {
              elementId,
              value,
            },
          });

          const result = await this.browser.fillElement(elementId, value);

          this.emit({
            type: "action",
            message: result.success
              ? `Filled ${elementId}.`
              : `Failed to fill ${elementId}.`,
            data: result,
          });

          return result;
        },
      }),

      /*
       * ==============================================
       * PRESS KEY
       * ==============================================
       */
      pressElement: tool({
        description:
          "Press a keyboard key on an element on the CURRENT visible page. The elementId MUST come from inspectPage. Examples of keys: Enter, Escape, Tab, ArrowDown, Space.",

        inputSchema: z.object({
          elementId: z
            .string()
            .describe("Temporary element ID returned by inspectPage."),

          key: z
            .string()
            .describe(
              "Keyboard key to press, such as Enter, Escape, Tab, Space, or ArrowDown.",
            ),
        }),

        execute: async ({
          elementId,
          key,
        }: {
          elementId: string;
          key: string;
        }) => {
          this.emit({
            type: "action",
            message: `Pressing ${key} on ${elementId}...`,
            data: {
              elementId,
              key,
            },
          });

          const result = await this.browser.pressElement(elementId, key);

          this.emit({
            type: "action",
            message: result.success
              ? `Pressed ${key}.`
              : `Failed to press ${key}.`,
            data: result,
          });

          return result;
        },
      }),

      /*
       * ==============================================
       * CHECK
       * ==============================================
       */
      checkElement: tool({
        description:
          "Check a checkbox or compatible control on the CURRENT visible page. The elementId MUST come from inspectPage.",

        inputSchema: z.object({
          elementId: z
            .string()
            .describe("Temporary checkbox element ID returned by inspectPage."),
        }),

        execute: async ({ elementId }: { elementId: string }) => {
          this.emit({
            type: "action",
            message: `Checking ${elementId}...`,
            data: {
              elementId,
            },
          });

          const result = await this.browser.checkElement(elementId);

          this.emit({
            type: "action",
            message: result.success
              ? `Checked ${elementId}.`
              : `Failed to check ${elementId}.`,
            data: result,
          });

          return result;
        },
      }),

      /*
       * ==============================================
       * UNCHECK
       * ==============================================
       */
      uncheckElement: tool({
        description:
          "Uncheck a checkbox or compatible control on the CURRENT visible page. The elementId MUST come from inspectPage.",

        inputSchema: z.object({
          elementId: z
            .string()
            .describe("Temporary checkbox element ID returned by inspectPage."),
        }),

        execute: async ({ elementId }: { elementId: string }) => {
          this.emit({
            type: "action",
            message: `Unchecking ${elementId}...`,
            data: {
              elementId,
            },
          });

          const result = await this.browser.uncheckElement(elementId);

          this.emit({
            type: "action",
            message: result.success
              ? `Unchecked ${elementId}.`
              : `Failed to uncheck ${elementId}.`,
            data: result,
          });

          return result;
        },
      }),

      /*
       * ==============================================
       * SELECT
       * ==============================================
       */
      selectElement: tool({
        description:
          "Select an option in a select/combobox on the CURRENT visible page. The elementId MUST come from inspectPage.",

        inputSchema: z.object({
          elementId: z
            .string()
            .describe("Temporary select element ID returned by inspectPage."),

          value: z.string().describe("Option value or label to select."),
        }),

        execute: async ({
          elementId,
          value,
        }: {
          elementId: string;
          value: string;
        }) => {
          this.emit({
            type: "action",
            message: `Selecting ${value} in ${elementId}...`,
            data: {
              elementId,
              value,
            },
          });

          const result = await this.browser.selectElement(elementId, value);

          this.emit({
            type: "action",
            message: result.success
              ? `Selected ${value}.`
              : `Failed to select ${value}.`,
            data: result,
          });

          return result;
        },
      }),
    };

    try {
      const result = await generateText({
        model,

        system,

        prompt: `
CURRENT VISIBLE BROWSER STATE:

${JSON.stringify(snapshot, null, 2)}

==================================================

USER REQUEST:

${instruction}

==================================================

Execute the user's request on the CURRENT browser page.

Remember:

- Do not navigate unless navigation was explicitly requested.
- Use the element IDs from the current page snapshot.
- Never invent selectors.
- Verify actions.
`,

        tools,

        /*
         * Multiple steps are required:
         *
         * inspect
         * -> click
         * -> verify
         * -> possibly inspect again
         */
        stopWhen: stepCountIs(12),

        maxOutputTokens: 1200,
      });

      const response = result.text?.trim() || "Task completed.";

      this.emit({
        type: "completed",
        message: response,
        data: {
          steps: result.steps?.length ?? 0,
        },
      });

      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      this.emit({
        type: "error",
        message,
        data: error,
      });

      throw error;
    }
  }
}
