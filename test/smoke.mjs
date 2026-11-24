// Smoke test: runs the MCP server against a simulated Ink RPC and calls every tool.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startMockRpc } from "./mock-rpc.mjs";
const rpc = startMockRpc(8545);

const client = new Client({ name: "smoke", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: "node", args: ["dist/index.js"], env: { ...process.env, INK_RPC_URL: "http://127.0.0.1:8545" } }));
const { tools } = await client.listTools();
console.log("TOOLS:", tools.map((t) => t.name).join(", "), "\n");
const W = "0x1111111111111111111111111111111111111111", T = "0x2222222222222222222222222222222222222222";
const calls = [
  ["splicex_overview", {}], ["ink_status", {}], ["token_info", { token: T }], ["wallet_balance", { wallet: W }],
  ["wallet_balance", { wallet: W, token: T }], ["catx_fee_perk", { wallet: W, catx: T }],
  ["catx_fee_perk", { wallet: "0xc0de000000000000000000000000000000000000", catx: T }], ["catx_fee_perk", { wallet: W }],  // uses the built-in CATX address
  ["router_activity", { blocks: 4500 }], ["router_activity", {}], ["governance_check", {}], ];
const expectErr = [["token_info", { token: "not-an-address" }]];
let failures = 0;
for (const [name, args] of calls) {
  const r = await client.callTool({ name, arguments: args });
  const out = r.content.map((c) => c.text).join("\n");
  console.log(`── ${name} ${JSON.stringify(args)}${r.isError ? "  [isError]" : ""}\n${out}\n`);
  if (/Couldn't complete/.test(out)) failures++;
}
for (const [name, args] of expectErr) {
  const r = await client.callTool({ name, arguments: args });
  console.log(`── ${name} ${JSON.stringify(args)} (should fail politely)\n${r.content[0].text}\n`);
  if (!r.isError) failures++;
}
await client.close(); rpc.close();
console.log(failures ? `${failures} unexpected failure(s)` : "ALL TOOLS RAN");
