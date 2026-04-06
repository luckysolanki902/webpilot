import type { BrowserEngine } from "../core/browser.js";
import type { PageAnalyzer } from "../core/analyzer.js";
import type { StateDiffer } from "../core/differ.js";
import type { CommandResult, OutputMode } from "../core/types.js";

export interface ParsedCommand {
  name: string;
  args: string[];
  flags: Record<string, string | boolean>;
}

export function parseCommand(input: string): ParsedCommand {
  const trimmed = input.trim();
  if (!trimmed) return { name: "", args: [], flags: {} };

  const tokens: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";

  for (const char of trimmed) {
    if (inQuote) {
      if (char === quoteChar) {
        inQuote = false;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      inQuote = true;
      quoteChar = char;
    } else if (char === " ") {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (current) tokens.push(current);

  const name = tokens[0]?.toLowerCase() || "";
  const args: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.startsWith("--")) {
      const eqIndex = token.indexOf("=");
      if (eqIndex > -1) {
        flags[token.slice(2, eqIndex)] = token.slice(eqIndex + 1);
      } else {
        flags[token.slice(2)] = true;
      }
    } else {
      args.push(token);
    }
  }

  return { name, args, flags };
}

export async function executeCommand(
  cmd: ParsedCommand,
  browser: BrowserEngine,
  analyzer: PageAnalyzer,
  differ: StateDiffer,
  mode: OutputMode
): Promise<CommandResult> {
  try {
    switch (cmd.name) {
      case "goto":
      case "go":
      case "navigate":
      case "nav":
        return await cmdGoto(cmd, browser, analyzer, differ);

      case "click":
      case "c":
        return await cmdClick(cmd, browser, analyzer, differ);

      case "type":
      case "t":
        return await cmdType(cmd, browser, analyzer, differ);

      case "select":
        return await cmdSelect(cmd, browser, analyzer, differ);

      case "check":
        return await cmdCheck(cmd, browser, analyzer, differ);

      case "hover":
        return await cmdHover(cmd, browser, analyzer, differ);

      case "press":
        return await cmdPress(cmd, browser, analyzer, differ);

      case "back":
        return await cmdBack(browser, analyzer, differ);

      case "forward":
        return await cmdForward(browser, analyzer, differ);

      case "refresh":
      case "reload":
        return await cmdRefresh(browser, analyzer, differ);

      case "show":
      case "s":
      case "page":
        return await cmdShow(analyzer);

      case "scroll":
        return await cmdScroll(cmd, browser, analyzer);

      case "find":
      case "search":
        return await cmdFind(cmd, analyzer);

      case "extract":
        return await cmdExtract(cmd, browser);

      case "eval":
      case "js":
        return await cmdEval(cmd, browser);

      case "screenshot":
      case "ss":
        return await cmdScreenshot(cmd, browser);

      case "source":
      case "html":
        return await cmdSource(cmd, browser);

      case "tabs":
        return cmdTabs(browser);

      case "tab":
        return await cmdSwitchTab(cmd, browser, analyzer);

      case "newtab":
        return await cmdNewTab(cmd, browser, analyzer, differ);

      case "closetab":
        return await cmdCloseTab(cmd, browser);

      case "help":
      case "?":
        return cmdHelp(cmd);

      case "":
        return { success: true };

      default:
        return {
          success: false,
          error: `Unknown command: '${cmd.name}'. Type 'help' for available commands.`,
        };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

// ─── Command Implementations ───────────────────────────────────

async function cmdGoto(
  cmd: ParsedCommand,
  browser: BrowserEngine,
  analyzer: PageAnalyzer,
  differ: StateDiffer
): Promise<CommandResult> {
  const url = cmd.args[0];
  if (!url) return { success: false, error: "Usage: goto <url>" };

  await browser.goto(url);
  const state = await analyzer.analyze();
  const diff = differ.computeDiff(state);

  return { success: true, pageState: state, diff: diff || undefined };
}

async function cmdClick(
  cmd: ParsedCommand,
  browser: BrowserEngine,
  analyzer: PageAnalyzer,
  differ: StateDiffer
): Promise<CommandResult> {
  const idStr = cmd.args[0]?.replace("[", "").replace("]", "");
  const id = Number(idStr);
  if (!id || isNaN(id)) return { success: false, error: "Usage: click [n]" };

  const selector = analyzer.getSelectorForElement(id);
  await browser.clickElement(selector);

  // Wait a beat for the page to settle
  await new Promise((r) => setTimeout(r, 500));

  const state = await analyzer.analyze();
  const diff = differ.computeDiff(state);

  return { success: true, pageState: state, diff: diff || undefined };
}

async function cmdType(
  cmd: ParsedCommand,
  browser: BrowserEngine,
  analyzer: PageAnalyzer,
  differ: StateDiffer
): Promise<CommandResult> {
  const idStr = cmd.args[0]?.replace("[", "").replace("]", "");
  const id = Number(idStr);
  const text = cmd.args.slice(1).join(" ");

  if (!id || isNaN(id) || !text) {
    return { success: false, error: 'Usage: type [n] "text"' };
  }

  const clear = cmd.flags.append !== true;
  const selector = analyzer.getSelectorForElement(id);

  if (cmd.flags.key) {
    await browser.pressKey(String(cmd.flags.key));
  } else {
    await browser.typeIntoElement(selector, text, clear);
  }

  const state = await analyzer.analyze();
  const diff = differ.computeDiff(state);

  return { success: true, pageState: state, diff: diff || undefined };
}

async function cmdSelect(
  cmd: ParsedCommand,
  browser: BrowserEngine,
  analyzer: PageAnalyzer,
  differ: StateDiffer
): Promise<CommandResult> {
  const idStr = cmd.args[0]?.replace("[", "").replace("]", "");
  const id = Number(idStr);
  const value = cmd.args.slice(1).join(" ");

  if (!id || isNaN(id) || !value) {
    return { success: false, error: 'Usage: select [n] "option"' };
  }

  const selector = analyzer.getSelectorForElement(id);
  await browser.selectOption(selector, value);

  const state = await analyzer.analyze();
  const diff = differ.computeDiff(state);

  return { success: true, pageState: state, diff: diff || undefined };
}

async function cmdCheck(
  cmd: ParsedCommand,
  browser: BrowserEngine,
  analyzer: PageAnalyzer,
  differ: StateDiffer
): Promise<CommandResult> {
  const idStr = cmd.args[0]?.replace("[", "").replace("]", "");
  const id = Number(idStr);
  if (!id || isNaN(id)) return { success: false, error: "Usage: check [n]" };

  const selector = analyzer.getSelectorForElement(id);
  await browser.clickElement(selector);

  const state = await analyzer.analyze();
  const diff = differ.computeDiff(state);

  return { success: true, pageState: state, diff: diff || undefined };
}

async function cmdHover(
  cmd: ParsedCommand,
  browser: BrowserEngine,
  analyzer: PageAnalyzer,
  differ: StateDiffer
): Promise<CommandResult> {
  const idStr = cmd.args[0]?.replace("[", "").replace("]", "");
  const id = Number(idStr);
  if (!id || isNaN(id)) return { success: false, error: "Usage: hover [n]" };

  const selector = analyzer.getSelectorForElement(id);
  await browser.hoverElement(selector);

  const state = await analyzer.analyze();
  const diff = differ.computeDiff(state);

  return { success: true, pageState: state, diff: diff || undefined };
}

async function cmdPress(
  cmd: ParsedCommand,
  browser: BrowserEngine,
  analyzer: PageAnalyzer,
  differ: StateDiffer
): Promise<CommandResult> {
  const key = cmd.args[0];
  if (!key) return { success: false, error: "Usage: press <key>" };

  await browser.pressKey(key);

  const state = await analyzer.analyze();
  const diff = differ.computeDiff(state);

  return { success: true, pageState: state, diff: diff || undefined };
}

async function cmdBack(
  browser: BrowserEngine,
  analyzer: PageAnalyzer,
  differ: StateDiffer
): Promise<CommandResult> {
  await browser.back();
  const state = await analyzer.analyze();
  const diff = differ.computeDiff(state);
  return { success: true, pageState: state, diff: diff || undefined };
}

async function cmdForward(
  browser: BrowserEngine,
  analyzer: PageAnalyzer,
  differ: StateDiffer
): Promise<CommandResult> {
  await browser.forward();
  const state = await analyzer.analyze();
  const diff = differ.computeDiff(state);
  return { success: true, pageState: state, diff: diff || undefined };
}

async function cmdRefresh(
  browser: BrowserEngine,
  analyzer: PageAnalyzer,
  differ: StateDiffer
): Promise<CommandResult> {
  await browser.refresh();
  const state = await analyzer.analyze();
  const diff = differ.computeDiff(state);
  return { success: true, pageState: state, diff: diff || undefined };
}

async function cmdShow(analyzer: PageAnalyzer): Promise<CommandResult> {
  const state = await analyzer.analyze();
  return { success: true, pageState: state };
}

async function cmdScroll(
  cmd: ParsedCommand,
  browser: BrowserEngine,
  analyzer: PageAnalyzer
): Promise<CommandResult> {
  const direction = cmd.args[0] as "up" | "down" | "top" | "bottom";
  if (!direction || !["up", "down", "top", "bottom"].includes(direction)) {
    return { success: false, error: "Usage: scroll <up|down|top|bottom> [amount]" };
  }

  const amount = cmd.args[1] ? Number(cmd.args[1]) : 1;
  await browser.scrollPage(direction, amount);

  const state = await analyzer.analyze();
  return { success: true, pageState: state, message: `Scrolled ${direction}` };
}

async function cmdFind(
  cmd: ParsedCommand,
  analyzer: PageAnalyzer
): Promise<CommandResult> {
  const query = cmd.args.join(" ").toLowerCase();
  if (!query) return { success: false, error: 'Usage: find "text"' };

  const state = await analyzer.analyze();
  const matches = state.elements.filter(
    (el) =>
      el.name.toLowerCase().includes(query) ||
      (el.value && el.value.toLowerCase().includes(query))
  );

  return {
    success: true,
    pageState: { ...state, elements: matches },
    message: `Found ${matches.length} elements matching "${query}"`,
  };
}

async function cmdExtract(
  cmd: ParsedCommand,
  browser: BrowserEngine
): Promise<CommandResult> {
  const type = cmd.flags.links
    ? "links"
    : cmd.flags.tables
      ? "tables"
      : cmd.flags.forms
        ? "forms"
        : cmd.flags.meta
          ? "meta"
          : "text";

  let data: unknown;

  switch (type) {
    case "text":
      data = await browser.evaluate<string>(
        "document.body.innerText"
      );
      break;
    case "links":
      data = await browser.evaluate<Array<{ text: string; url: string }>>(
        `Array.from(document.querySelectorAll('a[href]')).map(a => ({
          text: a.textContent.trim().substring(0, 100),
          url: a.href
        })).filter(l => l.text)`
      );
      break;
    case "tables":
      data = await browser.evaluate<unknown>(
        `Array.from(document.querySelectorAll('table')).map((table, ti) => {
          const rows = Array.from(table.querySelectorAll('tr')).map(tr =>
            Array.from(tr.querySelectorAll('th, td')).map(cell => cell.textContent.trim())
          );
          return { table: ti + 1, rows };
        })`
      );
      break;
    case "forms":
      data = await browser.evaluate<unknown>(
        `Array.from(document.querySelectorAll('form')).map((form, fi) => ({
          form: fi + 1,
          action: form.action,
          method: form.method,
          fields: Array.from(form.querySelectorAll('input, select, textarea')).map(el => ({
            type: el.type || el.tagName.toLowerCase(),
            name: el.name,
            placeholder: el.placeholder,
            value: el.value
          }))
        }))`
      );
      break;
    case "meta":
      data = await browser.evaluate<unknown>(
        `({
          title: document.title,
          description: document.querySelector('meta[name="description"]')?.content || '',
          ogTitle: document.querySelector('meta[property="og:title"]')?.content || '',
          ogDescription: document.querySelector('meta[property="og:description"]')?.content || '',
          ogImage: document.querySelector('meta[property="og:image"]')?.content || '',
          canonical: document.querySelector('link[rel="canonical"]')?.href || '',
          lang: document.documentElement.lang || ''
        })`
      );
      break;
  }

  return { success: true, data, message: `Extracted ${type}` };
}

async function cmdEval(
  cmd: ParsedCommand,
  browser: BrowserEngine
): Promise<CommandResult> {
  const expression = cmd.args.join(" ");
  if (!expression) return { success: false, error: 'Usage: eval "expression"' };

  const result = await browser.evaluate<unknown>(expression);
  return { success: true, data: result, message: String(result) };
}

async function cmdScreenshot(
  cmd: ParsedCommand,
  browser: BrowserEngine
): Promise<CommandResult> {
  const path = cmd.args[0] || "./screenshot.png";
  const fullPage = cmd.flags.full === true;

  await browser.screenshot(path, fullPage);
  return { success: true, message: `Screenshot saved to ${path}` };
}

async function cmdSource(
  cmd: ParsedCommand,
  browser: BrowserEngine
): Promise<CommandResult> {
  const selector = cmd.args[0] || "html";
  const html = await browser.evaluate<string>(
    `document.querySelector('${selector.replace(/'/g, "\\'")}')?.outerHTML || 'Element not found'`
  );
  return { success: true, data: html };
}

function cmdTabs(browser: BrowserEngine): CommandResult {
  const tabs = browser.getTabList();
  return { success: true, data: tabs };
}

async function cmdSwitchTab(
  cmd: ParsedCommand,
  browser: BrowserEngine,
  analyzer: PageAnalyzer
): Promise<CommandResult> {
  const index = Number(cmd.args[0]);
  if (isNaN(index)) return { success: false, error: "Usage: tab <n>" };

  await browser.switchTab(index);
  const state = await analyzer.analyze();
  return { success: true, pageState: state };
}

async function cmdNewTab(
  cmd: ParsedCommand,
  browser: BrowserEngine,
  analyzer: PageAnalyzer,
  differ: StateDiffer
): Promise<CommandResult> {
  const url = cmd.args[0];
  await browser.newTab(url);

  if (url) {
    const state = await analyzer.analyze();
    const diff = differ.computeDiff(state);
    return { success: true, pageState: state, diff: diff || undefined };
  }

  return { success: true, message: "New tab opened" };
}

async function cmdCloseTab(
  cmd: ParsedCommand,
  browser: BrowserEngine
): Promise<CommandResult> {
  const index = cmd.args[0] ? Number(cmd.args[0]) : undefined;
  await browser.closeTab(index);
  return { success: true, message: "Tab closed" };
}

function cmdHelp(cmd: ParsedCommand): CommandResult {
  const topic = cmd.args[0];

  if (topic) {
    const helpTexts: Record<string, string> = {
      goto: "goto <url> — Navigate to a URL\n  Examples: goto google.com, goto :3000, goto https://x.com",
      click: "click [n] — Click element with ID n\n  Examples: click [3], click 3",
      type: 'type [n] "text" — Type text into element n\n  Examples: type [5] "hello"',
      select: 'select [n] "option" — Select dropdown option\n  Examples: select [8] "US"',
      scroll: "scroll <direction> [amount] — Scroll the page\n  Examples: scroll down, scroll up 3, scroll bottom",
      extract: "extract — Extract content from page\n  Flags: --links, --tables, --forms, --meta",
      eval: 'eval "expression" — Execute JavaScript\n  Examples: eval "document.title"',
    };
    return {
      success: true,
      message: helpTexts[topic] || `No help available for '${topic}'`,
    };
  }

  const help = `
NAVIGATION
  goto <url>          Navigate to URL (aliases: go, nav)
  back                Go back
  forward             Go forward
  refresh             Reload page

INTERACTION
  click [n]           Click element (alias: c)
  type [n] "text"     Type into input (alias: t)
  select [n] "opt"    Select dropdown option
  check [n]           Toggle checkbox/radio
  hover [n]           Hover over element
  press <key>         Press keyboard key

VIEWING
  show                Re-display page (alias: s)
  scroll <dir> [n]    Scroll page (up/down/top/bottom)
  find "text"         Search elements on page

EXTRACTION
  extract             Extract text content
  extract --links     Extract all links
  extract --tables    Extract tables
  extract --forms     Extract form fields
  extract --meta      Extract page metadata
  eval "js"           Execute JavaScript
  source              View HTML source
  screenshot [path]   Save screenshot

TABS
  tabs                List open tabs
  tab <n>             Switch to tab
  newtab [url]        Open new tab
  closetab [n]        Close tab

OTHER
  help [command]      Show help
  exit / quit         Close browser and exit
`.trim();

  return { success: true, message: help };
}
