// OneMap (Singapore Land Authority) API client.
// Provides geocoding (search) and reverse geocoding for Singapore addresses.
// Replaces Nominatim with better SG accuracy and higher rate limits (250 req/min).
//
// Auth:
//   - Search endpoint works WITHOUT a token.
//   - Reverse geocode needs a token via Authorization header.
//   - Token can be set directly (ONEMAP_TOKEN) or fetched via email/password.
//   - Tokens expire every 3 days — auto-refreshes when email/password are configured.

import {
  ONEMAP_BASE_URL,
  ONEMAP_TOKEN,
  ONEMAP_EMAIL,
  ONEMAP_PASSWORD,
} from "../config.js";
import { GeocodingResult, ReverseGeocodeResult } from "../types.js";
import { onemapLimiter } from "../rate-limiter.js";

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------

let cachedToken: string | null = ONEMAP_TOKEN || null;
let tokenExpiry: number = 0; // Unix ms — 0 means unknown (use until rejected)

/** True if OneMap credentials are configured (either token or email/password). */
export function isOneMapConfigured(): boolean {
  return !!(ONEMAP_TOKEN || (ONEMAP_EMAIL && ONEMAP_PASSWORD));
}

/** True if we have a token available for authenticated endpoints. */
export function hasToken(): boolean {
  return !!(cachedToken || (ONEMAP_EMAIL && ONEMAP_PASSWORD));
}

/**
 * Get a valid token. Uses cached token if available, otherwise fetches
 * a new one via email/password. Returns null if no credentials are configured.
 */
async function getToken(): Promise<string | null> {
  // If cached token exists and hasn't expired, use it
  if (cachedToken && (tokenExpiry === 0 || Date.now() < tokenExpiry)) {
    return cachedToken;
  }

  // Try to refresh via email/password
  if (ONEMAP_EMAIL && ONEMAP_PASSWORD) {
    const refreshed = await refreshToken();
    if (refreshed) return cachedToken;
  }

  // If the direct token expired and we can't refresh, clear it
  if (cachedToken && tokenExpiry > 0 && Date.now() >= tokenExpiry) {
    console.error("[onemap] Token expired and no email/password configured for refresh");
    cachedToken = null;
  }

  return cachedToken;
}

