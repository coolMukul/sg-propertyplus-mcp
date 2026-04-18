// Central configuration — API URLs, defaults, and constants.
// All endpoints are free, zero-key APIs verified working April 2026.
// Defaults can be overridden via environment variables (see .env.example).

function envInt(key: string, fallback: number): number {
  const val = process.env[key];
  if (!val) return fallback;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? fallback : parsed;
}

export const SERVER_NAME = "sg-propertyplus";
export const SERVER_VERSION = "0.1.0";

export const USER_AGENT = process.env.USER_AGENT || "SG-PropertyPlus-MCP/0.1.0";

// Nominatim (OpenStreetMap) — geocoding
export const NOMINATIM_URL =
  process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org/search";

// URA ArcGIS — Master Plan 2019 land use spatial query
export const ARCGIS_LAND_USE_URL =
  process.env.ARCGIS_LAND_USE_URL ||
  "https://maps.ura.gov.sg/arcgis/rest/services/MP19/Updated_Landuse_gaz/MapServer/24/query";

// data.gov.sg — HDB resale flat prices (2017 onwards)
export const DATAGOV_URL =
  process.env.DATAGOV_URL || "https://data.gov.sg/api/action/datastore_search";
export const HDB_RESALE_RESOURCE_ID =
  process.env.HDB_RESALE_RESOURCE_ID || "f1765b54-a209-4718-8d38-a39237f502b3";

// data.gov.sg — General Information of Schools (MOE)
export const SCHOOL_RESOURCE_ID =
  process.env.SCHOOL_RESOURCE_ID || "d_688b934f82c1059ed0a6993d2a829089";

// Additional delay (ms) before each data.gov.sg API call.
// Applied ON TOP of the 500ms rate limiter interval.
// data.gov.sg rate-limits aggressively (429 after rapid requests).
// Default 2s; increase if you're still hitting 429s.
export const DATAGOV_DELAY_MS = envInt("DATAGOV_DELAY_MS", 2_000);

// OneMap API (Phase 6 — replaces Nominatim for SG geocoding)
// Credentials are optional — when absent, falls back to Nominatim.
// ONEMAP_TOKEN: paste the access token from registration (expires every 3 days).
// ONEMAP_EMAIL + ONEMAP_PASSWORD: used for automatic token refresh when the token expires.
export const ONEMAP_TOKEN = process.env.ONEMAP_TOKEN || "";
export const ONEMAP_EMAIL = process.env.ONEMAP_EMAIL || "";
export const ONEMAP_PASSWORD = process.env.ONEMAP_PASSWORD || "";
export const ONEMAP_BASE_URL =
  process.env.ONEMAP_BASE_URL || "https://www.onemap.gov.sg";

// URA Data Service (Phase 7 — free registration at https://eservice.ura.gov.sg/maps/api/reg.html)
// Private property transactions and rental data.
// AccessKey is permanent. Token refreshes daily via insertNewToken/v1.
export const URA_ACCESS_KEY = process.env.URA_ACCESS_KEY || "";
export const URA_BASE_URL =
  process.env.URA_BASE_URL || "https://eservice.ura.gov.sg/uraDataService";

// Overpass API (OpenStreetMap) — nearby amenities (Phase 8)
// Free, no key. Uses OSM data under ODbL license.
export const OVERPASS_URL =
  process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";

// LTA DataMall (Phase 9 — free registration at https://datamall.lta.gov.sg)
// Transport data: bus stops, bus arrival, taxi availability/stands.
// AccountKey is permanent, sent via header.
export const LTA_ACCOUNT_KEY = process.env.LTA_ACCOUNT_KEY || "";
export const LTA_BASE_URL =
  process.env.LTA_BASE_URL || "https://datamall2.mytransport.sg/ltaodataservice";

// SingStat Table Builder — Singapore Department of Statistics.
// Free, no API key. Provides demographic data by planning area (2020 Census).
export const SINGSTAT_BASE_URL =
  process.env.SINGSTAT_BASE_URL || "https://tablebuilder.singstat.gov.sg/api/table";

// SingStat rate-limit backoff on 429/503 — 15s floor per learned practice on
// public free APIs; shorter retries risk longer IP bans.
export const SINGSTAT_BACKOFF_MS = envInt("SINGSTAT_BACKOFF_MS", 15_000);

// Radius bounds for spatial queries (meters)
export const RADIUS_MIN = envInt("RADIUS_MIN", 10);
export const RADIUS_MAX = envInt("RADIUS_MAX", 5000);
export const RADIUS_DEFAULT = envInt("RADIUS_DEFAULT", 50);

// Default result limits
export const HDB_LIMIT_DEFAULT = envInt("HDB_LIMIT_DEFAULT", 10);
export const ARCGIS_RESULT_LIMIT = envInt("ARCGIS_RESULT_LIMIT", 50);

// Default result limits for private property queries
export const PRIVATE_TXN_LIMIT_DEFAULT = envInt("PRIVATE_TXN_LIMIT_DEFAULT", 20);

// Sampling defaults (Phase 3 — analyze_results tool)
export const SAMPLING_MAX_TOKENS = envInt("SAMPLING_MAX_TOKENS", 2048);

// Transport (Phase 5 — Streamable HTTP)
// TRANSPORT: "stdio" (default) or "http"
// HTTP_MODE: "stateful" (default) or "stateless"
export const TRANSPORT = (process.env.TRANSPORT || "stdio") as "stdio" | "http";
export const HTTP_MODE = (process.env.HTTP_MODE || "stateful") as
  | "stateful"
  | "stateless";
export const HTTP_PORT = envInt("HTTP_PORT", 3000);
export const HTTP_HOST = process.env.HTTP_HOST || "127.0.0.1";
export const HTTP_SESSION_TTL_SECONDS = envInt("HTTP_SESSION_TTL_SECONDS", 1800); // 30 min default
