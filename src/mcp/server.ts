import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { BrowserEngine } from "../core/browser.js";
import { PageAnalyzer } from "../core/analyzer.js";
import { StateDiffer } from "../core/differ.js";
import type { PageState, WebpilotConfig } from "../core/types.js";

const MCP_INFO = { name: "webpilot", version: "0.1.0" };

const MCP_OPTIONS = {
  capabilities: { tools: {} },
  instructions:
    "Webpilot is a semantic terminal browser. Use web_navigate to open a URL, " +
    "web_snapshot to see the current page state as numbered elements, " +
    "web_click/web_type to interact with elements by their [n] ID, " +
    "and web_extract to pull structured data from pages. " +
    "Works with any website: localhost, public sites, SPAs, SSR — everything.",
};

function fmt(state: PageState): string {
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

function txt(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

/**
 * Register all webpilot tools on an McpServer using a shared browser instance.
 */
function registerTools(
  server: McpServer,
  browser: BrowserEngine,
  ctx: { analyzer: PageAnalyzer; differ: StateDiffer; launched: boolean },
  config: WebpilotConfig,
) {
  const ensure = async () => {
    if (!ctx.launched) {
      await browser.launch();
      ctx.analyzer = new PageAnalyzer(browser);
      ctx.differ = new StateDiffer();
      ctx.launched = true;
    }
  };

  server.registerTool("web_navigate", {
    title: "Navigate to URL",
    description:
      "Navigate to a URL and return the page state as numbered elements. " +
      "Supports full URLs, shorthand like 'google.com', and localhost like ':3000'.",
    inputSchema: { url: z.string().describe("URL to navigate to") },
  }, async ({ url }) => {
    await ensure();
    await browser.goto(url);
    const state = await ctx.analyzer.analyze();
    ctx.differ.computeDiff(state);
    return txt(fmt(state));
  });

  server.registerTool("web_click", {
    title: "Click Element",
    description: "Click an element by its [n] ID from the page snapshot.",
    inputSchema: { elementId: z.number().describe("The [n] ID of the element to click") },
  }, async ({ elementId }) => {
    await ensure();
    await browser.clickElement(ctx.analyzer.getSelectorForElement(elementId));
    await new Promise((r) => setTimeout(r, 500));
    const state = await ctx.analyzer.analyze();
    const diff = ctx.differ.computeDiff(state);
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
    result += fmt(state);
    return txt(result);
  });

  server.registerTool("web_type", {
    title: "Type into Element",
    description: "Type text into a form field by its [n] ID. Clears existing content first by default.",
    inputSchema: {
      elementId: z.number().describe("The [n] ID of the input element"),
      text: z.string().describe("Text to type"),
      clearFirst: z.boolean().optional().describe("Clear existing content first (default: true)"),
    },
  }, async ({ elementId, text, clearFirst }) => {
    await ensure();
    await browser.typeIntoElement(ctx.analyzer.getSelectorForElement(elementId), text, clearFirst !== false);
    const state = await ctx.analyzer.analyze();
    ctx.differ.computeDiff(state);
    return txt(fmt(state));
  });

  server.registerTool("web_select", {
    title: "Select Dropdown Option",
    description: "Select an option from a dropdown/combobox by its [n] ID.",
    inputSchema: {
      elementId: z.number().describe("The [n] ID of the select element"),
      value: z.string().describe("The option text to select"),
    },
  }, async ({ elementId, value }) => {
    await ensure();
    await browser.selectOption(ctx.analyzer.getSelectorForElement(elementId), value);
    const state = await ctx.analyzer.analyze();
    ctx.differ.computeDiff(state);
    return txt(fmt(state));
  });

  server.registerTool("web_snapshot", {
    title: "Get Page Snapshot",
    description: "Get the current page state as numbered elements without performing any action.",
  }, async () => {
    await ensure();
    return txt(fmt(await ctx.analyzer.analyze()));
  });

  server.registerTool("web_scroll", {
    title: "Scroll Page",
    description: "Scroll the page in a direction and return updated state.",
    inputSchema: {
      direction: z.enum(["up", "down", "top", "bottom"]).describe("Scroll direction"),
      amount: z.number().optional().describe("Number of viewports to scroll (default: 1)"),
    },
  }, async ({ direction, amount }) => {
    await ensure();
    await browser.scrollPage(direction, amount ?? 1);
    return txt(fmt(await ctx.analyzer.analyze()));
  });

  server.registerTool("web_back", {
    title: "Go Back",
    description: "Navigate back in browser history.",
  }, async () => {
    await ensure();
    await browser.back();
    const state = await ctx.analyzer.analyze();
    const diff = ctx.differ.computeDiff(state);
    let result = "";
    if (diff?.navigated) result += `Navigated back to: ${diff.newUrl}\n\n`;
    result += fmt(state);
    return txt(result);
  });

  server.registerTool("web_extract", {
    title: "Extract Page Content",
    description:
      "Extract structured content from the current page. " +
      "Types: 'text', 'links', 'tables', 'forms', 'meta'.",
    inputSchema: {
      type: z.enum(["text", "links", "tables", "forms", "meta"]).optional().describe("Type of content (default: 'text')"),
      selector: z.string().optional().describe("Optional CSS selector to scope extraction"),
    },
  }, async ({ type, selector }) => {
    await ensure();
    const t = type || "text";
    let data: unknown;
    switch (t) {
      case "text":
        data = selector
          ? await browser.evaluate<string>(`document.querySelector('${selector.replace(/'/g, "\\'")}')?.innerText || ''`)
          : await browser.evaluate<string>("document.body.innerText");
        break;
      case "links":
        data = await browser.evaluate<unknown>(
          `Array.from(document.querySelectorAll('a[href]')).map(a=>({text:a.textContent.trim().substring(0,100),url:a.href})).filter(l=>l.text)`
        );
        break;
      case "tables":
        data = await browser.evaluate<unknown>(
          `Array.from(document.querySelectorAll('table')).map((t,i)=>({table:i+1,rows:Array.from(t.querySelectorAll('tr')).map(r=>Array.from(r.querySelectorAll('th,td')).map(c=>c.textContent.trim()))}))`
        );
        break;
      case "forms":
        data = await browser.evaluate<unknown>(
          `Array.from(document.querySelectorAll('form')).map((f,i)=>({form:i+1,action:f.action,method:f.method,fields:Array.from(f.querySelectorAll('input,select,textarea')).map(e=>({type:e.type||e.tagName.toLowerCase(),name:e.name,placeholder:e.placeholder,value:e.value}))}))`
        );
        break;
      case "meta":
        data = await browser.evaluate<unknown>(
          `({title:document.title,description:document.querySelector('meta[name="description"]')?.content||'',ogTitle:document.querySelector('meta[property="og:title"]')?.content||'',ogDescription:document.querySelector('meta[property="og:description"]')?.content||'',ogImage:document.querySelector('meta[property="og:image"]')?.content||'',canonical:document.querySelector('link[rel="canonical"]')?.href||'',lang:document.documentElement.lang||''})`
        );
        break;
    }
    return txt(typeof data === "string" ? data : JSON.stringify(data, null, 2));
  });

  server.registerTool("web_eval", {
    title: "Execute JavaScript",
    description: "Execute a JavaScript expression in the page context and return the result.",
    inputSchema: { expression: z.string().describe("JavaScript expression to evaluate") },
  }, async ({ expression }) => {
    await ensure();
    const result = await browser.evaluate<unknown>(expression);
    return txt(typeof result === "string" ? result : JSON.stringify(result, null, 2));
  });

  server.registerTool("web_screenshot", {
    title: "Take Screenshot",
    description: "Take a screenshot of the current page and return it as a base64 image.",
    inputSchema: { fullPage: z.boolean().optional().describe("Capture full scrollable page (default: false)") },
  }, async ({ fullPage }) => {
    await ensure();
    const buffer = await browser.screenshot(undefined, fullPage ?? false);
    return { content: [{ type: "image" as const, data: buffer.toString("base64"), mimeType: "image/png" }] };
  });

  server.registerTool("web_tabs", {
    title: "List Browser Tabs",
    description: "List all open browser tabs with their URLs and active status.",
  }, async () => {
    await ensure();
    const tabs = browser.getTabList();
    return txt(`Tabs:\n${tabs.map((t) => `  [${t.index}] ${t.active ? "(active) " : ""}${t.url}`).join("\n")}`);
  });

  server.registerTool("web_newtab", {
    title: "Open New Tab",
    description: "Open a new browser tab, optionally navigating to a URL.",
    inputSchema: { url: z.string().optional().describe("URL to navigate to in the new tab") },
  }, async ({ url }) => {
    await ensure();
    await browser.newTab(url);
    if (url) {
      const state = await ctx.analyzer.analyze();
      ctx.differ.computeDiff(state);
      return txt(fmt(state));
    }
    return txt("New tab opened");
  });

  server.registerTool("web_close", {
    title: "Close Browser",
    description: "Close the browser session and clean up resources.",
  }, async () => {
    if (ctx.launched) {
      await browser.close();
      ctx.launched = false;
    }
    return txt("Browser closed");
  });
}

/**
 * Create a fully wired McpServer with all webpilot tools.
 */
function createWebpilotServer(config: WebpilotConfig) {
  const server = new McpServer(MCP_INFO, MCP_OPTIONS);
  const browser = new BrowserEngine({ ...config, headless: true, mode: "agent" });
  const ctx = {
    analyzer: null as unknown as PageAnalyzer,
    differ: null as unknown as StateDiffer,
    launched: false,
  };
  registerTools(server, browser, ctx, config);
  return { server, browser, ctx };
}

// ─── Public Entry Point ────────────────────────────────────────

export async function startMcpServer(config: WebpilotConfig): Promise<void> {
  if (config.mcpPort) {
    await startHttpMcpServer(config);
  } else {
    await startStdioMcpServer(config);
  }
}

// ─── Stdio Mode (Claude Desktop, VS Code, local agents) ───────

async function startStdioMcpServer(config: WebpilotConfig): Promise<void> {
  const { server, browser, ctx } = createWebpilotServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = async () => {
    if (ctx.launched) await browser.close();
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// ─── HTTP Mode (ChatGPT, remote LLM agents, tunnels) ──────────

async function startHttpMcpServer(config: WebpilotConfig): Promise<void> {
  const port = config.mcpPort!;

  // Shared browser + state across all requests
  const browser = new BrowserEngine({ ...config, headless: true, mode: "agent" });
  const ctx = {
    analyzer: null as unknown as PageAnalyzer,
    differ: null as unknown as StateDiffer,
    launched: false,
  };

  const httpServer = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id");
    res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://localhost:${port}`);

    if (url.pathname !== "/mcp") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ name: "webpilot", version: "0.1.0", status: "running", mcp: "/mcp" }));
      return;
    }

    // Stateless: new server + transport per request, shared browser
    const server = new McpServer(MCP_INFO, MCP_OPTIONS);
    registerTools(server, browser, ctx, config);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
    await transport.close();
    await server.close();
  });

  httpServer.listen(port, () => {
    console.error(`webpilot mcp server running on http://localhost:${port}/mcp`);
  });

  const shutdown = async () => {
    if (ctx.launched) await browser.close();
    httpServer.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
