/**
 * SpliceX MCP server, hosted entry point: a Cloudflare Worker serving MCP over
 * Streamable HTTP at /mcp. Stateless: each request gets a fresh server, so it
 * scales to zero and needs no storage. Read-only: no keys, no transactions.
 */
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createServer } from "./tools.js";

interface Env {
  INK_RPC_URL?: string;
  INK_EXPLORER_URL?: string;
  CATX_ADDRESS?: string;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, accept, mcp-session-id, mcp-protocol-version, last-event-id",
  "access-control-expose-headers": "mcp-session-id, mcp-protocol-version",
};

function withCors(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
  return out;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (url.pathname === "/mcp") {
      const server = createServer({ rpcUrl: env.INK_RPC_URL, explorerUrl: env.INK_EXPLORER_URL, catxAddress: env.CATX_ADDRESS });
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await server.connect(transport);
      return withCors(await transport.handleRequest(request));
    }

    if (url.pathname === "/" || url.pathname === "") {
      return withCors(
        Response.json({
          name: "SpliceX MCP server",
          description: "Read-only Claude tools for SpliceX on the Ink network.",
          mcp_endpoint: `${url.origin}/mcp`,
          how_to_use: "In Claude, add a custom connector with the mcp_endpoint URL.",
          source: "https://github.com/Caratacus888/splicex-mcp",
        }),
      );
    }
    return withCors(new Response("Not found", { status: 404 }));
  },
};