/** Fetch a fresh token using email/password credentials. */
async function refreshToken(): Promise<boolean> {
  try {
    const url = `${ONEMAP_BASE_URL}/api/auth/post/getToken`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: ONEMAP_EMAIL, password: ONEMAP_PASSWORD }),
    });

    if (!res.ok) {
      console.error(`[onemap] Token refresh failed: HTTP ${res.status}`);
      return false;
    }

    const data = (await res.json()) as {
      access_token: string;
      expiry_timestamp: string;
    };

    if (!data.access_token) {
      console.error("[onemap] Token refresh: no access_token in response");
      return false;
    }

    cachedToken = data.access_token;
    // Parse expiry — OneMap returns a timestamp string (Unix seconds or ISO)
    const expiry = Number(data.expiry_timestamp);
    tokenExpiry = isNaN(expiry)
      ? Date.now() + 3 * 24 * 60 * 60 * 1000 // fallback: 3 days from now
      : expiry * 1000; // Convert seconds to ms

    console.error("[onemap] Token refreshed successfully");
    return true;
  } catch (error) {
    console.error("[onemap] Token refresh error:", error);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Search (geocoding) — address to lat/lng
// ---------------------------------------------------------------------------

interface OneMapSearchResult {
  SEARCHVAL: string;
  BLK_NO: string;
  ROAD_NAME: string;
  BUILDING: string;
  ADDRESS: string;
  POSTAL: string;
  X: string;
  Y: string;
  LATITUDE: string;
  LONGITUDE: string;
}

interface OneMapSearchResponse {
  found: number;
  totalNumPages: number;
  pageNum: number;
  results: OneMapSearchResult[];
}

/**
 * Geocode an address using OneMap search.
 * Works without authentication. Returns null if no results found.
 */
export async function geocodeAddress(
  address: string,
  onWait?: (delayMs: number) => void | Promise<void>,
): Promise<GeocodingResult | null> {
  const params = new URLSearchParams({
    searchVal: address,
    returnGeom: "Y",
    getAddrDetails: "Y",
    pageNum: "1",
  });

  await onemapLimiter.wait(onWait);

  const url = `${ONEMAP_BASE_URL}/api/common/elastic/search?${params}`;
  const res = await fetch(url);

  if (!res.ok) {
    console.error(`[onemap] Search HTTP ${res.status}: ${res.statusText}`);
    return null;
  }

  const data = (await res.json()) as OneMapSearchResponse;

  if (!data.results || data.results.length === 0) {
    return null;
  }

  const first = data.results[0];
  const lat = parseFloat(first.LATITUDE);
  const lon = parseFloat(first.LONGITUDE);

  if (isNaN(lat) || isNaN(lon)) {
    console.error("[onemap] Search returned non-numeric coordinates");
    return null;
  }

  // Build a display name from the available fields
  const parts: string[] = [];
  if (first.BUILDING && first.BUILDING !== "NIL") parts.push(first.BUILDING);
  if (first.BLK_NO) parts.push(`Blk ${first.BLK_NO}`);
  if (first.ROAD_NAME) parts.push(first.ROAD_NAME);
  if (first.POSTAL && first.POSTAL !== "NIL") parts.push(`Singapore ${first.POSTAL}`);
  const displayName = parts.length > 0 ? parts.join(", ") : first.ADDRESS;

  return { lat, lon, displayName };
}

// ---------------------------------------------------------------------------
// Reverse geocode — lat/lng to address
// ---------------------------------------------------------------------------

interface OneMapReverseGeocodeInfo {
  BUILDINGNAME: string;
  BLOCK: string;
  ROAD: string;
  POSTALCODE: string;
  XCOORD: string;
  YCOORD: string;
  LATITUDE: string;
  LONGITUDE: string;
}

interface OneMapReverseGeocodeResponse {
  GeocodeInfo: OneMapReverseGeocodeInfo[];
}

/**
 * Reverse geocode coordinates to get the nearest address.
 * Requires a valid token. Returns null if no results or no token available.
 */
export async function reverseGeocode(
  lat: number,
  lon: number,
  onWait?: (delayMs: number) => void | Promise<void>,
): Promise<ReverseGeocodeResult | null> {
  const token = await getToken();
  if (!token) {
    console.error("[onemap] Reverse geocode: no token available");
    return null;
  }

  await onemapLimiter.wait(onWait);

  const url = `${ONEMAP_BASE_URL}/api/public/revgeocode?location=${lat},${lon}&addressType=All`;
  const res = await fetch(url, {
    headers: { Authorization: token },
  });

  if (res.status === 401) {
    // Token might have expired — try refreshing once
    if (ONEMAP_EMAIL && ONEMAP_PASSWORD) {
      console.error("[onemap] Reverse geocode 401 — attempting token refresh");
      const refreshed = await refreshToken();
      if (refreshed && cachedToken) {
        await onemapLimiter.wait(onWait);
        const retryRes = await fetch(url, {
          headers: { Authorization: cachedToken },
        });
        if (retryRes.ok) {
          return parseReverseGeocodeResponse(await retryRes.json());
        }
      }
    }
    console.error("[onemap] Reverse geocode: unauthorized (token may be expired)");
    return null;
  }

  if (!res.ok) {
    console.error(`[onemap] Reverse geocode HTTP ${res.status}: ${res.statusText}`);
    return null;
  }

  return parseReverseGeocodeResponse(await res.json());
}

function parseReverseGeocodeResponse(
  data: OneMapReverseGeocodeResponse,
): ReverseGeocodeResult | null {
  if (!data.GeocodeInfo || data.GeocodeInfo.length === 0) {
    return null;
  }

  const info = data.GeocodeInfo[0];
  return {
    buildingName: info.BUILDINGNAME !== "NIL" ? info.BUILDINGNAME : null,
    block: info.BLOCK !== "NIL" ? info.BLOCK : null,
    road: info.ROAD,
    postalCode: info.POSTALCODE !== "NIL" ? info.POSTALCODE : null,
    lat: parseFloat(info.LATITUDE),
    lon: parseFloat(info.LONGITUDE),
  };
}
