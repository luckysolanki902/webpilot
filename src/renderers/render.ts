import chalk from "chalk";
import type { PageElement, PageState, StateDiff, OutputMode } from "../core/types.js";

const ROLE_STYLES: Record<string, (text: string) => string> = {
  heading: chalk.bold.hex("#e2e8f0"),
  link: chalk.hex("#7dd3fc"),
  button: chalk.hex("#86efac").bold,
  textbox: chalk.hex("#fde68a"),
  searchbox: chalk.hex("#fde68a"),
  combobox: chalk.hex("#fde68a"),
  checkbox: chalk.hex("#c4b5fd"),
  radio: chalk.hex("#c4b5fd"),
  switch: chalk.hex("#c4b5fd"),
  img: chalk.hex("#94a3b8").italic,
  alert: chalk.hex("#fca5a5").bold,
  status: chalk.hex("#67e8f9"),
  paragraph: chalk.hex("#cbd5e1"),
  cell: chalk.hex("#cbd5e1"),
  navigation: chalk.hex("#64748b"),
  banner: chalk.hex("#64748b"),
  main: chalk.hex("#64748b"),
  form: chalk.hex("#64748b"),
  search: chalk.hex("#64748b"),
};

const ROLE_ICONS: Record<string, string> = {
  link: "›",
  button: "◆",
  textbox: "_",
  searchbox: "⌕",
  combobox: "⌄",
  checkbox: "☐",
  radio: "◎",
  switch: "⊘",
  heading: "#",
  paragraph: "¶",
  img: "◫",
  alert: "!",
  status: "~",
  list: "≡",
  listitem: "·",
  table: "◫",
  cell: "┃",
  navigation: "↗",
  dialog: "□",
  form: "⌂",
  main: "◇",
  article: "▪",
  section: "▪",
  blockquote: "│",
  code: "$",
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
      return chalk.hex("#f87171")("  x ") + chalk.hex("#94a3b8")(error);
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
  const w = Math.min(80, process.stdout.columns || 80);

  lines.push("");
  lines.push(chalk.hex("#64748b")("┌" + "─".repeat(w - 2) + "┐"));
  lines.push(chalk.bold.hex("#f1f5f9")("  " + state.title));
  lines.push(chalk.hex("#64748b")("  " + state.url));
  lines.push(chalk.hex("#64748b")("└" + "─".repeat(w - 2) + "┘"));
  lines.push("");

  for (const el of state.elements) {
    lines.push(formatElementHuman(el));
  }

  if (state.elements.length === 0) {
    lines.push(chalk.hex("#64748b")("  (empty page)"));
  }

  lines.push("");
  lines.push(chalk.hex("#475569")("  " + state.elements.length + " elements"));

  return lines.join("\n");
}

function formatElementHuman(el: PageElement): string {
  const id = chalk.hex("#38bdf8")(`[${el.id}]`);
  const styleFor = ROLE_STYLES[el.role] || chalk.hex("#e2e8f0");
  const icon = chalk.hex("#475569")(ROLE_ICONS[el.role] || " ");

  let roleBadge = chalk.hex("#475569")(el.role);
  if (el.level) roleBadge = chalk.hex("#475569")(`h${el.level}`);

  let content = el.name;

  switch (el.role) {
    case "textbox":
    case "searchbox": {
      const val = el.value || "";
      content = el.name
        ? `${el.name} ${val ? chalk.hex("#fef3c7")(`▸ ${val}`) : chalk.hex("#64748b")("▸ ...")}`
        : val
          ? chalk.hex("#fef3c7")(`▸ ${val}`)
          : chalk.hex("#64748b")("▸ ...");
      break;
    }
    case "checkbox":
    case "radio": {
      const check = el.checked
        ? chalk.hex("#86efac")("◉")
        : chalk.hex("#64748b")("○");
      content = `${check} ${el.name}`;
      break;
    }
    case "button":
      content = `⟦ ${el.name} ⟧`;
      break;
    case "link":
      content = el.name;
      break;
    case "heading":
      content = el.name;
      break;
    case "img":
      content = el.name ? `◫ ${el.name}` : "◫ image";
      break;
  }

  const indicators: string[] = [];
  if (el.disabled) indicators.push(chalk.hex("#f87171")("×"));
  if (el.focused) indicators.push(chalk.hex("#fbbf24")("●"));
  if (el.expanded !== undefined)
    indicators.push(el.expanded ? chalk.hex("#86efac")("▾") : chalk.hex("#64748b")("▸"));
  if (el.selected) indicators.push(chalk.hex("#86efac")("✓"));
  if (el.pressed) indicators.push(chalk.hex("#86efac")("↓"));

  const indicatorStr = indicators.length > 0 ? " " + indicators.join(" ") : "";

  const indent = "  ".repeat(Math.min(el.depth, 4));
  return `${indent}  ${id} ${icon} ${roleBadge.padEnd(14)} ${styleFor(content)}${indicatorStr}`;
}

// ─── Diff Renderer ─────────────────────────────────────────────

function renderDiffHuman(diff: StateDiff): string {
  const lines: string[] = [];

  if (diff.navigated) {
    lines.push(
      chalk.hex("#7dd3fc")("  → ") + chalk.hex("#64748b")(diff.previousUrl || "") + chalk.hex("#475569")(" → ") + chalk.hex("#f1f5f9").bold(diff.newUrl || "")
    );
  }

  if (diff.removed.length > 0) {
    if (diff.removed.length > 5) {
      lines.push(chalk.hex("#f87171")("  - ") + chalk.hex("#94a3b8")(`${diff.removed.length} removed`));
    } else {
      lines.push(chalk.hex("#f87171")("  - ") + chalk.hex("#94a3b8")(`[${diff.removed.join(", ")}]`));
    }
  }

  if (diff.added.length > 0) {
    if (diff.added.length > 5) {
      lines.push(chalk.hex("#86efac")("  + ") + chalk.hex("#94a3b8")(`${diff.added.length} new elements`));
    } else {
      for (const el of diff.added) {
        lines.push(chalk.hex("#86efac")("  + ") + chalk.hex("#94a3b8")(`[${el.id}] ${el.role} "${el.name}"`));
      }
    }
  }

  for (const mod of diff.modified) {
    const changes = Object.entries(mod.changes)
      .map(([key, { from, to }]) => `${key}: ${String(from)} → ${String(to)}`)
      .join(", ");
    lines.push(chalk.hex("#fde68a")("  ~ ") + chalk.hex("#94a3b8")(`[${mod.id}] ${changes}`));
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
