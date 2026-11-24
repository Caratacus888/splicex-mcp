# SpliceX MCP server

An [MCP](https://modelcontextprotocol.io) server that lets Claude (or any MCP client) answer questions about [SpliceX](https://splicex.io) using live data from the Ink network.

Ask things like:

- "What is SpliceX and how are its fees split?"
- "Is the SpliceX router still owned by the Safe? Which version is live?"
- "How busy has the SpliceX router been in the last hour?"
- "Does wallet 0x… qualify for fee-free splicing?"
- "What's this token on Ink: 0x…?"

It is **read-only by design**: it holds no keys and never sends transactions.

## Tools

| Tool | What it does |
| --- | --- |
| `splicex_overview` | What SpliceX is, how a splice works, fees, fee split, safety design and every deployed contract address |
| `ink_status` | Chain id, latest block, block time and gas price (also a quick RPC health check) |
| `token_info` | Name, symbol, decimals and total supply of any ERC-20 on Ink |
| `wallet_balance` | ETH balance of a wallet, or its balance of a given token |
| `catx_fee_perk` | Whether a wallet gets fee-free splicing: holds ≥ 1,000,000 CATX **and** is a regular wallet or EIP-7702 account (contract wallets don't qualify) |
| `router_activity` | Events and transactions from the live router (v1.6) over the last N blocks, with explorer links |
| `governance_check` | Confirms every owned contract is owned by the 2-of-3 Safe with no pending transfer, and reads the live router's `VERSION()` |

## Design notes

- **Deterministic where it matters.** Every number comes from the chain or from fixed protocol facts, never from the model's memory. Claude decides *which* tool to call; the tools decide *what is true*.
- **Safe failure.** Bad input (an invalid address, a missing CATX address) returns a clear error message rather than crashing, so Claude can explain the problem or ask for what's missing.
- **RPC-friendly.** Log queries are split into 2,000-block chunks, and block ranges are capped.
- **Tool annotations.** Every tool is marked read-only, so clients can run them without extra confirmation.

## Setup

Requires Node.js 18 or later.

```bash
git clone https://github.com/Caratacus888/splicex-mcp.git
cd splicex-mcp
npm install
npm run build
```

### Claude Code

```bash
claude mcp add splicex -- node /full/path/to/splicex-mcp/dist/index.js
```

### Claude Desktop

Add this to `claude_desktop_config.json` (Settings → Developer → Edit Config), then restart Claude:

```json
{
  "mcpServers": {
    "splicex": {
      "command": "node",
      "args": ["/full/path/to/splicex-mcp/dist/index.js"]
    }
  }
}
```

### Optional environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `INK_RPC_URL` | `https://rpc-gel.inkonchain.com` | Ink RPC endpoint |
| `INK_EXPLORER_URL` | `https://explorer.inkonchain.com` | Explorer used for links |
| `CATX_ADDRESS` | CATX on Ink (`0x06A0…EdD3`) | Override the CATX token address |

## Testing

```bash
npm run build
npm test
```

The smoke test starts a simulated Ink RPC, launches the server over stdio exactly as Claude would, lists the tools and calls each one, including an invalid input that must fail politely.

## Stack

TypeScript, the official MCP TypeScript SDK, viem for on-chain reads, and zod for input validation.
