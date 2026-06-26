interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * FINRA Reg SHO daily short-sale volume.
 *
 * FINRA publishes daily short-sale volume by symbol across two Trade
 * Reporting Facilities — Nasdaq TRF (FNSQ) and NYSE TRF (FNYX). Each
 * file is a pipe-delimited TXT at cdn.finra.org. To get a symbol's
 * full short volume we combine rows from both TRFs.
 *
 * The deprecated FNRA prefix returns an empty file; current data lives
 * exclusively in FNSQ + FNYX. We aggregate across both transparently.
 *
 * Publishing lag is typically T+1 (yesterday's file appears late
 * morning ET), with occasional 2–3 day delays around month-end. The
 * default-date logic searches back up to 7 days for the most recent
 * file with data.
 *
 * Data source: https://cdn.finra.org/equity/regsho/daily/
 * Background: https://www.finra.org/finra-data/browse-catalog/short-sale-volume-daily
 */


const BASE = 'https://cdn.finra.org/equity/regsho/daily';
const UA = 'pipeworx-mcp-finra/1.0 (+https://pipeworx.io)';
const TRFS = [
  { code: 'FNSQ', label: 'Nasdaq TRF' },
  { code: 'FNYX', label: 'NYSE TRF' },
] as const;

interface ShortRow {
  date: string;
  symbol: string;
  short_volume: number;
  short_exempt_volume: number;
  total_volume: number;
  market: string;
}

