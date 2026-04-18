// LTA DataMall API client — bus stops, bus arrival, taxi availability/stands.
// Free registration, permanent AccountKey sent via header.
// Paginated: 500 records per call, use $skip to get more.
// Bus stops and taxi stands are static datasets — cached in memory after first fetch.

import { LTA_ACCOUNT_KEY, LTA_BASE_URL, USER_AGENT } from "../config.js";
import { ltaLimiter } from "../rate-limiter.js";
import type { BusStopInfo, BusArrivalService, TaxiStandInfo } from "../types.js";

// --- Raw API response types ---

interface LtaPageResponse<T> {
  "odata.metadata": string;
  value: T[];
}

interface RawBusStop {
  BusStopCode: string;
  RoadName: string;
  Description: string;
  Latitude: number;
  Longitude: number;
}

interface RawTaxiStand {
  TaxiCode: string;
  Latitude: number;
  Longitude: number;
  Bfa: string;      // "Yes" or "No"
  Ownership: string; // "LTA", "CCS", "Private"
  Type: string;      // "Stand" or "Stop"
  Name: string;
}

interface RawBusArrivalResponse {
  "odata.metadata": string;
  BusStopCode: string;
  Services: RawBusArrivalService[];
}

interface RawBusArrivalService {
  ServiceNo: string;
  Operator: string;
  NextBus: RawNextBus;
  NextBus2: RawNextBus;
  NextBus3: RawNextBus;
}

interface RawNextBus {
  EstimatedArrival: string; // ISO 8601 or empty
  Load: string;
  Feature: string;
  Type: string;
}

// --- Haversine ---

