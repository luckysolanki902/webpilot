import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BrowserEngine } from "../core/browser.js";
import { PageAnalyzer } from "../core/analyzer.js";
import { StateDiffer } from "../core/differ.js";
import type { PageState, WebpilotConfig } from "../core/types.js";

export async function startMcpServer(config: WebpilotConfig): Promise<void> {
  const server = new McpServer(
    {
      name: "webpilot",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
      instructions:
        "Webpilot is a semantic terminal browser. Use web_navigate to open a URL, " +
        "web_snapshot to see the current page state as numbered elements, " +
        "web_click/web_type to interact with elements by their [n] ID, " +
        "and web_extract to pull structured data from pages. " +
        "Works with any website: localhost, public sites, SPAs, SSR — everything.",
    }
  );

  const browser = new BrowserEngine({
    ...config,
    headless: true,
    mode: "agent",
  });
  let analyzer: PageAnalyzer;
  let differ: StateDiffer;
  let launched = false;

  async function ensureLaunched(): Promise<void> {
    if (!launched) {
      await browser.launch();
      analyzer = new PageAnalyzer(browser);
      differ = new StateDiffer();
      launched = true;
    }
  }

  function formatPageState(state: PageState): string {
    const lines: string[] = [];
    lines.push(`URL: ${state.url}`);
    lines.push(`Title: ${state.title}`);
    lines.push(`Elements (${state.elements.length}):`);
    for (const el of state.elements) {
      let line = `  [${el.id}] ${el.role}`;
      if (el.level) line += `(${el.level})`;
      if (el.name) line += ` "${el.name}"`;
      if (el.value !== undefined) line += ` value="${el.value}"`;
      if (el.checked) line += ` [checked]`;
      if (el.disabled) line += ` [disabled]`;
      if (el.expanded !== undefined) line += el.expanded ? ` [expanded]` : ` [collapsed]`;
      lines.push(line);
    }
    return lines.join("\n");
  }

  // ─── Tools ─────────────────────────────────────────────────

  server.registerTool("web_navigate", {
    title: "Navigate to URL",
    description:
      "Navigate to a URL and return the page state as numbered elements. " +
      "Supports full URLs, shorthand like 'google.com', and localhost like ':3000'.",
    inputSchema: {
      url: z.string().describe("URL to navigate to (e.g., 'https://google.com', 'localhost:3000', ':3000')"),
    },
  }, async ({ url }) => {
    await ensureLaunched();
    await browser.goto(url);
    const state = await analyzer.analyze();
    differ.computeDiff(state);
    return {
      content: [{ type: "text" as const, text: formatPageState(state) }],
    };
  });

  server.registerTool("web_click", {
    title: "Click Element",
    description:
      "Click an interactive element by its [n] ID from the page snapshot. " +
      "Returns the new page state and what changed.",
    inputSchema: {
      elementId: z.number().describe("The [n] ID of the element to click"),
    },
  }, async ({ elementId }) => {
    await ensureLaunched();
    const selector = analyzer.getSelectorForElement(elementId);
    await browser.clickElement(selector);
    await new Promise((r) => setTimeout(r, 500));
    const state = await analyzer.analyze();
    const diff = differ.computeDiff(state);

    let result = "";
    if (diff) {
      if (diff.navigated) result += `Navigated: ${diff.previousUrl} → ${diff.newUrl}\n`;
      if (diff.removed.length) result += `Removed ${diff.removed.length} elements\n`;
      if (diff.added.length) result += `Added ${diff.added.length} new elements\n`;
      for (const mod of diff.modified) {
        const changes = Object.entries(mod.changes)
          .map(([k, { from, to }]) => `${k}: ${String(from)} → ${String(to)}`)
          .join(", ");
        result += `Changed [${mod.id}]: ${changes}\n`;
      }
      result += "\n";
    }
    result += formatPageState(state);

    return {
      content: [{ type: "text" as const, text: result }],
    };
  });

  server.registerTool("web_type", {
    title: "Type into Element",
    description:
      "Type text into a form field (textbox, searchbox) by its [n] ID. " +
      "Clears existing content first by default.",
    inputSchema: {
      elementId: z.number().describe("The [n] ID of the input element"),
      text: z.string().describe("Text to type into the element"),
      clearFirst: z.boolean().optional().describe("Clear existing content first (default: true)"),
    },
  }, async ({ elementId, text, clearFirst }) => {
    await ensureLaunched();
    const selector = analyzer.getSelectorForElement(elementId);
    await browser.typeIntoElement(selector, text, clearFirst !== false);
    const state = await analyzer.analyze();
    differ.computeDiff(state);
    return {
      content: [{ type: "text" as const, text: formatPageState(state) }],
    };
  });

  server.registerTool("web_select", {
    title: "Select Dropdown Option",
    description: "Select an option from a dropdown/combobox by its [n] ID.",
    inputSchema: {
      elementId: z.number().describe("The [n] ID of the select/combobox element"),
      value: z.string().describe("The option text to select"),
    },
  }, async ({ elementId, value }) => {
    await ensureLaunched();
    const selector = analyzer.getSelectorForElement(elementId);
    await browser.selectOption(selector, value);
    const state = await analyzer.analyze();
    differ.computeDiff(state);
    return {
      content: [{ type: "text" as const, text: formatPageState(state) }],
    };
  });

  server.registerTool("web_snapshot", {
    title: "Get Page Snapshot",
    description:
      "Get the current page state as numbered elements without performing any action. " +
      "Use this to see what's on the page right now.",
  }, async () => {
    await ensureLaunched();
    const state = await analyzer.analyze();
    return {
      content: [{ type: "text" as const, text: formatPageState(state) }],
    };
  });

  server.registerTool("web_scroll", {
    title: "Scroll Page",
    description: "Scroll the page in a direction and return updated state.",
    inputSchema: {
      direction: z.enum(["up", "down", "top", "bottom"]).describe("Scroll direction"),
      amount: z.number().optional().describe("Number of viewports to scroll (default: 1)"),
    },
  }, async ({ direction, amount }) => {
    await ensureLaunched();
    await browser.scrollPage(direction, amount ?? 1);
    const state = await analyzer.analyze();
    return {
      content: [{ type: "text" as const, text: formatPageState(state) }],
    };
  });

  server.registerTool("web_back", {
    title: "Go Back",
    description: "Navigate back in browser history.",
  }, async () => {
    await ensureLaunched();
    await browser.back();
    const state = await analyzer.analyze();
    const diff = differ.computeDiff(state);
    let result = "";
    if (diff?.navigated) result += `Navigated back to: ${diff.newUrl}\n\n`;
    result += formatPageState(state);
    return {
      content: [{ type: "text" as const, text: result }],
    };
  });

  server.registerTool("web_extract", {
    title: "Extract Page Content",
    description:
      "Extract structured content from the current page. " +
      "Types: 'text' (all text), 'links' (all links with URLs), " +
      "'tables' (table data), 'forms' (form fields), 'meta' (page metadata).",
    inputSchema: {
      type: z
        .enum(["text", "links", "tables", "forms", "meta"])
        .optional()
        .describe("Type of content to extract (default: 'text')"),
      selector: z.string().optional().describe("Optional CSS selector to scope extraction"),
    },
  }, async ({ type, selector }) => {
    await ensureLaunched();
    const extractType = type || "text";
    let data: unknown;

    switch (extractType) {
      case "text":
        data = selector
          ? await browser.evaluate<string>(
              `document.querySelector('${selector.replace(/'/g, "\\'")}')?.innerText || ''`
            )
          : await browser.evaluate<string>("document.body.innerText");
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
          `Array.from(document.querySelectorAll('table')).map((table, i) => ({
            table: i + 1,
            rows: Array.from(table.querySelectorAll('tr')).map(tr =>
              Array.from(tr.querySelectorAll('th, td')).map(cell => cell.textContent.trim())
            )
          }))`
        );
        break;
      case "forms":
        data = await browser.evaluate<unknown>(
          `Array.from(document.querySelectorAll('form')).map((form, i) => ({
            form: i + 1,
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

    return {
      content: [
        {
          type: "text" as const,
          text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
        },
      ],
    };
  });

  server.registerTool("web_eval", {
    title: "Execute JavaScript",
    description:
      "Execute a JavaScript expression in the page context and return the result. " +
      "Use for advanced interactions or data extraction not covered by other tools.",
    inputSchema: {
      expression: z.string().describe("JavaScript expression to evaluate in the page"),
    },
  }, async ({ expression }) => {
    await ensureLaunched();
    const result = await browser.evaluate<unknown>(expression);
    return {
      content: [
        {
          type: "text" as const,
          text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
        },
      ],
    };
  });

  server.registerTool("web_screenshot", {
    title: "Take Screenshot",
    description: "Take a screenshot of the current page and return it as a base64 image.",
    inputSchema: {
      fullPage: z.boolean().optional().describe("Capture the full scrollable page (default: false)"),
    },
  }, async ({ fullPage }) => {
    await ensureLaunched();
    const buffer = await browser.screenshot(undefined, fullPage ?? false);
    return {
      content: [
        {
          type: "image" as const,
          data: buffer.toString("base64"),
          mimeType: "image/png",
        },
      ],
    };
  });

  server.registerTool("web_tabs", {
    title: "List Browser Tabs",
    description: "List all open browser tabs with their URLs and active status.",
  }, async () => {
    await ensureLaunched();
    const tabs = browser.getTabList();
    const lines = tabs.map(
      (t) => `  [${t.index}] ${t.active ? "(active) " : ""}${t.url}`
    );
    return {
      content: [{ type: "text" as const, text: `Tabs:\n${lines.join("\n")}` }],
    };
  });

  server.registerTool("web_newtab", {
    title: "Open New Tab",
    description: "Open a new browser tab, optionally navigating to a URL.",
    inputSchema: {
      url: z.string().optional().describe("URL to navigate to in the new tab"),
    },
  }, async ({ url }) => {
    await ensureLaunched();
    await browser.newTab(url);
    if (url) {
      const state = await analyzer.analyze();
      differ.computeDiff(state);
      return {
        content: [{ type: "text" as const, text: formatPageState(state) }],
      };
    }
    return {
      content: [{ type: "text" as const, text: "New tab opened" }],
    };
  });

  server.registerTool("web_close", {
    title: "Close Browser",
    description: "Close the browser session and clean up resources.",
  }, async () => {
    if (launched) {
      await browser.close();
      launched = false;
    }
    return {
      content: [{ type: "text" as const, text: "Browser closed" }],
    };
  });

  // ─── Start Server ──────────────────────────────────────────

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Graceful shutdown
  process.on("SIGINT", async () => {
    if (launched) await browser.close();
    await server.close();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    if (launched) await browser.close();
    await server.close();
    process.exit(0);
  });
}
