import { program } from "commander";
import type { WebpilotConfig, OutputMode } from "./core/types.js";
import { startRepl } from "./cli/repl.js";
import { startPipeMode } from "./cli/pipe.js";
import { startMcpServer } from "./mcp/server.js";

program
  .name("webpilot")
  .description(
    "A semantic terminal browser for LLM agents and CLI-native developers."
  )
  .version("0.1.0")
  .argument("[url]", "URL to navigate to")
  .option("--agent", "Agent output mode (JSON structured output)")
  .option("--pipe", "Pipe mode (read commands from stdin)")
  .option("--mcp", "Start as MCP server (stdio)")
  .option("--mcp-port <port>", "Start MCP server on HTTP port (for ChatGPT, remote agents)")
  .option("--headed", "Run browser in headed mode (visible window)")
  .option("--viewport <dimensions>", "Viewport size (e.g., 1440x900)", "1440x900")
  .option("--timeout <ms>", "Navigation timeout in milliseconds", "30000")
  .action(async (url: string | undefined, options: Record<string, unknown>) => {
    const [width, height] = (options.viewport as string)
      .split("x")
      .map(Number);

    const mode: OutputMode = options.agent
      ? "agent"
      : options.pipe
        ? "pipe"
        : !process.stdout.isTTY
          ? "pipe"
          : "human";

    const config: WebpilotConfig = {
      mode,
      headless: !options.headed,
      viewport: { width: width || 1280, height: height || 720 },
      timeout: Number(options.timeout) || 30000,
      mcp: !!options.mcp || !!options.mcpPort,
      mcpPort: options.mcpPort ? Number(options.mcpPort) : undefined,
      url,
    };

    if (config.mcp) {
      await startMcpServer(config);
      return;
    }

    if (config.mode === "pipe" || options.pipe) {
      await startPipeMode(config);
    } else {
      await startRepl(config);
    }
  });

program.parse();
