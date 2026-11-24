#!/usr/bin/env node
/**
 * SpliceX MCP server
 *
 * Gives Claude (or any MCP client) read-only tools for SpliceX and the Ink
 * network: protocol overview, live chain status, token and wallet lookups,
 * the CATX fee-perk check, router activity and an on-chain governance check.
 *
 * Read-only by design: it never holds keys and never sends transactions.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createPublicClient,
  defineChain,
  formatEther,
  formatUnits,
  getAddress,
  http,
  isAddress,
  parseAbi,
  type Address,
} from "viem";

// ---------------------------------------------------------------- config
const RPC_URL = process.env.INK_RPC_URL ?? "https://rpc-gel.inkonchain.com";
const EXPLORER = process.env.INK_EXPLORER_URL ?? "https://explorer.inkonchain.com";
const CATX_ADDRESS = process.env.CATX_ADDRESS ?? "0x06A0Ff27F4f2363259FC4c96DdE427E06048EdD3"; // CATX on Ink (script/InkAddresses.sol)
const CATX_PERK_THRESHOLD = 1_000_000n;
const MAX_LOG_RANGE = 1_000n; // Ink RPC rejects eth_getLogs ranges over 1,000 blocks
const MAX_BLOCKS = 100_000n; // about 28 hours at one block per second

const ink = defineChain({
  id: 57073,
  name: "Ink",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: "Ink Explorer", url: EXPLORER } },
});

const client = createPublicClient({ chain: ink, transport: http(RPC_URL, { timeout: 20_000 }) });

// Deployed contracts (Ink mainnet), from the SpliceX v1 README.
const CONTRACTS = {
  registry: { name: "SpliceXRegistry", address: "0xcdFFB56653bc4734b6fD234471b8335893D58D7e", owned: true },
  feeSplitter: { name: "SpliceXFeeSplitter", address: "0x6c18866444BcF047fFa978fE47985533152Be471", owned: true },
  router: { name: "SpliceXRouter v1.6 (live)", address: "0xc2E688F46fC93703d2c20A4Ba8232b1C56ED6327", owned: true },
  inkyRegistry: { name: "SpliceXInkyRegistry", address: "0xdb9aE7F24562fe28780762cF104dfF91C973B5ff", owned: true },
  wethAdapter: { name: "SpliceXWethAdapter (no owner)", address: "0x6E151D07125762b6F83D4705E469F545770E72AD", owned: false },
  featuresV2: { name: "SpliceXFeatures v2 (InkyPump tab)", address: "0x707E4e821Aea891f98eA6119E1cd01d69D5BdE6E", owned: true },
  features: { name: "SpliceXFeatures (featured slots)", address: "0xD01e9d2Ac12166814dF95DE55A5EF209107Dc184", owned: true },
} as const;
const SAFE: Address = "0xF3D3FD1a15EAcD0af62A4F2dB43B00169992B2bd"; // 2-of-3 owner Safe

const erc20Abi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
]);
const ownableAbi = parseAbi([
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
]);
const versionAbi = parseAbi(["function VERSION() view returns (uint256)"]);

// ---------------------------------------------------------------- helpers
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const fail = (t: string) => ({ content: [{ type: "text" as const, text: t }], isError: true });
const addr = (a: string) => `${a} (${EXPLORER}/address/${a})`;
const txLink = (h: string) => `${EXPLORER}/tx/${h}`;
const ZERO = "0x0000000000000000000000000000000000000000";

function toAddress(input: string, label = "address"): Address {
  if (!isAddress(input, { strict: false })) throw new Error(`"${input}" is not a valid ${label}.`);
  return getAddress(input);
}

function fmt(amount: bigint, decimals: number): string {
  const [whole, frac = ""] = formatUnits(amount, decimals).split(".");
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const trimmed = frac.slice(0, 6).replace(/0+$/, "");
  return trimmed ? `${withCommas}.${trimmed}` : withCommas;
}

async function tokenMeta(token: Address) {
  const [name, symbol, decimals, totalSupply] = await Promise.allSettled([
    client.readContract({ address: token, abi: erc20Abi, functionName: "name" }),
    client.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
    client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
    client.readContract({ address: token, abi: erc20Abi, functionName: "totalSupply" }),
  ]);
  if (decimals.status !== "fulfilled") throw new Error(`${token} doesn't look like an ERC-20 token (no decimals()).`);
  return {
    name: name.status === "fulfilled" ? name.value : "(unknown)",
    symbol: symbol.status === "fulfilled" ? symbol.value : "?",
    decimals: Number(decimals.value),
    totalSupply: totalSupply.status === "fulfilled" ? totalSupply.value : undefined,
  };
}

async function guard<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
    return fail(`Couldn't complete that: ${msg}`);
  }
}

// ---------------------------------------------------------------- server
const server = new McpServer({ name: "splicex", version: "1.0.0" });

server.registerTool(
  "splicex_overview",
  {
    title: "SpliceX overview",
    description:
      "Explains what SpliceX is, how splicing works, its fees and fee split, safety design and the deployed contract addresses on Ink. Use this first for any general question about SpliceX.",
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async () =>
    text(
      [
        "SpliceX (splicex.io) turns the wrapped-xStock dividends paid by Sentry tokens on Ink into a mix of stocks (and tokens) the user chooses, in one transaction.",
        "",
        "How a splice works: the website quotes every venue (Ink Foundation Uniswap V3, Quotrons Uniswap V4, Velodrome) and picks the best price per leg. The router then sells the inputs (stocks, Sentry/InkyPump tokens sold, or ETH/WETH/USDG/USDT0 paid) for USDG, takes the fee, and buys the basket. The contract enforces approved routes, shares summing to 100%, a minimum out per leg (measured on what was actually received) and that it ends every call holding nothing.",
        "",
        "Fees: 1% of USDG raised (hard cap 2%); amounts kept in the target mix pay nothing. Wallets holding at least 1,000,000 CATX pay no fee when they send the transaction themselves (regular wallets and EIP-7702 accounts; not contract wallets).",
        "Fee split (fixed at deploy): 50% buys CATX and burns it, 30% to the treasury, 20% donated to Quotrons (builder code QTR-0119).",
        "",
        "Safety: owner is a 2-of-3 Safe. Anything that loosens the rules waits behind a 48-hour timelock with the exact calldata published on chain; tightening actions are immediate. No admin function can move user funds. The fee keeper is rate-limited (maxPerDay, starting at $1,000). 232 unit and fuzz tests plus fork tests against live Ink contracts; independent reviews found no critical or high issues. Not professionally audited.",
        "",
        "Contracts on Ink (chain 57073):",
        ...Object.values(CONTRACTS).map((c) => `- ${c.name}: ${addr(c.address)}`),
        `- CATX token: ${addr(CATX_ADDRESS)}`,
        `- Owner (2-of-3 Safe): ${addr(SAFE)}`,
      ].join("\n"),
    ),
);

server.registerTool(
  "ink_status",
  {
    title: "Ink network status",
    description: "Live status of the Ink network: chain id, latest block, block time and gas price. Use to check the RPC connection is working.",
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async () =>
    guard(async () => {
      const [chainId, block, gasPrice] = await Promise.all([
        client.getChainId(),
        client.getBlock({ blockTag: "latest" }),
        client.getGasPrice(),
      ]);
      const when = new Date(Number(block.timestamp) * 1000).toISOString().replace(".000Z", "Z");
      return text(
        `Ink network (chain id ${chainId})\nLatest block: ${block.number} at ${when}\nGas price: ${formatUnits(gasPrice, 9)} gwei\nRPC: ${RPC_URL}`,
      );
    }),
);

server.registerTool(
  "token_info",
  {
    title: "Token info",
    description: "Name, symbol, decimals and total supply of any ERC-20 token on Ink, given its contract address.",
    inputSchema: { token: z.string().describe("Token contract address (0x...)") },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ token }) =>
    guard(async () => {
      const t = toAddress(token, "token address");
      const m = await tokenMeta(t);
      const supply = m.totalSupply === undefined ? "unknown" : `${fmt(m.totalSupply, m.decimals)} ${m.symbol}`;
      return text(`${m.name} (${m.symbol})\nAddress: ${addr(t)}\nDecimals: ${m.decimals}\nTotal supply: ${supply}`);
    }),
);

server.registerTool(
  "wallet_balance",
  {
    title: "Wallet balance",
    description: "ETH balance of a wallet on Ink, or its balance of a given ERC-20 token if a token address is provided.",
    inputSchema: {
      wallet: z.string().describe("Wallet address (0x...)"),
      token: z.string().optional().describe("Optional ERC-20 token address. Leave out for ETH."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ wallet, token }) =>
    guard(async () => {
      const w = toAddress(wallet, "wallet address");
      if (!token) {
        const bal = await client.getBalance({ address: w });
        return text(`${addr(w)} holds ${fmt(bal, 18)} ETH (${formatEther(bal)} exactly).`);
      }
      const t = toAddress(token, "token address");
      const [m, bal] = await Promise.all([
        tokenMeta(t),
        client.readContract({ address: t, abi: erc20Abi, functionName: "balanceOf", args: [w] }),
      ]);
      return text(`${addr(w)} holds ${fmt(bal, m.decimals)} ${m.symbol} (${m.name}).`);
    }),
);

server.registerTool(
  "catx_fee_perk",
  {
    title: "CATX fee-perk check",
    description:
      "Checks whether a wallet qualifies for fee-free splicing: it must hold at least 1,000,000 CATX and send the transaction itself (a regular wallet or an EIP-7702 account, not a contract wallet such as a Safe).",
    inputSchema: {
      wallet: z.string().describe("Wallet address (0x...)"),
      catx: z.string().optional().describe("Optional override for the CATX token address. Defaults to CATX on Ink."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ wallet, catx }) =>
    guard(async () => {
      const catxAddr = catx ?? CATX_ADDRESS;
      const w = toAddress(wallet, "wallet address");
      const c = toAddress(catxAddr, "CATX address");
      const [m, bal, code] = await Promise.all([
        tokenMeta(c),
        client.readContract({ address: c, abi: erc20Abi, functionName: "balanceOf", args: [w] }),
        client.getCode({ address: w }),
      ]);
      const threshold = CATX_PERK_THRESHOLD * 10n ** BigInt(m.decimals);
      const enough = bal >= threshold;
      const hasCode = !!code && code !== "0x";
      const is7702 = hasCode && code!.toLowerCase().startsWith("0xef0100");
      const kind = !hasCode ? "a regular wallet" : is7702 ? "an EIP-7702 smart account" : "a contract wallet";
      const eligibleKind = !hasCode || is7702;
      const verdict =
        enough && eligibleKind
          ? "Qualifies: splices sent from this wallet pay no SpliceX fee."
          : !enough
            ? `Doesn't qualify yet: needs ${fmt(threshold - bal, m.decimals)} more ${m.symbol}.`
            : "Holds enough CATX, but contract wallets don't get the perk (their transactions are sent by someone else). The owner can exempt one with addFeeExempt, behind the 48-hour timelock.";
      return text(`${addr(w)} is ${kind} holding ${fmt(bal, m.decimals)} ${m.symbol} (threshold: 1,000,000).\n${verdict}`);
    }),
);

server.registerTool(
  "router_activity",
  {
    title: "Router activity",
    description:
      "Recent on-chain activity of the live SpliceX router (v1.6): how many events and transactions it produced over the last N blocks, with links to the latest transactions. Ink produces about one block per second.",
    inputSchema: {
      blocks: z.number().int().min(10).max(Number(MAX_BLOCKS)).default(43_200).describe("How many recent blocks to scan (default 43200, about 12 hours; max 100000, about 28 hours)."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ blocks }) =>
    guard(async () => {
      const latest = await client.getBlockNumber();
      const span = BigInt(blocks);
      const from = latest > span ? latest - span + 1n : 0n;
      const logs = [];
      for (let start = from; start <= latest; start += MAX_LOG_RANGE) {
        const end = start + MAX_LOG_RANGE - 1n > latest ? latest : start + MAX_LOG_RANGE - 1n;
        logs.push(...(await client.getLogs({ address: CONTRACTS.router.address, fromBlock: start, toBlock: end })));
      }
      const txs = [...new Set(logs.map((l) => l.transactionHash).filter(Boolean))] as string[];
      const recent = txs.slice(-5).reverse();
      const lines = [
        `SpliceX router v1.6 over blocks ${from}–${latest} (about ${blocks >= 3600 ? `${Math.round(blocks / 360) / 10} hours` : `${Math.round(blocks / 60)} minutes`}):`,
        `${logs.length} events from ${txs.length} transactions.`,
      ];
      if (recent.length) lines.push("Most recent transactions:", ...recent.map((h) => `- ${txLink(h)}`));
      else lines.push("No router transactions in this window.");
      return text(lines.join("\n"));
    }),
);

server.registerTool(
  "governance_check",
  {
    title: "Governance check",
    description:
      "Verifies SpliceX's on-chain admin setup: that every owned contract is owned by the 2-of-3 Safe with no pending ownership transfer, and which router version is live. Use for security or trust questions.",
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async () =>
    guard(async () => {
      const owned = Object.values(CONTRACTS).filter((c) => c.owned);
      const rows = await Promise.all(
        owned.map(async (c) => {
          const [owner, pending] = await Promise.allSettled([
            client.readContract({ address: c.address, abi: ownableAbi, functionName: "owner" }),
            client.readContract({ address: c.address, abi: ownableAbi, functionName: "pendingOwner" }),
          ]);
          const o = owner.status === "fulfilled" ? getAddress(owner.value) : undefined;
          const p = pending.status === "fulfilled" ? getAddress(pending.value) : undefined;
          const ok = o === SAFE && (p === undefined || p === ZERO);
          const detail = !o ? "couldn't read owner()" : o === SAFE ? "owned by the Safe" : `owned by ${o}, not the Safe`;
          const pend = p && p !== ZERO ? `; pending transfer to ${p}` : "";
          return { ok, line: `${ok ? "OK  " : "FLAG"} ${c.name}: ${detail}${pend}` };
        }),
      );
      const version = await client
        .readContract({ address: CONTRACTS.router.address, abi: versionAbi, functionName: "VERSION" })
        .then((v) => `Live router reports VERSION() = ${v} (16 = v1.6).`)
        .catch(() => "Couldn't read the router's VERSION().");
      const allOk = rows.every((r) => r.ok);
      return text(
        [
          allOk ? "All owned SpliceX contracts are controlled by the 2-of-3 Safe." : "Some contracts need attention:",
          `Safe: ${addr(SAFE)}`,
          ...rows.map((r) => r.line),
          version,
        ].join("\n"),
      );
    }),
);

await server.connect(new StdioServerTransport());
