#!/usr/bin/env node
/**
 * SpliceX MCP server, local entry point: runs over stdio for Claude Desktop and Claude Code.
 * Read-only by design: it never holds keys and never sends transactions.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./tools.js";

const server = createServer({
  rpcUrl: process.env.INK_RPC_URL,
  explorerUrl: process.env.INK_EXPLORER_URL,
  catxAddress: process.env.CATX_ADDRESS,
});
await server.connect(new StdioServerTransport());
