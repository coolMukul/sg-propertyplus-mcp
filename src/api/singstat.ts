// SingStat Table Builder client — demographic statistics by planning area.
// Free, no API key. Data sourced from Census of Population 2020.
//
// Tables return rows indexed by planning area (rowText). Columns can be
// flat (key/value) or nested (key + sub-columns). The flattener here
// preserves one level of nesting so property callers can drill from
// "HDB Dwellings" into "3-Room Flats" etc.

import { SINGSTAT_BASE_URL, SINGSTAT_BACKOFF_MS, USER_AGENT } from "../config.js";
import { singstatLimiter } from "../rate-limiter.js";
import type { DemographicDimension, DemographicMetric } from "../types.js";

// --- Raw response types ---

interface RawColumn {
  key: string;
  value?: string;
  columns?: RawColumn[];
}

interface RawRow {
  rowNo: string;
  rowText: string;
  uoM: string;
  footnote?: string;
  columns: RawColumn[];
}

interface RawTableData {
  id: string;
  title: string;
  tableType: string;
  dataSource?: string;
  frequency?: string;
  dataLastUpdated?: string;
  row: RawRow[];
}

interface TabledataResponse {
  Data?: RawTableData;
  StatusCode?: number;
  Message?: string;
}

// --- Table registry ---

/** Census of Population 2020 tables that index by planning area. */
export const DEMOGRAPHIC_TABLES = {
  dwelling: { id: "17574", label: "Type of Dwelling" },
  size: { id: "17778", label: "Household Size" },
  income: { id: "17779", label: "Monthly Household Income" },
  tenancy: { id: "17776", label: "Tenancy" },
} as const;

export type DemographicCategory = keyof typeof DEMOGRAPHIC_TABLES;

// --- In-memory cache ---
// Each table is small (~50 rows) and changes only with each Census (every 10
// years). Cache for the process lifetime. Uses the fetch-once pattern so
// concurrent callers share a single inflight fetch.

const cache = new Map<string, RawTableData>();
const inflight = new Map<string, Promise<RawTableData>>();

// --- Core fetch with retry ---

async function fetchTableRaw(id: string): Promise<RawTableData> {
  const cached = cache.get(id);
  if (cached) return cached;

  const existing = inflight.get(id);
  if (existing) return existing;

  const promise = doFetch(id).finally(() => inflight.delete(id));
  inflight.set(id, promise);
  const result = await promise;
  cache.set(id, result);
  return result;
}

async function doFetch(id: string): Promise<RawTableData> {
  const MAX_RETRIES = 1;
  let lastError = "";

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await singstatLimiter.wait();

    let response: Response;
    try {
      response = await fetch(`${SINGSTAT_BASE_URL}/tabledata/${id}`, {
        headers: { "User-Agent": USER_AGENT },
      });
    } catch (err: any) {
      lastError = err?.message ?? "network error";
      if (attempt < MAX_RETRIES) {
        console.error(`[singstat] Network error on table ${id}, backing off ${SINGSTAT_BACKOFF_MS}ms`);
        await new Promise((r) => setTimeout(r, SINGSTAT_BACKOFF_MS));
        continue;
      }
      break;
    }

    if (response.status === 429 || response.status === 503) {
      lastError = `HTTP ${response.status}`;
      console.error(`[singstat] HTTP ${response.status} on table ${id} — backing off ${SINGSTAT_BACKOFF_MS}ms`);
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, SINGSTAT_BACKOFF_MS));
        continue;
      }
      break;
    }

    if (response.status === 404) {
      throw new Error(`Table ${id} not found`);
    }

    if (!response.ok) {
      throw new Error(`Unexpected status ${response.status} for table ${id}`);
    }

    const json = (await response.json()) as TabledataResponse;
    if (!json.Data || !Array.isArray(json.Data.row)) {
      throw new Error(`Malformed response for table ${id}`);
    }
    return json.Data;
  }

  throw new Error(`Failed to fetch table ${id} after ${MAX_RETRIES + 1} attempts: ${lastError}`);
}

// --- Planning-area matching ---

