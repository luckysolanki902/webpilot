// Shared types for Webpilot

export interface PageElement {
  /** Sequential ID assigned by the analyzer: [1], [2], etc. */
  id: number;
  /** ARIA role or HTML role */
  role: string;
  /** Accessible name */
  name: string;
  /** Current value (for inputs) */
  value?: string;
  /** Heading level (for headings) */
  level?: number;
  /** Whether the element is focused */
  focused?: boolean;
  /** Whether a checkbox/radio is checked */
  checked?: boolean | "mixed";
  /** Whether the element is disabled */
  disabled?: boolean;
  /** Whether a section is expanded */
  expanded?: boolean;
  /** Whether an option is selected */
  selected?: boolean;
  /** Whether a toggle is pressed */
  pressed?: boolean;
  /** URL for links */
  url?: string;
  /** Nesting depth in the a11y tree */
  depth: number;
  /** Child elements */
  children?: PageElement[];
}

export interface PageState {
  /** Current URL */
  url: string;
  /** Page title */
  title: string;
  /** Flat list of interactive/meaningful elements */
  elements: PageElement[];
  /** Full text content summary */
  textContent?: string;
  /** Timestamp of snapshot */
  timestamp: number;
}

export interface StateDiff {
  /** Whether navigation occurred */
  navigated: boolean;
  /** Previous URL (if navigated) */
  previousUrl?: string;
  /** New URL (if navigated) */
  newUrl?: string;
  /** Element IDs that were removed */
  removed: number[];
  /** New elements that appeared */
  added: PageElement[];
  /** Elements whose properties changed */
  modified: Array<{
    id: number;
    changes: Record<string, { from: unknown; to: unknown }>;
  }>;
}

export interface CommandResult {
  /** Whether the command succeeded */
  success: boolean;
  /** Current page state after command */
  pageState?: PageState;
  /** State diff from before the command */
  diff?: StateDiff;
  /** Any message to display */
  message?: string;
  /** Error message if failed */
  error?: string;
  /** Extracted data (for extract commands) */
  data?: unknown;
}

export type OutputMode = "human" | "agent" | "pipe";

export interface WebpilotConfig {
  /** Output mode */
  mode: OutputMode;
  /** Whether browser is headless */
  headless: boolean;
  /** Viewport dimensions */
  viewport: { width: number; height: number };
  /** Navigation timeout in ms */
  timeout: number;
  /** Whether to run as MCP server */
  mcp: boolean;
  /** Initial URL to navigate to */
  url?: string;
}
