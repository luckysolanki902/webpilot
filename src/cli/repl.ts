import * as readline from "node:readline";
import chalk from "chalk";
import { BrowserEngine } from "../core/browser.js";
import { PageAnalyzer } from "../core/analyzer.js";
import { StateDiffer } from "../core/differ.js";
import { parseCommand, executeCommand } from "../commands/router.js";
import {
  renderPageState,
  renderDiff,
  renderError,
  renderMessage,
} from "../renderers/render.js";
import type { WebpilotConfig } from "../core/types.js";

export async function startRepl(config: WebpilotConfig): Promise<void> {
  const browser = new BrowserEngine(config);
  const differ = new StateDiffer();
  let analyzer: PageAnalyzer;

  console.log(chalk.bold.cyan("\n  ⚡ Webpilot"));
  console.log(chalk.dim("  The web, through the eyes of a machine.\n"));

  try {
    console.log(chalk.dim("  Launching browser..."));
    await browser.launch();
    analyzer = new PageAnalyzer(browser);

    // Navigate to initial URL if provided
    if (config.url) {
      console.log(chalk.dim(`  Navigating to ${config.url}...`));
      await browser.goto(config.url);
      const state = await analyzer.analyze();
      differ.computeDiff(state); // initialize differ
      console.log(renderPageState(state, config.mode));
    } else {
      console.log(chalk.dim('  Ready. Type "goto <url>" to start browsing.\n'));
    }
  } catch (err) {
    console.error(
      renderError(
        `Failed to launch browser: ${err instanceof Error ? err.message : String(err)}`,
        config.mode
      )
    );
    process.exit(1);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan("webpilot") + chalk.dim(" > "),
    historySize: 200,
  });

  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();

    // Exit commands
    if (input === "exit" || input === "quit" || input === "q") {
      console.log(chalk.dim("\n  Closing browser..."));
      await browser.close();
      rl.close();
      process.exit(0);
    }

    if (!input) {
      rl.prompt();
      return;
    }

    const cmd = parseCommand(input);
    const result = await executeCommand(cmd, browser, analyzer, differ, config.mode);

    if (!result.success && result.error) {
      console.log(renderError(result.error, config.mode));
    }

    if (result.diff && StateDiffer.hasChanges(result.diff)) {
      console.log(renderDiff(result.diff, config.mode));
    }

    if (result.pageState) {
      console.log(renderPageState(result.pageState, config.mode));
    }

    if (result.data && !result.pageState) {
      if (typeof result.data === "string") {
        console.log(result.data);
      } else {
        console.log(JSON.stringify(result.data, null, 2));
      }
    } else if (result.message && !result.pageState) {
      console.log(renderMessage(result.message, config.mode));
    }

    rl.prompt();
  });

  rl.on("close", async () => {
    await browser.close();
    process.exit(0);
  });

  // Handle Ctrl+C gracefully
  process.on("SIGINT", async () => {
    console.log(chalk.dim("\n  Shutting down..."));
    await browser.close();
    process.exit(0);
  });
}
