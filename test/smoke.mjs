// Smoke test: runs the MCP server against a simulated Ink RPC and calls every tool.
import http from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { encodeAbiParameters, toFunctionSelector, parseEther } from "viem";

const SAFE = "0xF3D3FD1a15EAcD0af62A4F2dB43B00169992B2bd";
const SEL = Object.fromEntries(
  ["name()", "symbol()", "decimals()", "totalSupply()", "balanceOf(address)", "owner()", "pendingOwner()", "VERSION()"].map((s) => [toFunctionSelector(s), s]),
);
const enc = (t, v) => encodeAbiParameters([{ type: t }], [v]);
const HEAD = 0x100000;
function handle({ method, params }) {
  switch (method) {
    case "eth_chainId": return "0xdef1";
    case "eth_blockNumber": return "0x" + HEAD.toString(16);
    case "eth_gasPrice": return "0x186a0";
    case "eth_getBalance": return "0x" + parseEther("1.5").toString(16);
    case "eth_getCode": return params[0].toLowerCase().startsWith("0xc0de") ? "0x6080604052" : "0x";
    case "eth_getBlockByNumber":
      return { number: "0x" + HEAD.toString(16), hash: "0x" + "ab".repeat(32), parentHash: "0x" + "00".repeat(32), timestamp: "0x6930a000", nonce: "0x0000000000000000", difficulty: "0x0", gasLimit: "0x1c9c380", gasUsed: "0x0", miner: "0x" + "00".repeat(20), extraData: "0x", baseFeePerGas: "0x1", transactions: [], uncles: [], logsBloom: "0x" + "00".repeat(256), sha3Uncles: "0x" + "00".repeat(32), stateRoot: "0x" + "00".repeat(32), receiptsRoot: "0x" + "00".repeat(32), transactionsRoot: "0x" + "00".repeat(32), size: "0x0", totalDifficulty: "0x0", mixHash: "0x" + "00".repeat(32) };
    case "eth_call": {
      const sig = SEL[params[0].data.slice(0, 10)];
      if (sig === "name()") return enc("string", "Cat X");
      if (sig === "symbol()") return enc("string", "CATX");
      if (sig === "decimals()") return enc("uint8", 18);
      if (sig === "totalSupply()") return enc("uint256", parseEther("1000000000"));
      if (sig === "balanceOf(address)") return enc("uint256", parseEther("2500000"));
      if (sig === "owner()") return enc("address", SAFE);
      if (sig === "pendingOwner()") return enc("address", "0x0000000000000000000000000000000000000000");
      if (sig === "VERSION()") return enc("uint256", 16n);
      throw new Error("unknown call " + params[0].data.slice(0, 10));
    }
    case "eth_getLogs": {
      const from = parseInt(params[0].fromBlock, 16);
      return [0, 1].map((i) => ({ address: params[0].address, blockHash: "0x" + "cd".repeat(32), blockNumber: "0x" + (from + 5 + i).toString(16), data: "0x", logIndex: "0x" + i.toString(16), removed: false, topics: ["0x" + "11".repeat(32)], transactionHash: "0x" + (from + i).toString(16).padStart(64, "0"), transactionIndex: "0x0" }));
    }
  }
  throw new Error("unsupported " + method);
}
const rpc = http.createServer((req, res) => {
  let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
    const one = (r) => { try { return { jsonrpc: "2.0", id: r.id, result: handle(r) }; } catch (e) { return { jsonrpc: "2.0", id: r.id, error: { code: -32000, message: e.message } }; } };
    const j = JSON.parse(body); res.setHeader("content-type", "application/json"); res.end(JSON.stringify(Array.isArray(j) ? j.map(one) : one(j)));
  });
}).listen(8545);

const client = new Client({ name: "smoke", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: "node", args: ["dist/index.js"], env: { ...process.env, INK_RPC_URL: "http://127.0.0.1:8545" } }));
const { tools } = await client.listTools();
console.log("TOOLS:", tools.map((t) => t.name).join(", "), "\n");
const W = "0x1111111111111111111111111111111111111111", T = "0x2222222222222222222222222222222222222222";
const calls = [
  ["splicex_overview", {}], ["ink_status", {}], ["token_info", { token: T }], ["wallet_balance", { wallet: W }],
  ["wallet_balance", { wallet: W, token: T }], ["catx_fee_perk", { wallet: W, catx: T }],
  ["catx_fee_perk", { wallet: "0xc0de000000000000000000000000000000000000", catx: T }], ["catx_fee_perk", { wallet: W }],  // uses the built-in CATX address
  ["router_activity", { blocks: 4500 }], ["governance_check", {}], ];
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