const tools: McpToolExport['tools'] = [
  {
    name: 'short_volume_daily',
    description:
      'FINRA Reg SHO daily short-sale volume for one symbol, combined across the Nasdaq TRF (FNSQ) and NYSE TRF (FNYX). Returns short_volume, short_exempt_volume, total_volume, and short_ratio (short / total). Publishing lag is T+1; omit `date` to use the most recent published file.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Ticker (case-insensitive), e.g. "AAPL"' },
        date: { type: 'string', description: 'YYYY-MM-DD or YYYYMMDD. Defaults to the most recent published trading day.' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'short_volume_history',
    description:
      'FINRA Reg SHO daily short-sale volume time series for one symbol. Returns up to 30 days of records ending at `end_date` (default: most recent published file).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Ticker (case-insensitive)' },
        days: { type: 'number', description: '1–30 (default 10)' },
        end_date: { type: 'string', description: 'YYYY-MM-DD or YYYYMMDD; defaults to most recent published file' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'short_volume_top',
    description:
      'Ranks symbols on a given trading day by short_ratio (short_volume / total_volume), aggregated across both TRFs. Useful for spotting heavily-shorted names; combine with a min_volume filter to exclude thinly-traded micros.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD or YYYYMMDD; defaults to most recent published file' },
        limit: { type: 'number', description: '1–100 (default 25)' },
        min_total_volume: { type: 'number', description: 'Skip symbols below this combined-TRF total volume (default 100000)' },
      },
      required: [],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'short_volume_daily':
      return shortVolumeDaily(args);
    case 'short_volume_history':
      return shortVolumeHistory(args);
    case 'short_volume_top':
      return shortVolumeTop(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function shortVolumeDaily(args: Record<string, unknown>) {
  const symbol = reqStr(args, 'symbol', '"AAPL"').toUpperCase();
  const resolved = await resolveDate(args.date as string | undefined);
  if (!resolved.ok) return resolved.softFail;

  const rows = await fetchTrfsForDate(resolved.date, symbol);
  if (rows.length === 0) {
    return {
      found: false,
      symbol,
      date: formatDate(resolved.date),
      reason: 'symbol_not_in_file',
      hint: `No short-volume rows for ${symbol} on ${formatDate(resolved.date)} in either TRF. This is normal for symbols with no FINRA-reported short volume that day; try a different date or use short_volume_history to see when the symbol last had data.`,
    };
  }
  return summarize(symbol, resolved.date, rows);
}

async function shortVolumeHistory(args: Record<string, unknown>) {
  const symbol = reqStr(args, 'symbol', '"AAPL"').toUpperCase();
  const days = clamp(toNum(args.days, 10), 1, 30);
  const resolved = await resolveDate(args.end_date as string | undefined);
  if (!resolved.ok) return resolved.softFail;

  // Walk back from end_date, skipping weekends and missing files.
  const series: Array<ReturnType<typeof summarize>> = [];
  let cursor = resolved.date;
  let attempts = 0;
  while (series.length < days && attempts < days * 3) {
    attempts++;
    if (isWeekday(cursor)) {
      const rows = await fetchTrfsForDate(cursor, symbol);
      if (rows.length > 0) {
        series.push(summarize(symbol, cursor, rows));
      }
    }
    cursor = stepBack(cursor);
  }
  return {
    symbol,
    end_date: formatDate(resolved.date),
    days_returned: series.length,
    days_requested: days,
    series,
  };
}

async function shortVolumeTop(args: Record<string, unknown>) {
  const limit = clamp(toNum(args.limit, 25), 1, 100);
  const minVol = Math.max(0, toNum(args.min_total_volume, 100_000));
  const resolved = await resolveDate(args.date as string | undefined);
  if (!resolved.ok) return resolved.softFail;

  // Fetch all rows from both TRFs (no symbol filter)
  const allRows: ShortRow[] = [];
  for (const trf of TRFS) {
    allRows.push(...(await fetchTrf(trf.code, resolved.date)));
  }
  // Aggregate by symbol
  const bySym = new Map<string, ShortRow>();
  for (const r of allRows) {
    const cur = bySym.get(r.symbol);
    if (cur) {
      cur.short_volume += r.short_volume;
      cur.short_exempt_volume += r.short_exempt_volume;
      cur.total_volume += r.total_volume;
    } else {
      bySym.set(r.symbol, { ...r });
    }
  }
  const ranked = Array.from(bySym.values())
    .filter((r) => r.total_volume >= minVol)
    .map((r) => ({
      symbol: r.symbol,
      short_volume: r.short_volume,
      short_exempt_volume: r.short_exempt_volume,
      total_volume: r.total_volume,
      short_ratio: r.total_volume > 0 ? r.short_volume / r.total_volume : 0,
    }))
    .sort((a, b) => b.short_ratio - a.short_ratio)
    .slice(0, limit);

  return {
    date: formatDate(resolved.date),
    min_total_volume: minVol,
    symbols_considered: bySym.size,
    symbols_returned: ranked.length,
    top: ranked,
  };
}

function summarize(symbol: string, date: string, rows: ShortRow[]) {
  const totals = rows.reduce(
    (acc, r) => {
      acc.short_volume += r.short_volume;
      acc.short_exempt_volume += r.short_exempt_volume;
      acc.total_volume += r.total_volume;
      return acc;
    },
    { short_volume: 0, short_exempt_volume: 0, total_volume: 0 },
  );
  return {
    symbol,
    date: formatDate(date),
    combined: {
      ...totals,
      short_ratio: totals.total_volume > 0 ? totals.short_volume / totals.total_volume : 0,
    },
    by_trf: rows.map((r) => {
      const trf = TRFS.find((t) => t.code === marketToTrf(r.market));
      return {
        trf_code: marketToTrf(r.market),
        trf_label: trf?.label ?? r.market,
        short_volume: r.short_volume,
        short_exempt_volume: r.short_exempt_volume,
        total_volume: r.total_volume,
      };
    }),
  };
}

function marketToTrf(market: string): string {
  // FNSQ rows carry market="Q" (Nasdaq), FNYX rows carry market="N" (NYSE).
  if (market === 'Q') return 'FNSQ';
  if (market === 'N') return 'FNYX';
  return market;
}

async function fetchTrfsForDate(date: string, symbol: string): Promise<ShortRow[]> {
  const out: ShortRow[] = [];
  for (const trf of TRFS) {
    const rows = await fetchTrf(trf.code, date);
    for (const r of rows) {
      if (r.symbol === symbol) out.push(r);
    }
  }
  return out;
}

const FETCH_CACHE = new Map<string, ShortRow[] | null>();

async function fetchTrf(code: string, date: string): Promise<ShortRow[]> {
  const key = `${code}:${date}`;
  if (FETCH_CACHE.has(key)) return FETCH_CACHE.get(key) ?? [];
  const url = `${BASE}/${code}shvol${date}.txt`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/plain' } });
  if (res.status === 404 || res.status === 403) {
    FETCH_CACHE.set(key, null);
    return [];
  }
  if (!res.ok) {
    throw new Error(`FINRA ${code} ${date}: HTTP ${res.status}`);
  }
  const text = await res.text();
  const rows = parseFile(text);
  FETCH_CACHE.set(key, rows);
  return rows;
}

function parseFile(text: string): ShortRow[] {
  const out: ShortRow[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line || line === '0') continue;
    if (line.startsWith('Date|')) continue;
    const parts = line.split('|');
    if (parts.length < 6) continue;
    const sv = Number(parts[2]);
    const sev = Number(parts[3]);
    const tv = Number(parts[4]);
    if (!Number.isFinite(sv) || !Number.isFinite(tv)) continue;
    out.push({
      date: parts[0],
      symbol: parts[1],
      short_volume: sv,
      short_exempt_volume: Number.isFinite(sev) ? sev : 0,
      total_volume: tv,
      market: parts[5],
    });
  }
  return out;
}

