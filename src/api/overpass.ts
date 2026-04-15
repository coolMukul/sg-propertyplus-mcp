// Overpass API client — queries OpenStreetMap for nearby amenities.
// Free, no API key. Data licensed under ODbL.
// Rate limit: ~10,000 requests/day, max 2 concurrent queries per IP.
// We use a single combined query per tool call to minimise requests.

import { OVERPASS_URL, USER_AGENT } from "../config.js";
import { overpassLimiter } from "../rate-limiter.js";
import type { NearbyAmenity } from "../types.js";

// --- Overpass response types ---

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  version: number;
  generator: string;
  osm3s: { timestamp_osm_base: string; copyright: string };
  elements: OverpassElement[];
}

// --- Amenity category definitions ---

// Each entry maps an OSM tag key+value to our normalized category name.
// Order matters for the query builder — grouped by primary tag key.
const AMENITY_TAGS: { key: string; value: string; category: string }[] = [
  { key: "amenity", value: "school", category: "school" },
  { key: "amenity", value: "hospital", category: "hospital" },
  { key: "amenity", value: "clinic", category: "clinic" },
  { key: "amenity", value: "food_court", category: "food_court" },
  { key: "amenity", value: "marketplace", category: "marketplace" },
  { key: "amenity", value: "pharmacy", category: "pharmacy" },
  { key: "leisure", value: "park", category: "park" },
  { key: "railway", value: "station", category: "mrt" },
  { key: "highway", value: "bus_stop", category: "bus_stop" },
  { key: "shop", value: "supermarket", category: "supermarket" },
];

// Tags that appear as both nodes and ways/relations in OSM.
// bus_stop and railway=station are almost always nodes, so skip way queries for them.
const NODE_ONLY_CATEGORIES = new Set(["bus_stop", "mrt", "pharmacy"]);

// --- Distance calculation ---

/** Haversine distance in meters between two lat/lng points. */
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

// --- Query builder ---

/**
 * Build an Overpass QL query that fetches all amenity types within a radius.
 * Uses a single union query (one API call) to avoid rate limit issues.
 */
function buildQuery(
  lat: number,
  lon: number,
  radiusMeters: number,
  categories: string[],
): string {
  const around = `around:${radiusMeters},${lat},${lon}`;
  const categorySet = new Set(categories);

  const parts: string[] = [];
  for (const tag of AMENITY_TAGS) {
    if (!categorySet.has(tag.category)) continue;

    // Always query nodes
    parts.push(`  node["${tag.key}"="${tag.value}"](${around});`);

    // Query ways and relations for categories that use them
    if (!NODE_ONLY_CATEGORIES.has(tag.category)) {
      parts.push(`  way["${tag.key}"="${tag.value}"](${around});`);
      // Parks can be mapped as relations (multipolygon)
      if (tag.category === "park") {
        parts.push(`  relation["${tag.key}"="${tag.value}"](${around});`);
      }
    }
  }

  // "out center body" gives center coordinates for ways/relations
  return `[out:json][timeout:60];\n(\n${parts.join("\n")}\n);\nout center body;`;
}

// --- Category extraction ---

/** Determine normalized category from an element's tags. */
function extractCategory(tags: Record<string, string>): string {
  for (const tag of AMENITY_TAGS) {
    if (tags[tag.key] === tag.value) return tag.category;
  }
  return "other";
}

/** Build an address string from OSM addr:* tags if available. */
function extractAddress(tags: Record<string, string>): string | null {
  const parts: string[] = [];
  if (tags["addr:housenumber"]) parts.push(tags["addr:housenumber"]);
  if (tags["addr:street"]) parts.push(tags["addr:street"]);
  if (tags["addr:postcode"]) parts.push(`Singapore ${tags["addr:postcode"]}`);
  return parts.length > 0 ? parts.join(" ") : null;
}

// --- Public API ---

/** All supported amenity categories. */
export const SUPPORTED_CATEGORIES = AMENITY_TAGS.map((t) => t.category);

/**
 * Query nearby amenities around a coordinate.
 * Returns normalized NearbyAmenity records sorted by distance.
 */
export async function queryNearbyAmenities(
  lat: number,
  lon: number,
  radiusMeters: number,
  categories: string[],
  onWait?: () => void | Promise<void>,
): Promise<{ amenities: NearbyAmenity[]; error?: string }> {
  const query = buildQuery(lat, lon, radiusMeters, categories);

  // Retry with backoff on 429 (rate limited) and 504 (gateway timeout).
  // Overpass API has strict concurrency limits and intermittent gateway issues.
  const MAX_RETRIES = 3;
  let resp: Response | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await overpassLimiter.wait(onWait ? async () => { await onWait(); } : undefined);

    try {
      resp = await fetch(OVERPASS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": USER_AGENT,
        },
        body: `data=${encodeURIComponent(query)}`,
      });
    } catch (err: any) {
      if (attempt < MAX_RETRIES) continue;
      console.error(`[overpass] Network error: ${err.message}`);
      return { amenities: [], error: "Could not reach amenity service. Retry after 30 seconds delay." };
    }

    // Retry on 429 (rate limit) or 504 (gateway timeout)
    if ((resp.status === 429 || resp.status === 504) && attempt < MAX_RETRIES) {
      continue;
    }

    break;
  }

  if (!resp) {
    return { amenities: [], error: "Network error after retries." };
  }

  if (resp.status === 429) {
    return { amenities: [], error: "Service is busy. Retry after 30 seconds delay." };
  }

  if (!resp.ok) {
    return { amenities: [], error: `Service returned an error (status ${resp.status}).` };
  }

  let data: OverpassResponse;
  try {
    data = (await resp.json()) as OverpassResponse;
  } catch {
    return { amenities: [], error: "Invalid response from amenity service." };
  }

  // Transform elements to NearbyAmenity
  const amenities: NearbyAmenity[] = [];
  const seenIds = new Set<number>();

  for (const el of data.elements) {
    // Deduplicate (node+way for same entity can appear)
    if (seenIds.has(el.id)) continue;
    seenIds.add(el.id);

    const tags = el.tags ?? {};
    const name = tags.name ?? tags["name:en"] ?? "(unnamed)";

    // Extract coordinates — nodes have lat/lon, ways/relations have center
    let elLat: number | undefined;
    let elLon: number | undefined;
    if (el.lat !== undefined && el.lon !== undefined) {
      elLat = el.lat;
      elLon = el.lon;
    } else if (el.center) {
      elLat = el.center.lat;
      elLon = el.center.lon;
    }

    if (elLat === undefined || elLon === undefined) continue;

    const category = extractCategory(tags);
    const distance = haversineMeters(lat, lon, elLat, elLon);

    amenities.push({
      category,
      name,
      lat: elLat,
      lon: elLon,
      distanceMeters: Math.round(distance),
      address: extractAddress(tags),
      tags,
    });
  }

  // Sort by distance ascending (nearest first)
  amenities.sort((a, b) => a.distanceMeters - b.distanceMeters);

  return { amenities };
}
