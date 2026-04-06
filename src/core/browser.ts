import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { WebpilotConfig } from "./types.js";

export class BrowserEngine {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private pages: Page[] = [];
  private activePageIndex = 0;
  private config: WebpilotConfig;

  constructor(config: WebpilotConfig) {
    this.config = config;
  }

  async launch(): Promise<void> {
    this.browser = await chromium.launch({
      headless: this.config.headless,
    });
    this.context = await this.browser.newContext({
      viewport: this.config.viewport,
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    });
    const page = await this.context.newPage();
    this.pages.push(page);
  }

  get activePage(): Page {
    const page = this.pages[this.activePageIndex];
    if (!page) throw new Error("No active page");
    return page;
  }

  async goto(url: string): Promise<void> {
    const normalizedUrl = this.normalizeUrl(url);
    try {
      await this.activePage.goto(normalizedUrl, {
        waitUntil: "domcontentloaded",
        timeout: this.config.timeout,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("ERR_NAME_NOT_RESOLVED")) {
        throw new Error(`could not resolve "${new URL(normalizedUrl).hostname}" — check the URL and try again`);
      }
      if (msg.includes("ERR_CONNECTION_REFUSED")) {
        throw new Error(`connection refused at ${normalizedUrl} — is the server running?`);
      }
      if (msg.includes("ERR_CONNECTION_TIMED_OUT") || msg.includes("Timeout")) {
        throw new Error(`timed out loading ${normalizedUrl}`);
      }
      if (msg.includes("ERR_CERT")) {
        throw new Error(`SSL certificate error for ${normalizedUrl}`);
      }
      throw new Error(`failed to load ${normalizedUrl}: ${msg.split("\n")[0]}`);
    }
    // Give JS a moment to settle
    await this.activePage.waitForLoadState("networkidle").catch(() => {});
  }

  async back(): Promise<void> {
    await this.activePage.goBack({ waitUntil: "domcontentloaded" });
  }

  async forward(): Promise<void> {
    await this.activePage.goForward({ waitUntil: "domcontentloaded" });
  }

  async refresh(): Promise<void> {
    await this.activePage.reload({ waitUntil: "domcontentloaded" });
  }

  async clickElement(selector: string): Promise<void> {
    try {
      await this.activePage.click(selector, { timeout: 5000 });
    } catch (err: unknown) {
      const msg = (err as Error).message || "";
      if (
        msg.includes("not visible") ||
        msg.includes("outside of the viewport") ||
        msg.includes("intercept") ||
        msg.includes("Timeout")
      ) {
        // Element is in the a11y tree but not visually clickable — use JS click
        const el = this.activePage.locator(selector);
        await el.evaluate((node: HTMLElement) => node.click());
      } else {
        throw err;
      }
    }
  }

  async typeIntoElement(selector: string, text: string, clear = true): Promise<void> {
    try {
      if (clear) {
        await this.activePage.fill(selector, text);
      } else {
        await this.activePage.type(selector, text);
      }
    } catch (err: unknown) {
      const msg = (err as Error).message || "";
      if (
        msg.includes("not visible") ||
        msg.includes("outside of the viewport") ||
        msg.includes("Timeout")
      ) {
        const el = this.activePage.locator(selector);
        await el.evaluate(
          (node: HTMLInputElement, val: string) => {
            node.focus();
            node.value = val;
            node.dispatchEvent(new Event("input", { bubbles: true }));
            node.dispatchEvent(new Event("change", { bubbles: true }));
          },
          text
        );
      } else {
        throw err;
      }
    }
  }

  async selectOption(selector: string, value: string): Promise<void> {
    try {
      await this.activePage.selectOption(selector, { label: value });
    } catch (err: unknown) {
      const msg = (err as Error).message || "";
      if (msg.includes("not visible") || msg.includes("Timeout")) {
        const el = this.activePage.locator(selector);
        await el.evaluate(
          (node: HTMLSelectElement, val: string) => {
            for (const opt of Array.from(node.options)) {
              if (opt.label === val || opt.text === val || opt.value === val) {
                node.value = opt.value;
                node.dispatchEvent(new Event("change", { bubbles: true }));
                break;
              }
            }
          },
          value
        );
      } else {
        throw err;
      }
    }
  }

  async hoverElement(selector: string): Promise<void> {
    await this.activePage.hover(selector, { timeout: 5000 }).catch(() => {
      // Ignore hover failures on hidden elements
    });
  }

  async pressKey(key: string): Promise<void> {
    await this.activePage.keyboard.press(key);
  }

  async scrollPage(direction: "up" | "down" | "top" | "bottom", amount = 1): Promise<void> {
    const page = this.activePage;
    switch (direction) {
      case "down":
        await page.evaluate((n) => window.scrollBy(0, window.innerHeight * n), amount);
        break;
      case "up":
        await page.evaluate((n) => window.scrollBy(0, -window.innerHeight * n), amount);
        break;
      case "top":
        await page.evaluate(() => window.scrollTo(0, 0));
        break;
      case "bottom":
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        break;
    }
  }

  async scrollToElement(selector: string): Promise<void> {
    await this.activePage.locator(selector).scrollIntoViewIfNeeded();
  }

  async evaluate<T>(expression: string): Promise<T> {
    return await this.activePage.evaluate(expression) as T;
  }

  async screenshot(path?: string, fullPage = false): Promise<Buffer> {
    const options: { path?: string; fullPage: boolean } = { fullPage };
    if (path) options.path = path;
    return await this.activePage.screenshot(options);
  }

  async getAccessibilityTree(): Promise<unknown> {
    // Use CDP to get the accessibility tree (page.accessibility was removed in Playwright 1.48+)
    const cdp = await this.activePage.context().newCDPSession(this.activePage);
    try {
      await cdp.send("Accessibility.enable");
      const { nodes } = await cdp.send("Accessibility.getFullAXTree");
      await cdp.send("Accessibility.disable");
      return buildTreeFromCDP(nodes);
    } finally {
      await cdp.detach();
    }
  }

  async getUrl(): Promise<string> {
    return this.activePage.url();
  }

  async getTitle(): Promise<string> {
    return await this.activePage.title();
  }

  // Tab management
  async newTab(url?: string): Promise<number> {
    if (!this.context) throw new Error("Browser not launched");
    const page = await this.context.newPage();
    this.pages.push(page);
    this.activePageIndex = this.pages.length - 1;
    if (url) await this.goto(url);
    return this.activePageIndex;
  }

  async switchTab(index: number): Promise<void> {
    if (index < 0 || index >= this.pages.length) {
      throw new Error(`Tab ${index} does not exist. You have ${this.pages.length} tabs.`);
    }
    this.activePageIndex = index;
    await this.activePage.bringToFront();
  }

  async closeTab(index?: number): Promise<void> {
    const i = index ?? this.activePageIndex;
    if (this.pages.length <= 1) throw new Error("Cannot close the last tab");
    const page = this.pages[i];
    if (!page) throw new Error(`Tab ${i} does not exist`);
    await page.close();
    this.pages.splice(i, 1);
    if (this.activePageIndex >= this.pages.length) {
      this.activePageIndex = this.pages.length - 1;
    }
  }

  getTabList(): Array<{ index: number; url: string; active: boolean }> {
    return this.pages.map((page, i) => ({
      index: i,
      url: page.url(),
      active: i === this.activePageIndex,
    }));
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
      this.pages = [];
    }
  }

