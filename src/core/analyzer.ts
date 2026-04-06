import type { BrowserEngine } from "./browser.js";
import type { PageElement, PageState } from "./types.js";

/** Raw node from Playwright's accessibility.snapshot() */
interface RawAXNode {
  role: string;
  name?: string;
  value?: string;
  level?: number;
  checked?: boolean | "mixed";
  disabled?: boolean;
  expanded?: boolean;
  selected?: boolean;
  pressed?: boolean;
  focused?: boolean;
  children?: RawAXNode[];
}

/** Roles we consider meaningful and want to show */
const INTERACTIVE_ROLES = new Set([
  "link",
  "button",
  "textbox",
  "searchbox",
  "combobox",
  "checkbox",
  "radio",
  "switch",
  "slider",
  "spinbutton",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "tab",
  "treeitem",
]);

const CONTENT_ROLES = new Set([
  "heading",
  "paragraph",
  "text",
  "img",
  "figure",
  "table",
  "cell",
  "row",
  "list",
  "listitem",
  "blockquote",
  "code",
  "alert",
  "status",
  "dialog",
  "banner",
  "navigation",
  "main",
  "complementary",
  "contentinfo",
  "form",
  "search",
  "region",
  "article",
  "section",
]);

/** Roles to skip entirely (noise) */
const SKIP_ROLES = new Set([
  "none",
  "presentation",
  "generic",
  "group", // often just a wrapper
  "document", // the root web area
  "inlinetextbox", // redundant with parent StaticText
]);

export class PageAnalyzer {
  private browser: BrowserEngine;
  private elementMap: Map<number, string> = new Map(); // id → xpath/selector

  constructor(browser: BrowserEngine) {
    this.browser = browser;
  }

  async analyze(): Promise<PageState> {
    const [url, title, rawTree] = await Promise.all([
      this.browser.getUrl(),
      this.browser.getTitle(),
      this.browser.getAccessibilityTree(),
    ]);

    this.elementMap.clear();
    let idCounter = 0;

    const elements: PageElement[] = [];

    const walk = (node: RawAXNode, depth: number) => {
      const role = node.role;
      const isInteractive = INTERACTIVE_ROLES.has(role);
      const isContent = CONTENT_ROLES.has(role);
      const shouldSkip = SKIP_ROLES.has(role);

      // For content nodes without a name, try to get text from children
      let nodeName = node.name || "";
      if (!nodeName && isContent && node.children) {
        const textParts: string[] = [];
        for (const child of node.children) {
          if (child.role === "text" && child.name) {
            textParts.push(child.name);
          }
        }
        nodeName = textParts.join(" ").trim();
      }

      // Skip pure "text" nodes if their parent content node already captured the text
      const isRedundantText = role === "text" && depth > 0;

      // Process this node if it's meaningful
      if (!shouldSkip && !isRedundantText && (isInteractive || isContent) && (nodeName || node.value)) {
        idCounter++;
        const element: PageElement = {
          id: idCounter,
          role: node.role,
          name: nodeName,
          depth,
        };

        if (node.value !== undefined) element.value = node.value;
        if (node.level !== undefined) element.level = node.level;
        if (node.checked !== undefined) element.checked = node.checked;
        if (node.disabled !== undefined) element.disabled = node.disabled;
        if (node.expanded !== undefined) element.expanded = node.expanded;
        if (node.selected !== undefined) element.selected = node.selected;
        if (node.pressed !== undefined) element.pressed = node.pressed;
        if (node.focused !== undefined && node.focused) element.focused = node.focused;

        elements.push(element);
      }

      // Always walk children
      if (node.children) {
        for (const child of node.children) {
          walk(child, shouldSkip ? depth : depth + 1);
        }
      }
    };

    if (rawTree) {
      walk(rawTree as RawAXNode, 0);
    }

    // Now inject data-webpilot-id attributes into the actual DOM
    // so we can target elements by ID for interaction
    await this.injectDataAttributes(elements);

    return {
      url,
      title,
      elements,
      timestamp: Date.now(),
    };
  }

  /**
   * Inject data-webpilot-id attributes into the DOM for each interactive element.
   * This allows us to use CSS selectors like [data-webpilot-id="3"] to target elements.
   */
  private async injectDataAttributes(elements: PageElement[]): Promise<void> {
    const interactiveElements = elements.filter((el) => INTERACTIVE_ROLES.has(el.role));

    await this.browser.evaluate(`
      (function() {
        // Remove old IDs
        document.querySelectorAll('[data-webpilot-id]').forEach(el => {
          el.removeAttribute('data-webpilot-id');
        });

        // Strategy: walk the a11y-relevant elements and assign IDs based on role+name matching
        const assignments = ${JSON.stringify(
          interactiveElements.map((el) => ({
            id: el.id,
            role: el.role,
            name: el.name,
            value: el.value,
          }))
        )};

        for (const a of assignments) {
          let selector = '';
          const roleToTag = {
            'link': 'a',
            'button': 'button,[role="button"],input[type="submit"],input[type="button"]',
            'textbox': 'input[type="text"],input[type="email"],input[type="password"],input[type="search"],input[type="url"],input[type="tel"],input[type="number"],input:not([type]),textarea,[role="textbox"],[contenteditable="true"]',
            'searchbox': 'input[type="search"],[role="searchbox"]',
            'combobox': 'select,[role="combobox"]',
            'checkbox': 'input[type="checkbox"],[role="checkbox"]',
            'radio': 'input[type="radio"],[role="radio"]',
            'switch': '[role="switch"]',
            'slider': 'input[type="range"],[role="slider"]',
            'spinbutton': 'input[type="number"],[role="spinbutton"]',
            'menuitem': '[role="menuitem"]',
            'option': 'option,[role="option"]',
            'tab': '[role="tab"]',
          };

          const tagSelector = roleToTag[a.role] || '[role="' + a.role + '"]';
          const candidates = document.querySelectorAll(tagSelector);

          for (const el of candidates) {
            if (el.hasAttribute('data-webpilot-id')) continue;

            // Match by accessible name
            const ariaLabel = el.getAttribute('aria-label') || '';
            const innerText = (el.textContent || '').trim().substring(0, 200);
            const placeholder = el.getAttribute('placeholder') || '';
            const title = el.getAttribute('title') || '';
            const value = el.value || el.getAttribute('value') || '';

            const matchesName = a.name && (
              ariaLabel === a.name ||
              innerText === a.name ||
              innerText.startsWith(a.name) ||
              placeholder === a.name ||
              title === a.name
            );

            const matchesValue = a.value !== undefined && value === a.value;

            if (matchesName || matchesValue || (!a.name && !a.value)) {
              el.setAttribute('data-webpilot-id', String(a.id));
              break;
            }
          }
        }
      })();
    `);
  }

  /**
   * Get a Playwright-compatible selector for element with given ID
   */
  getSelectorForElement(id: number): string {
    return `[data-webpilot-id="${id}"]`;
  }

  /**
   * Filter elements for display purposes
   */
  static filterForDisplay(
    elements: PageElement[],
    filter?: "links" | "forms" | "headings" | "all"
  ): PageElement[] {
    if (!filter || filter === "all") return elements;

    switch (filter) {
      case "links":
        return elements.filter((el) => el.role === "link");
      case "forms":
        return elements.filter((el) =>
          INTERACTIVE_ROLES.has(el.role) && el.role !== "link"
        );
      case "headings":
        return elements.filter((el) => el.role === "heading");
      default:
        return elements;
    }
  }
}
