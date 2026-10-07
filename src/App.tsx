import { useEffect, useState } from "react";

type AgentEvent = {
  type: "thinking" | "tool-start" | "tool-end" | "finished" | "error";

  tool?: string;
  input?: unknown;
  output?: unknown;
  message?: string;
};

type Message = {
  role: "user" | "assistant";
  content: string;
};

declare global {
  interface Window {
    vangrex: {
      browser: {
        navigate: (url: string) => Promise<unknown>;

        getUrl: () => Promise<string>;
      };

      agent: {
        run: (instruction: string) => Promise<{
          success: boolean;
          text?: string;
          error?: string;
        }>;

        onEvent: (callback: (event: unknown) => void) => () => void;
      };
    };
  }
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);

  const [input, setInput] = useState("");

  const [events, setEvents] = useState<AgentEvent[]>([]);

  const [running, setRunning] = useState(false);

  useEffect(() => {
    return window.vangrex.agent.onEvent((event) => {
      const typed = event as AgentEvent;

      setEvents((current) => [...current, typed]);
    });
  }, []);

  async function send() {
    const instruction = input.trim();

    if (!instruction || running) {
      return;
    }

    setInput("");

    setMessages((current) => [
      ...current,
      {
        role: "user",
        content: instruction,
      },
    ]);

    setEvents([]);

    setRunning(true);

    try {
      const result = await window.vangrex.agent.run(instruction);

      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: result.success
            ? (result.text ?? "Task completed.")
            : `Error: ${result.error ?? "Unknown error"}`,
        },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: error instanceof Error ? error.message : String(error),
        },
      ]);
    } finally {
      setRunning(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  return (
    <div className="app">
      <section className="browser-panel">
        <div className="browser-overlay">
          <div className="brand">VANGREX</div>

          <div className="live">● LIVE PLAYWRIGHT</div>
        </div>
      </section>

      <aside className="assistant-panel">
        <header>
          <div>
            <strong>Vangrex Browser Agent</strong>

            <span>Playwright + AI SDK</span>
          </div>

          <div className={running ? "status running" : "status"}>
            {running ? "WORKING" : "READY"}
          </div>
        </header>

        <main className="chat">
          {messages.length === 0 && (
            <div className="empty">
              <h1>What should I do?</h1>

              <p>Tell Vangrex to operate the visible browser.</p>

              <div className="examples">
                <button
                  onClick={() =>
                    setInput("Open YouTube and search for Call of Duty.")
                  }
                >
                  Search YouTube
                </button>

                <button
                  onClick={() =>
                    setInput("Open GitHub and search for Next.js.")
                  }
                >
                  Search GitHub
                </button>
              </div>
            </div>
          )}

          {messages.map((message, index) => (
            <div key={index} className={`message ${message.role}`}>
              {message.content}
            </div>
          ))}

          {events.length > 0 && (
            <div className="activity">
              <div className="activity-title">Live execution</div>

              {events.map((event, index) => (
                <div key={index} className="event">
                  <span>{event.type}</span>

                  {event.tool && <strong>{event.tool}</strong>}

                  {event.message && <small>{event.message}</small>}
                </div>
              ))}
            </div>
          )}
        </main>

        <footer>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Tell Vangrex what to do..."
            disabled={running}
          />

          <button
            onClick={() => void send()}
            disabled={running || !input.trim()}
          >
            {running ? "Running..." : "Run"}
          </button>
        </footer>
      </aside>
    </div>
  );
}