/**
 * Convert YYYY-MM-DD or YYYYMMDD to YYYYMMDD; if no input, walk back up
 * to 7 days from today to find a date with published data on the
 * Nasdaq TRF (FNSQ — the higher-volume of the two). Soft-fails with a
 * structured hint if we can't find any data in that window.
 */
async function resolveDate(input: string | undefined): Promise<
  | { ok: true; date: string }
  | { ok: false; softFail: { found: false; reason: string; hint: string } }
> {
  if (input && input.trim()) {
    const normalized = input.replace(/-/g, '');
    if (!/^\d{8}$/.test(normalized)) {
      return {
        ok: false,
        softFail: {
          found: false,
          reason: 'invalid_date',
          hint: `date must be YYYY-MM-DD or YYYYMMDD; got "${input}"`,
        },
      };
    }
    return { ok: true, date: normalized };
  }
  // Probe back from today.
  let cursor = todayUtc();
  for (let i = 0; i < 7; i++) {
    if (isWeekday(cursor)) {
      const rows = await fetchTrf('FNSQ', cursor);
      if (rows.length > 0) return { ok: true, date: cursor };
    }
    cursor = stepBack(cursor);
  }
  return {
    ok: false,
    softFail: {
      found: false,
      reason: 'no_recent_data',
      hint: 'No published FINRA Reg SHO files in the last 7 days. Publishing lag is T+1; if today is Saturday/Sunday/Monday, Friday is usually the most recent. Pass `date` explicitly with a YYYY-MM-DD you know to be a recent weekday.',
    },
  };
}

function todayUtc(): string {
  const d = new Date();
  return ymd(d);
}

function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function stepBack(yyyymmdd: string): string {
  const d = new Date(`${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return ymd(d);
}

function isWeekday(yyyymmdd: string): boolean {
  const d = new Date(`${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}T00:00:00Z`);
  const day = d.getUTCDay();
  return day !== 0 && day !== 6;
}

function formatDate(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

function reqStr(args: Record<string, unknown>, key: string, example: string): string {
  const v = args[key];
  if (typeof v !== 'string' || !v.trim()) {
    throw new Error(`Required argument "${key}" is missing. Pass a string like ${example}.`);
  }
  return v;
}

function toNum(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return fallback;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
