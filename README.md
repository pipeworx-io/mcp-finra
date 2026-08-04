# mcp-finra

FINRA Reg SHO daily short-sale volume.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `short_volume_daily` | FINRA Reg SHO daily short-sale volume for one symbol, combined across the Nasdaq TRF (FNSQ) and NYSE TRF (FNYX). Returns short_volume, short_exempt_volume, total_volume, and short_ratio (short / total). Publishing lag is T+1; omit `date` to use the most recent published file. |
| `short_volume_history` | FINRA Reg SHO daily short-sale volume time series for one symbol. Returns up to 30 days of records ending at `end_date` (default: most recent published file). |
| `short_volume_top` | Ranks symbols on a given trading day by short_ratio (short_volume / total_volume), aggregated across both TRFs. Useful for spotting heavily-shorted names; combine with a min_volume filter to exclude thinly-traded micros. |
| `short_interest` | FINRA consolidated SHORT INTEREST for one symbol — the bi-monthly settlement-date data: total open short position, days-to-cover, average daily volume, and change vs the prior settlement. This is the "% short / days-to-cover" metric investors cite — DISTINCT from short_volume_daily (daily short-sale VOLUME). Returns the latest settlement plus recent history. |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "finra": {
      "url": "https://gateway.pipeworx.io/finra/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Finra data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
