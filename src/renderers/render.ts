import chalk from "chalk";
import type { PageElement, PageState, StateDiff, OutputMode } from "../core/types.js";

const ROLE_STYLES: Record<string, (text: string) => string> = {
  heading: chalk.bold.white,
  link: chalk.blue.underline,
  button: chalk.green.bold,
  textbox: chalk.yellow,
  searchbox: chalk.yellow,
  combobox: chalk.yellow,
  checkbox: chalk.magenta,
  radio: chalk.magenta,
  switch: chalk.magenta,
  img: chalk.gray.italic,
  alert: chalk.red.bold,
  status: chalk.cyan,
  navigation: chalk.dim,
  banner: chalk.dim,
  main: chalk.dim,
  form: chalk.dim,
  search: chalk.dim,
};

const ROLE_ICONS: Record<string, string> = {
  link: "🔗",
  button: "⏺ ",
  textbox: "✏️ ",
  searchbox: "🔍",
  checkbox: "☐ ",
  radio: "◉ ",
  heading: "📌",
  img: "🖼 ",
  alert: "⚠️ ",
  list: "📋",
  table: "📊",
  navigation: "🧭",
  dialog: "💬",
};

export function renderPageState(state: PageState, mode: OutputMode): string {
  switch (mode) {
    case "human":
      return renderHuman(state);
    case "agent":
      return JSON.stringify(state, null, 2);
    case "pipe":
      return renderPipe(state);
  }
}

export function renderDiff(diff: StateDiff, mode: OutputMode): string {
  switch (mode) {
    case "human":
      return renderDiffHuman(diff);
    case "agent":
      return JSON.stringify(diff, null, 2);
    case "pipe":
      return renderDiffPipe(diff);
  }
}

export function renderError(error: string, mode: OutputMode): string {
  switch (mode) {
    case "human":
      return chalk.red(`✗ ${error}`);
    case "agent":
      return JSON.stringify({ error });
    case "pipe":
      return `ERROR: ${error}`;
  }
}

export function renderMessage(message: string, mode: OutputMode): string {
  switch (mode) {
    case "human":
      return chalk.dim(message);
    case "agent":
      return JSON.stringify({ message });
    case "pipe":
      return message;
  }
}

// ─── Human Renderer ────────────────────────────────────────────

function renderHuman(state: PageState): string {
  const lines: string[] = [];

  // Header
  lines.push("");
  lines.push(chalk.bgBlue.white.bold(` ${state.title} `));
  lines.push(chalk.dim(state.url));
  lines.push(chalk.dim("─".repeat(Math.min(80, process.stdout.columns || 80))));
  lines.push("");

  // Elements
  for (const el of state.elements) {
    lines.push(formatElementHuman(el));
  }

  if (state.elements.length === 0) {
    lines.push(chalk.dim("  (no interactive elements found)"));
  }

  lines.push("");
  lines.push(chalk.dim(`${state.elements.length} elements | Type 'help' for commands`));

  return lines.join("\n");
}

function formatElementHuman(el: PageElement): string {
  const id = chalk.cyan.bold(`[${el.id}]`);
  const styleFor = ROLE_STYLES[el.role] || chalk.white;
  const icon = ROLE_ICONS[el.role] || "  ";

  let roleBadge = chalk.dim(`${el.role}`);
  if (el.level) roleBadge = chalk.dim(`h${el.level}`);

  let content = el.name;

  // Special formatting for different roles
  switch (el.role) {
    case "textbox":
    case "searchbox": {
      const val = el.value || "";
      content = el.name
        ? `${el.name}: ${val ? chalk.white(`"${val}"`) : chalk.dim("(empty)")}`
        : val
          ? chalk.white(`"${val}"`)
          : chalk.dim("(empty)");
      break;
    }
    case "checkbox":
    case "radio": {
      const check = el.checked ? chalk.green("✓") : chalk.dim("○");
      content = `${check} ${el.name}`;
      break;
    }
    case "button":
      content = `[ ${el.name} ]`;
      break;
    case "link":
      content = el.name;
      break;
    case "heading":
      content = el.name;
      break;
    case "img":
      content = el.name ? `[image: ${el.name}]` : "[image]";
      break;
  }

  // State indicators
  const indicators: string[] = [];
  if (el.disabled) indicators.push(chalk.red("disabled"));
  if (el.focused) indicators.push(chalk.yellow("focused"));
  if (el.expanded !== undefined)
    indicators.push(el.expanded ? chalk.green("▼") : chalk.dim("▶"));
  if (el.selected) indicators.push(chalk.green("selected"));
  if (el.pressed) indicators.push(chalk.green("pressed"));

  const indicatorStr = indicators.length > 0 ? ` ${indicators.join(" ")}` : "";

  const indent = "  ".repeat(Math.min(el.depth, 4));
  return `${indent}${id} ${icon} ${roleBadge.padEnd(18)} ${styleFor(content)}${indicatorStr}`;
}

// ─── Diff Renderer ─────────────────────────────────────────────

function renderDiffHuman(diff: StateDiff): string {
  const lines: string[] = [];

  if (diff.navigated) {
    lines.push(
      chalk.yellow(`  ↪ Navigated: ${diff.previousUrl} → ${chalk.bold(diff.newUrl || "")}`)
    );
  }

  if (diff.removed.length > 0) {
    if (diff.removed.length > 5) {
      lines.push(chalk.red(`  − Removed ${diff.removed.length} elements`));
    } else {
      lines.push(chalk.red(`  − Removed: [${diff.removed.join(", ")}]`));
    }
  }

  if (diff.added.length > 0) {
    if (diff.added.length > 5) {
      lines.push(chalk.green(`  + Added ${diff.added.length} new elements`));
    } else {
      for (const el of diff.added) {
        lines.push(chalk.green(`  + [${el.id}] ${el.role}: "${el.name}"`));
      }
    }
  }

  for (const mod of diff.modified) {
    const changes = Object.entries(mod.changes)
      .map(([key, { from, to }]) => `${key}: ${String(from)} → ${String(to)}`)
      .join(", ");
    lines.push(chalk.yellow(`  ~ [${mod.id}] ${changes}`));
  }

  return lines.join("\n");
}

// ─── Pipe Renderer ─────────────────────────────────────────────

function renderPipe(state: PageState): string {
  const lines: string[] = [];
  lines.push(`URL: ${state.url}`);
  lines.push(`TITLE: ${state.title}`);

  for (const el of state.elements) {
    let line = `[${el.id}] ${el.role}`;
    if (el.level) line += `(${el.level})`;
    if (el.name) line += ` "${el.name}"`;
    if (el.value) line += ` value="${el.value}"`;
    if (el.checked) line += ` [checked]`;
    if (el.disabled) line += ` [disabled]`;
    lines.push(line);
  }

  return lines.join("\n");
}

function renderDiffPipe(diff: StateDiff): string {
  const lines: string[] = [];

  if (diff.navigated) {
    lines.push(`NAVIGATED: ${diff.previousUrl} -> ${diff.newUrl}`);
  }
  if (diff.removed.length > 0) {
    lines.push(`REMOVED: ${diff.removed.join(",")}`);
  }
  for (const el of diff.added) {
    lines.push(`ADDED: [${el.id}] ${el.role} "${el.name}"`);
  }
  for (const mod of diff.modified) {
    const changes = Object.entries(mod.changes)
      .map(([key, { to }]) => `${key}=${String(to)}`)
      .join(" ");
    lines.push(`MODIFIED: [${mod.id}] ${changes}`);
  }

  return lines.join("\n");
}