  /**
   * Get a CSS selector for a specific element from the a11y tree.
   * We use a data-attribute approach: inject data-webpilot-id attributes.
   */
  async injectElementIds(elementCount: number): Promise<void> {
    // Remove old IDs first
    await this.activePage.evaluate(() => {
      document.querySelectorAll("[data-webpilot-id]").forEach((el) => {
        el.removeAttribute("data-webpilot-id");
      });
    });
  }

  getSelectorForId(id: number): string {
    return `[data-webpilot-id="${id}"]`;
  }

  private normalizeUrl(url: string): string {
    // ":3000" → "http://localhost:3000"
    if (url.startsWith(":")) {
      return `http://localhost${url}`;
    }
    // "localhost:3000" → "http://localhost:3000"
    if (url.startsWith("localhost")) {
      return `http://${url}`;
    }
    // "google.com" → "https://google.com"
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return `https://${url}`;
    }
    return url;
  }
}

// ─── CDP Accessibility Tree Builder ────────────────────────────

interface CDPAXNode {
  nodeId: string;
  role: { type: string; value?: string };
  name?: { type: string; value?: string };
  value?: { type: string; value?: string };
  properties?: Array<{ name: string; value: { type: string; value?: unknown } }>;
  childIds?: string[];
  parentId?: string;
  ignored?: boolean;
}

