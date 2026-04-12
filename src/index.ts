#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { VaultService } from "./services/vault.js";
import { registerVaultTools } from "./tools/vault-tools.js";

function getVaultPath(): string {
  // Check CLI args first
  const argIndex = process.argv.indexOf("--vault");
  if (argIndex !== -1 && process.argv[argIndex + 1]) {
    return process.argv[argIndex + 1];
  }

  // Fallback to environment variable
  const envPath = process.env.OBSIDIAN_VAULT_PATH;
  if (envPath) {
    return envPath;
  }

  console.error(
    "Error: No vault path provided.\n" +
    "Usage: obsidian-mcp-server --vault /path/to/your/vault\n" +
    "   or: OBSIDIAN_VAULT_PATH=/path/to/vault obsidian-mcp-server"
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const vaultPath = getVaultPath();

  console.error(`Obsidian MCP Server starting...`);
  console.error(`Vault path: ${vaultPath}`);

  const server = new McpServer({
    name: "obsidian-mcp-server",
    version: "1.0.0",
  });

  const vault = new VaultService(vaultPath);

  registerVaultTools(server, vault);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("Obsidian MCP Server running (stdio transport)");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
