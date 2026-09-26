# @pipeworx/finra

FINRA short-sale data for US equities — daily short-sale **volume** from the Reg SHO
daily dataset, and bi-monthly consolidated **short interest**. Both come from the FINRA
Query API's `otcMarket` dataset group.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1683+ live data sources.

The two are different measurements and are constantly confused. Short *volume* is how
many shares traded short on a given day. Short *interest* is how many shares are
currently sold short and not yet covered, reported twice a month by settlement date —
that is the "% short / days-to-cover" figure investors quote.

## Tools

| Tool | What it returns |
|------|-----------------|
| `short_volume_daily` | One symbol's short-sale volume for one trading day, summed across every consolidated-NMS reporting facility: `short_volume`, `short_exempt_volume`, `total_volume`, `short_ratio`, and the per-facility split. |
| `short_volume_history` | Up to 30 trading days of the same series for one symbol, ending at `end_date`. One upstream request, not one per day. |
| `short_volume_top` | Symbols on one trading day ranked by `short_ratio`, with a `min_total_volume` filter to exclude thinly-traded micros. Scans the full published day (~12,300 symbols). |
| `short_interest` | One symbol's consolidated short interest by settlement date: open short position, change vs the prior settlement, days-to-cover, average daily volume, plus recent history. |

Publishing lag on the Reg SHO data is typically T+1 or better — 2026-08-25's rows were
queryable on 2026-08-25. Omit `date`/`end_date` and the pack probes back up to 7 days for
the most recent day with published rows. Short interest settles bi-monthly, so the newest
record is routinely a week or two old — that is the source's cadence, not staleness on
our side.

## Reporting facilities, and why the sum matters

`regShoDaily` returns **one row per reporting facility** per symbol per day. A symbol's
real short volume is the sum of them:

| Facility | Market code | Venue | In consolidated NMS? |
|---|---|---|---|
| `NQTRF` | `Q` | Nasdaq TRF Carteret | yes |
| `NYTRF` | `N` | NYSE TRF | yes |
| `NCTRF` | `B` | Nasdaq TRF Chicago | yes |
| `ORF` | `O` | OTC Reporting Facility | no — OTC / non-NMS securities |

`combined` sums every non-ORF facility, which reproduces FINRA's own consolidated CNMS
figure exactly. Verified 2026-08-25 against `CNMSshvol20260821`: GME on 2026-08-21 sums
to short 1,335,397.220545 / exempt 1,355 / total 2,315,275.403735, byte-identical to that
file's line (whose own market column reads `B,Q,N`), and market-wide the same day, 12,269
symbols summing to short 3,244,559,759 / total 6,564,367,888.

Until fleet #532 this pack read only the Nasdaq and NYSE TRFs and asserted current data
lived "exclusively" there. It does not: omitting Nasdaq TRF Chicago undercounted short
volume by **0.77%** and total volume by **0.88%** market-wide, every day, with a clean
200 and nothing in the response saying so — and far more on any symbol that trades
disproportionately on that facility.

ORF is excluded on purpose, and is a different thing from a missing facility: it is a
separate market, not a missing part of this one. A symbol with both gets its ORF volume
listed under `otc_reporting_facility` rather than folded into the NMS total; a symbol
with *only* ORF volume is returned with `scope: "otc_reporting_facility"` and a note,
rather than a zero.

## Symbol case is significant

A lowercase letter is FINRA's preferred-share marker. On 2026-08-21 `BCpC` (Bancorp
preferred series C, 2,267 shares) and `BCPC` (Balchem common, 52,413) are two different
securities in the same day's data, as are `TpC` and `TPC`.

The Query API's `equal` filter is **case-insensitive**, so asking for `BCPC` returns both.
This pack therefore never upper-cases a symbol: it resolves to exactly one security, and
if your input matches several it returns `reason: "ambiguous_symbol"` with the candidates
rather than adding a preferred series into a common stock's total. When a near-miss
symbol exists, it is named in `also_reported` so you can see it was left out.

## Auth

Keyless. The upstream answers without a credential, and no `_apiKey` is accepted.

Keyless is **not** the same as unencumbered — see Licence below.

## Licence and attribution

