// Nominatim (OpenStreetMap) geocoding client.
// Converts a Singapore address string to lat/lon coordinates.
// Free, no API key. Rate limit: 1 request per second.

import { NOMINATIM_URL, USER_AGENT } from "../config.js";
import { GeocodingResult } from "../types.js";
import { nominatimLimiter } from "../rate-limiter.js";

interface NominatimResponse {
  lat: string;
  lon: string;
  display_name: string;
}

export async function geocodeAddress(
  address: string,
  onWait?: (delayMs: number) => void | Promise<void>,
): Promise<GeocodingResult | null> {
  const params = new URLSearchParams({
    q: address,
    format: "json",
    limit: "1",
    countrycodes: "sg",
  });

  await nominatimLimiter.wait(onWait);

  const response = await fetch(`${NOMINATIM_URL}?${params}`, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!response.ok) {
    console.error(`Nominatim HTTP ${response.status}: ${response.statusText}`);
    return null;
  }

  const data = (await response.json()) as NominatimResponse[];

  if (data.length === 0) {
    return null;
  }

  const result = data[0];
  return {
    lat: parseFloat(result.lat),
    lon: parseFloat(result.lon),
    displayName: result.display_name,
  };
}
