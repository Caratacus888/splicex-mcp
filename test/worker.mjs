// Worker test: runs the Cloudflare Worker locally (wrangler dev, real workerd runtime)
// against the simulated Ink RPC, then talks to it over Streamable HTTP like Claude would.
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startMockRpc } from "./mock-rpc.mjs";

const rpc = startMockRpc(8545);
const dev = spawn("npx", ["wrangler", "dev", "--port", "8787", "--var", "INK_RPC_URL:http://127.0.0.1:8545"], { stdio: ["ignore", "pipe", "pipe"] });
let log = ""; dev.stdout.on("data", (d) => (log += d)); dev.stderr.on("data", (d) => (log += d));
for (let i = 0; i < 60 && !/Ready on/.test(log); i++) await new Promise((r) => setTimeout(r, 500));
if (!/Ready on/.test(log)) { console.log(log); throw new Error("wrangler dev did not start"); }

let failures = 0;
try {
  const info = await (await fetch("http://127.0.0.1:8787/")).json();
  console.log("GET / ->", info.mcp_endpoint);
  const client = new Client({ name: "worker-test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL("http://127.0.0.1:8787/mcp")));
  const { tools } = await client.listTools();
  console.log("TOOLS:", tools.map((t) => t.name).join(", "));
  for (const [name, args] of [["ink_status", {}], ["governance_check", {}], ["catx_fee_perk", { wallet: "0x1111111111111111111111111111111111111111" }], ["router_activity", { blocks: 2500 }]]) {
    const r = await client.callTool({ name, arguments: args });
    const out = r.content.map((c) => c.text).join("\n");
    console.log(`── ${name}\n${out}\n`);
    if (r.isError) failures++;
  }
  await client.close();
} catch (e) { failures++; console.log("ERROR", e); }
dev.kill("SIGINT"); rpc.close();
console.log(failures ? `${failures} failure(s)` : "WORKER OK");
process.exit(failures ? 1 : 0);