function haversineMeters(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// --- Generic fetch + pagination ---

async function ltaGet<T>(
  path: string,
  params?: Record<string, string>,
  onWait?: () => void | Promise<void>,
): Promise<{ data: T; error?: string }> {
  await ltaLimiter.wait(onWait ? async () => { await onWait(); } : undefined);

  const url = new URL(`${LTA_BASE_URL}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }

  let resp: Response;
  try {
    resp = await fetch(url.toString(), {
      headers: {
        AccountKey: LTA_ACCOUNT_KEY,
        accept: "application/json",
        "User-Agent": USER_AGENT,
      },
    });
  } catch (err: any) {
    console.error(`[lta] Network error: ${err.message}`);
    return { data: undefined as unknown as T, error: "Could not reach transport service. Retry after 30 seconds delay." };
  }

  if (!resp.ok) {
    console.error(`[lta] HTTP ${resp.status} for ${path}`);
    return { data: undefined as unknown as T, error: "Transport data service returned an error. Retry after 30 seconds delay." };
  }

  const json = await resp.json() as T;
  return { data: json };
}

/** Fetch all pages of a paginated LTA endpoint (500 records per page). */
async function ltaFetchAll<T>(
  path: string,
  onProgress?: (fetched: number) => void | Promise<void>,
  onWait?: () => void | Promise<void>,
): Promise<{ records: T[]; error?: string }> {
  let all: T[] = [];
  let skip = 0;
  const MAX_PAGES = 20; // safety: 10,000 records max

  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await ltaGet<LtaPageResponse<T>>(
      path, { $skip: String(skip) }, onWait,
    );
    if (error) return { records: all, error };

    const records = data.value ?? [];
    if (records.length === 0) break;

    all = all.concat(records);
    skip += 500;
    if (onProgress) await onProgress(all.length);
    if (records.length < 500) break;
  }

  return { records: all };
}

// --- In-memory cache for static datasets ---
// Bus stops and taxi stands change infrequently (ad hoc / monthly updates).
// Cache them for the process lifetime to avoid re-fetching 5000+ records per query.

let busStopCache: RawBusStop[] | null = null;
let taxiStandCache: RawTaxiStand[] | null = null;

// Fetch-once guards: if a fetch is already in flight, concurrent callers
// wait for the same promise instead of each hitting the API independently.
let busStopFetch: Promise<{ records: RawBusStop[]; error?: string }> | null = null;
let taxiStandFetch: Promise<{ records: RawTaxiStand[]; error?: string }> | null = null;

async function getAllBusStops(
  onProgress?: (fetched: number) => void | Promise<void>,
  onWait?: () => void | Promise<void>,
): Promise<{ records: RawBusStop[]; error?: string }> {
  if (busStopCache) return { records: busStopCache };
  if (busStopFetch) return busStopFetch;

  busStopFetch = (async () => {
    const result = await ltaFetchAll<RawBusStop>("/BusStops", onProgress, onWait);
    if (!result.error && result.records.length > 0) {
      busStopCache = result.records;
    }
    return result;
  })();

  try { return await busStopFetch; } finally { busStopFetch = null; }
}

async function getAllTaxiStands(
  onWait?: () => void | Promise<void>,
): Promise<{ records: RawTaxiStand[]; error?: string }> {
  if (taxiStandCache) return { records: taxiStandCache };
  if (taxiStandFetch) return taxiStandFetch;

  taxiStandFetch = (async () => {
    const result = await ltaFetchAll<RawTaxiStand>("/TaxiStands", undefined, onWait);
    if (!result.error && result.records.length > 0) {
      taxiStandCache = result.records;
    }
    return result;
  })();

  try { return await taxiStandFetch; } finally { taxiStandFetch = null; }
}

// --- Public API ---

export function isLtaConfigured(): boolean {
  return LTA_ACCOUNT_KEY.length > 0;
}

/** Parse ETA minutes from an ISO 8601 arrival string. Returns null if empty/past. */
function parseEtaMinutes(isoString: string): number | null {
  if (!isoString) return null;
  const eta = new Date(isoString);
  if (isNaN(eta.getTime())) return null;
  const mins = Math.round((eta.getTime() - Date.now()) / 60000);
  return mins >= 0 ? mins : 0; // 0 = arriving now
}

/**
 * Find bus stops near a coordinate, sorted by distance.
 */
export async function queryNearbyBusStops(
  lat: number,
  lon: number,
  radiusMeters: number,
  onProgress?: (fetched: number) => void | Promise<void>,
  onWait?: () => void | Promise<void>,
): Promise<{ stops: BusStopInfo[]; error?: string }> {
  const { records, error } = await getAllBusStops(onProgress, onWait);
  if (error) return { stops: [], error };

  const stops: BusStopInfo[] = records
    .map((raw) => {
      const dist = haversineMeters(lat, lon, raw.Latitude, raw.Longitude);
      return {
        busStopCode: raw.BusStopCode,
        roadName: raw.RoadName,
        description: raw.Description,
        lat: raw.Latitude,
        lon: raw.Longitude,
        distanceMeters: Math.round(dist),
      };
    })
    .filter((s) => s.distanceMeters <= radiusMeters)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);

  return { stops };
}

/**
 * Find taxi stands near a coordinate, sorted by distance.
 */
export async function queryNearbyTaxiStands(
  lat: number,
  lon: number,
  radiusMeters: number,
  onWait?: () => void | Promise<void>,
): Promise<{ stands: TaxiStandInfo[]; error?: string }> {
  const { records, error } = await getAllTaxiStands(onWait);
  if (error) return { stands: [], error };

  const stands: TaxiStandInfo[] = records
    .map((raw) => {
      const dist = haversineMeters(lat, lon, raw.Latitude, raw.Longitude);
      return {
        taxiCode: raw.TaxiCode,
        name: raw.Name,
        type: raw.Type,
        ownership: raw.Ownership,
        barrierFree: raw.Bfa === "Yes",
        lat: raw.Latitude,
        lon: raw.Longitude,
        distanceMeters: Math.round(dist),
      };
    })
    .filter((s) => s.distanceMeters <= radiusMeters)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);

  return { stands };
}

/**
 * Get real-time bus arrival times at a specific bus stop.
 */
export async function queryBusArrival(
  busStopCode: string,
  onWait?: () => void | Promise<void>,
): Promise<{ services: BusArrivalService[]; error?: string }> {
  const { data, error } = await ltaGet<RawBusArrivalResponse>(
    "/v3/BusArrival", { BusStopCode: busStopCode }, onWait,
  );
  if (error) return { services: [], error };

  const rawServices = data.Services ?? [];
  const services: BusArrivalService[] = rawServices.map((svc) => ({
    serviceNo: svc.ServiceNo,
    operator: svc.Operator,
    nextBusMinutes: parseEtaMinutes(svc.NextBus?.EstimatedArrival),
    nextBusLoad: svc.NextBus?.Load ?? "",
    nextBusType: svc.NextBus?.Type ?? "",
    nextBusFeature: svc.NextBus?.Feature ?? "",
    nextBus2Minutes: parseEtaMinutes(svc.NextBus2?.EstimatedArrival),
    nextBus2Load: svc.NextBus2?.Load ?? "",
    nextBus3Minutes: parseEtaMinutes(svc.NextBus3?.EstimatedArrival),
    nextBus3Load: svc.NextBus3?.Load ?? "",
  }));

  // Sort by nearest bus arrival
  services.sort((a, b) => (a.nextBusMinutes ?? 999) - (b.nextBusMinutes ?? 999));

  return { services };
}

/**
 * Count available taxis near a coordinate.
 * Returns the count and the nearest taxi distances.
 */
export async function queryNearbyTaxis(
  lat: number,
  lon: number,
  radiusMeters: number,
  onWait?: () => void | Promise<void>,
): Promise<{ count: number; nearestMeters: number | null; error?: string }> {
  // Taxi availability is real-time — not cached.
  // The API returns up to 500 per page, and there are thousands of taxis.
  // We paginate through all and filter by distance.
  let allTaxis: { Latitude: number; Longitude: number }[] = [];
  let skip = 0;

  for (let page = 0; page < 20; page++) {
    const { data, error } = await ltaGet<LtaPageResponse<{ Latitude: number; Longitude: number }>>(
      "/Taxi-Availability", { $skip: String(skip) }, onWait,
    );
    if (error) return { count: 0, nearestMeters: null, error };

    const records = data.value ?? [];
    if (records.length === 0) break;
    allTaxis = allTaxis.concat(records);
    skip += 500;
    if (records.length < 500) break;
  }

  let count = 0;
  let nearest = Infinity;

  for (const taxi of allTaxis) {
    const dist = haversineMeters(lat, lon, taxi.Latitude, taxi.Longitude);
    if (dist <= radiusMeters) {
      count++;
      if (dist < nearest) nearest = dist;
    }
  }

  return {
    count,
    nearestMeters: count > 0 ? Math.round(nearest) : null,
  };
}