function normalizeAreaName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Find the row for a planning area — exact, then case-insensitive contains. */
function findAreaRow(rows: RawRow[], query: string): RawRow | null {
  const needle = normalizeAreaName(query);
  // Exact match first
  for (const r of rows) {
    if (normalizeAreaName(r.rowText) === needle) return r;
  }
  // Contains match (handles "ang mo kio" vs "Ang Mo Kio Town" if SingStat ever adds suffix)
  for (const r of rows) {
    if (normalizeAreaName(r.rowText).includes(needle)) return r;
  }
  return null;
}

// --- Column flattening ---

function toNumber(s: string | undefined): number | null {
  if (!s) return null;
  const trimmed = s.replace(/,/g, "").trim();
  if (!trimmed || trimmed === "-" || trimmed === "na" || trimmed === "NA") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * Flatten one row's columns into metrics, preserving one level of nesting.
 * The "Total" column (if present at top level) becomes the dimension total;
 * all siblings become metrics; nested columns with their own "Total" contribute
 * the subtotal and children.
 */
function flattenRow(row: RawRow): { total: number | null; metrics: DemographicMetric[] } {
  let total: number | null = null;
  const metrics: DemographicMetric[] = [];

  for (const col of row.columns) {
    if (col.key.toLowerCase() === "total" && col.value !== undefined) {
      total = toNumber(col.value);
      continue;
    }

    if (col.columns && col.columns.length > 0) {
      // Nested: find "Total" as the value, siblings as children
      let subtotal: number | null = null;
      const children: DemographicMetric[] = [];
      for (const sub of col.columns) {
        const subVal = toNumber(sub.value);
        // Strip trailing footnote markers like "1/" or "2/"
        const cleanKey = sub.key.replace(/\d+\/$/, "").trim();
        if (cleanKey.toLowerCase() === "total") {
          subtotal = subVal;
        } else {
          children.push({ label: cleanKey, value: subVal });
        }
      }
      metrics.push({
        label: col.key.replace(/\d+\/$/, "").trim(),
        value: subtotal,
        children: children.length > 0 ? children : undefined,
      });
    } else {
      metrics.push({
        label: col.key.replace(/\d+\/$/, "").trim(),
        value: toNumber(col.value),
      });
    }
  }

  // Compute top-level percentages vs total
  if (total !== null && total > 0) {
    for (const m of metrics) {
      if (m.value !== null) m.pctOfTotal = (m.value / total) * 100;
    }
  }

  return { total, metrics };
}

// --- Public query ---

export interface DimensionResult {
  dimension?: DemographicDimension;
  error?: string;
}

/**
 * Fetch demographic data for a single dimension at a planning area.
 * Returns the dimension or an error message (never throws on recoverable issues).
 */
export async function queryDemographicDimension(
  category: DemographicCategory,
  planningArea: string,
): Promise<DimensionResult> {
  const entry = DEMOGRAPHIC_TABLES[category];
  if (!entry) {
    return { error: `Unknown demographic category: ${category}` };
  }

  let raw: RawTableData;
  try {
    raw = await fetchTableRaw(entry.id);
  } catch (err: any) {
    return { error: `Could not load ${entry.label} data: ${err?.message ?? "unknown error"}` };
  }

  const row = findAreaRow(raw.row, planningArea);
  if (!row) {
    return { error: `No ${entry.label} data for "${planningArea}"` };
  }

  const { total, metrics } = flattenRow(row);

  return {
    dimension: {
      name: entry.label,
      source: raw.tableType,
      lastUpdated: raw.dataLastUpdated,
      uom: row.uoM,
      total,
      metrics,
    },
  };
}

/** List all planning-area names present in a given table (for suggestions). */
export async function listPlanningAreas(
  category: DemographicCategory = "dwelling",
): Promise<string[]> {
  const entry = DEMOGRAPHIC_TABLES[category];
  try {
    const raw = await fetchTableRaw(entry.id);
    return raw.row
      .map((r) => r.rowText)
      .filter((name) => name && name.toLowerCase() !== "total");
  } catch {
    return [];
  }
}