All four tools read the `otcMarket` dataset group at `api.finra.org`, covered by
[FINRA's Specific Terms for Equity Data](https://developer.finra.org/specific-terms-equity-data),
section 2.3. Two conditions bind us and are not optional:

- **Attribution.** FINRA must be clearly identified as the owner and source of the data
  and of anything derived from it. Every response from this pack therefore carries a
  leading `attribution` string, attached centrally in `callTool` so a new tool or a new
  early-return cannot ship unattributed by omission. It leads the object so a model
  synthesizing an answer reads it first, and it survives into `ask_pipeworx` answers
  because the answer path passes a pack's `structuredContent` through verbatim.
- **No incremental fee.** We may not charge for the data. The whole pack is therefore
  **zero-rated** at the gateway (`zeroRated: true` on its `MCP_PACKS` entry): zero credits
  on every tier including paid, no monthly-volume slot consumed, not counted as a billable
  lookup inside an answer, and quoted as zero in the pre-call cost disclosure. Responses
  carry `_meta.cost.zero_rated: true`. A metered version of any of these tools would be a
  licence breach, not a pricing choice — do not remove the flag.

End users may not redistribute the data further and are limited to non-commercial
personal or professional use; that condition is stated in the `attribution` string and in
section 6 of the published terms at https://pipeworx.io/terms.

**Do not reintroduce a `cdn.finra.org` fetch**, for a fallback or for freshness. The Reg
SHO daily *files* published there are a different distribution, outside the Specific
Terms; the general [FINRA.org Terms of Use](https://www.finra.org/terms-of-use) that
govern them instead are stricter — non-commercial use only, no redistribution without
prior written consent, no bulk copying of the website, no creating a database from it,
and an explicit bar on use "in conjunction with any machine learning, neural network,
deep learning, predictive analytics or other artificial intelligence computer or software
program", which is what every caller of this gateway is. Both routes carried 2026-08-21
on 2026-08-25, so there is no freshness trade to make.

Background: fleet #531 and #532, and the licence analysis in
`docs/finance-data-ingest-plan.md`.

## Data sources

- Reg SHO daily short-sale volume — `POST https://api.finra.org/data/group/otcMarket/name/regShoDaily`
- Consolidated short interest — `POST https://api.finra.org/data/group/otcMarket/name/consolidatedShortInterest`
- Field names and types — `GET https://api.finra.org/metadata/group/otcMarket/name/regShoDaily`
- Catalog: https://www.finra.org/finra-data/browse-catalog/short-sale-volume-daily

Upstream quirks worth knowing if you touch this pack: send `Accept: application/json` or
FINRA returns CSV; `limit` is capped server-side at 5,000 and the true match count is in
the `record-total` response header; a query matching nothing answers **204 with an empty
body**, not `[]`, so a naive `res.json()` throws a parse error that reads like a pack bug
when it means "no data for that day"; and sorting is rejected unless the partition key
(`tradeReportDate`) is pinned with an `equal` filter, so there is no "latest date" query —
the pack probes backwards instead.

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

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/finra/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1683+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## No MCP client? Call it over HTTP

```bash
curl -X POST https://gateway.pipeworx.io/v1/tools/short_volume_daily \
  -H 'Content-Type: application/json' \
  -d '{"symbol":"AAPL"}'
```

No account needed for the first calls. Inspect any tool: `GET https://gateway.pipeworx.io/v1/tools/short_volume_daily`. Find one: `POST https://gateway.pipeworx.io/v1/tools/search_packs` with `{"query":"..."}`.

## Standalone (no gateway account)

This package also runs as a local stdio MCP server — no Pipeworx account, no
gateway round-trip:

```json
{
  "mcpServers": {
    "finra": {
      "command": "npx",
      "args": ["-y", "@pipeworx/mcp-finra"]
    }
  }
}
```

Or run it directly to confirm it starts:

```bash
npx -y @pipeworx/mcp-finra
```

It speaks MCP over stdin/stdout and answers `initialize`/`tools/list`/`tools/call`
for **only** this pack's tools — none of the shared meta-tools the gateway
connection above adds. Same source, same tools, no ask_pipeworx routing.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Finra data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