interface TreeNode {
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
  children?: TreeNode[];
}

function buildTreeFromCDP(nodes: CDPAXNode[]): TreeNode | null {
  if (!nodes || nodes.length === 0) return null;

  const nodeMap = new Map<string, CDPAXNode>();
  for (const node of nodes) {
    nodeMap.set(node.nodeId, node);
  }

  function convertNode(cdpNode: CDPAXNode): TreeNode | null {
    const role = cdpNode.role?.value || "none";
    const isIgnored = cdpNode.ignored || role === "none" || role === "Ignored";

    // Collect children regardless of whether this node is ignored
    const children: TreeNode[] = [];
    if (cdpNode.childIds && cdpNode.childIds.length > 0) {
      for (const childId of cdpNode.childIds) {
        const childCDP = nodeMap.get(childId);
        if (childCDP) {
          const childResults = convertNodeOrPassthrough(childCDP);
          children.push(...childResults);
        }
      }
    }

    if (isIgnored) return null;

    const treeNode: TreeNode = {
      role: normalizeRole(role),
      name: cdpNode.name?.value || undefined,
      value: cdpNode.value?.value || undefined,
    };

    // Extract properties
    if (cdpNode.properties) {
      for (const prop of cdpNode.properties) {
        switch (prop.name) {
          case "level":
            treeNode.level = prop.value.value as number;
            break;
          case "checked":
            treeNode.checked = prop.value.value === "mixed" ? "mixed" : prop.value.value as boolean;
            break;
          case "disabled":
            treeNode.disabled = prop.value.value as boolean;
            break;
          case "expanded":
            treeNode.expanded = prop.value.value as boolean;
            break;
          case "selected":
            treeNode.selected = prop.value.value as boolean;
            break;
          case "pressed":
            treeNode.pressed = prop.value.value === "mixed" ? false : prop.value.value as boolean;
            break;
          case "focused":
            treeNode.focused = prop.value.value as boolean;
            break;
        }
      }
    }

    if (children.length > 0) {
      treeNode.children = children;
    }

    return treeNode;
  }

  /**
   * If a node is ignored, return its children directly (passthrough).
   * If not ignored, return the converted node in an array.
   */
  function convertNodeOrPassthrough(cdpNode: CDPAXNode): TreeNode[] {
    const role = cdpNode.role?.value || "none";
    const isIgnored = cdpNode.ignored || role === "none" || role === "Ignored";

    if (isIgnored) {
      // Pass through: return children directly
      const results: TreeNode[] = [];
      if (cdpNode.childIds) {
        for (const childId of cdpNode.childIds) {
          const childCDP = nodeMap.get(childId);
          if (childCDP) {
            results.push(...convertNodeOrPassthrough(childCDP));
          }
        }
      }
      return results;
    }

    const node = convertNode(cdpNode);
    return node ? [node] : [];
  }

  // The first node is the root
  const root = convertNode(nodes[0]!);
  if (!root) {
    // Root was ignored, gather children via passthrough
    const children = convertNodeOrPassthrough(nodes[0]!);
    if (children.length === 0) return null;
    if (children.length === 1) return children[0]!;
    return { role: "document", name: "root", children };
  }
  return root;
}

function normalizeRole(role: string): string {
  // CDP returns roles in various formats; normalize to ARIA roles
  const map: Record<string, string> = {
    "RootWebArea": "document",
    "StaticText": "text",
    "InlineTextBox": "text",
    "GenericContainer": "generic",
    "TextField": "textbox",
    "SearchField": "searchbox",
    "ComboBoxSelect": "combobox",
    "ComboBoxMenuButton": "combobox",
    "ListBox": "listbox",
    "ListBoxOption": "option",
    "MenuListPopup": "menu",
    "MenuListOption": "option",
    "CheckBox": "checkbox",
    "RadioButton": "radio",
    "SpinButton": "spinbutton",
    "ToggleButton": "button",
    "LabelText": "label",
    "LineBreak": "text",
    "Abbr": "text",
    "DisclosureTriangle": "button",
    "SvgRoot": "img",
  };

  return map[role] || role.toLowerCase().replace(/\s+/g, "");
}
