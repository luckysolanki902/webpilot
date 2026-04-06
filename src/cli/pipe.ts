import { BrowserEngine } from "../core/browser.js";
import { PageAnalyzer } from "../core/analyzer.js";
import { StateDiffer } from "../core/differ.js";
import { parseCommand, executeCommand } from "../commands/router.js";
import { renderPageState, renderDiff, renderError } from "../renderers/render.js";
import type { WebpilotConfig } from "../core/types.js";

/**
 * Pipe mode: reads commands from stdin line by line, outputs results to stdout.
 * Designed for scripting: echo "goto https://google.com\nclick [3]" | webpilot --pipe
 */
export async function startPipeMode(config: WebpilotConfig): Promise<void> {
  const pipeConfig = { ...config, mode: "pipe" as const };
  const browser = new BrowserEngine(pipeConfig);
  const differ = new StateDiffer();

  try {
    await browser.launch();
    const analyzer = new PageAnalyzer(browser);

    // Navigate to initial URL if provided
    if (config.url) {
      await browser.goto(config.url);
      const state = await analyzer.analyze();
      differ.computeDiff(state);
      console.log(renderPageState(state, "pipe"));
    }

    // Read commands from stdin
    const lines = await readStdin();

    for (const line of lines) {
      const input = line.trim();
      if (!input || input === "exit" || input === "quit") continue;

      const cmd = parseCommand(input);
      const result = await executeCommand(cmd, browser, analyzer, differ, "pipe");

      if (!result.success && result.error) {
        console.log(renderError(result.error, "pipe"));
        continue;
      }

      if (result.diff && StateDiffer.hasChanges(result.diff)) {
        console.log(renderDiff(result.diff, "pipe"));
      }

      if (result.pageState) {
        console.log(renderPageState(result.pageState, "pipe"));
      }

      if (result.data && !result.pageState) {
        console.log(typeof result.data === "string" ? result.data : JSON.stringify(result.data, null, 2));
      } else if (result.message && !result.pageState) {
        console.log(result.message);
      }
    }

    await browser.close();
  } catch (err) {
    console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    await browser.close();
    process.exit(1);
  }
}

function readStdin(): Promise<string[]> {
  return new Promise((resolve) => {
    const lines: string[] = [];
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => {
      lines.push(...chunk.toString().split("\n"));
    });
    process.stdin.on("end", () => resolve(lines));

    // If stdin is a TTY (shouldn't happen in pipe mode, but just in case)
    if (process.stdin.isTTY) {
      resolve([]);
    }
  });
}
