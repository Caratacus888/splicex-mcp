// Simulated Ink JSON-RPC used by the tests. Enforces the real RPC's 1,000-block eth_getLogs limit.
import http from "node:http";
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
      if (parseInt(params[0].toBlock, 16) - from + 1 > 1000) throw new Error("block range greater than 1000 max"); // same limit as the real Ink RPC
      return [0, 1].map((i) => ({ address: params[0].address, blockHash: "0x" + "cd".repeat(32), blockNumber: "0x" + (from + 5 + i).toString(16), data: "0x", logIndex: "0x" + i.toString(16), removed: false, topics: ["0x" + "11".repeat(32)], transactionHash: "0x" + (from + i).toString(16).padStart(64, "0"), transactionIndex: "0x0" }));
    }
  }
  throw new Error("unsupported " + method);
}
export const startMockRpc = (port = 8545) => http.createServer((req, res) => {
  let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
    const one = (r) => { try { return { jsonrpc: "2.0", id: r.id, result: handle(r) }; } catch (e) { return { jsonrpc: "2.0", id: r.id, error: { code: -32000, message: e.message } }; } };
    const j = JSON.parse(body); res.setHeader("content-type", "application/json"); res.end(JSON.stringify(Array.isArray(j) ? j.map(one) : one(j)));
  });
}).listen(port);


