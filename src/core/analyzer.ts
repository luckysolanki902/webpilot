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
    await this.browser.evaluate(`
      (function() {
        // Remove old IDs
        document.querySelectorAll('[data-webpilot-id]').forEach(el => {
          el.removeAttribute('data-webpilot-id');
        });

        // Strategy: walk the a11y-relevant elements and assign IDs based on role+name matching
        const assignments = ${JSON.stringify(
          elements.map((el) => ({
            id: el.id,
            role: el.role,
            name: el.name,
            value: el.value,
            level: el.level,
          }))
        )};

        const roleToTag = {
          'link': 'a,[role="link"]',
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
          'heading': 'h1,h2,h3,h4,h5,h6,[role="heading"]',
          'paragraph': 'p',
          'img': 'img,[role="img"]',
          'table': 'table,[role="table"],[role="grid"]',
          'cell': 'td,th,[role="cell"],[role="gridcell"],[role="columnheader"],[role="rowheader"]',
          'row': 'tr,[role="row"]',
          'list': 'ul,ol,[role="list"]',
          'listitem': 'li,[role="listitem"]',
          'navigation': 'nav,[role="navigation"]',
          'main': 'main,[role="main"]',
          'banner': 'header,[role="banner"]',
          'form': 'form,[role="form"]',
          'search': '[role="search"]',
          'alert': '[role="alert"]',
          'dialog': 'dialog,[role="dialog"],[role="alertdialog"]',
          'blockquote': 'blockquote',
          'code': 'code,pre',
          'figure': 'figure',
          'article': 'article,[role="article"]',
          'section': 'section,[role="region"]',
          'region': '[role="region"],section[aria-label]',
          'complementary': 'aside,[role="complementary"]',
          'contentinfo': 'footer,[role="contentinfo"]',
          'status': '[role="status"]',
          'treeitem': '[role="treeitem"]',
        };

        for (const a of assignments) {
          const tagSelector = roleToTag[a.role] || '[role="' + a.role + '"]';
          let candidates;
          try {
            candidates = document.querySelectorAll(tagSelector);
          } catch(e) {
            continue;
          }

          for (const el of candidates) {
            if (el.hasAttribute('data-webpilot-id')) continue;

            // For headings, also match by level
            if (a.role === 'heading' && a.level) {
              const tagLevel = parseInt(el.tagName?.replace('H', '') || '0');
              const ariaLevel = parseInt(el.getAttribute('aria-level') || '0');
              if (tagLevel !== a.level && ariaLevel !== a.level) continue;
            }

            // Match by accessible name
            const ariaLabel = el.getAttribute('aria-label') || '';
            const innerText = (el.textContent || '').trim().substring(0, 200);
            const placeholder = el.getAttribute('placeholder') || '';
            const title = el.getAttribute('title') || '';
            const value = el.value || el.getAttribute('value') || '';
            const alt = el.getAttribute('alt') || '';

            const matchesName = a.name && (
              ariaLabel === a.name ||
              innerText === a.name ||
              innerText.startsWith(a.name) ||
              placeholder === a.name ||
              title === a.name ||
              alt === a.name
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
