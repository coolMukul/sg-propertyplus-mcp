// compare_areas — structured side-by-side comparison of two Singapore locations.
// Orchestrates existing API functions: geocoding, land use, amenities, transport,
// transactions, rental median, and pipeline. Computes deltas and verdicts.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  geocodeAddress as onemapGeocode,
  reverseGeocode as onemapReverseGeocode,
  isOneMapConfigured,
} from "../api/onemap.js";
import { geocodeAddress as nominatimGeocode } from "../api/nominatim.js";
import { queryLandUse } from "../api/arcgis.js";
import { queryNearbyAmenities } from "../api/overpass.js";
import { queryNearbyBusStops, queryNearbyTaxiStands, isLtaConfigured } from "../api/lta.js";
import {
  queryPrivateTransactions,
  queryRentalMedian,
  queryPipeline,
  isUraDataConfigured,
} from "../api/ura-data.js";
import { postalToDistrict } from "../district.js";
import { type ToolExtra, clampRadius, sendProgress, logInfo, PROPERTY_DISCLAIMER } from "../helpers.js";

// --- Types ---

interface LocationData {
  label: string;
  lat: number;
  lon: number;
  postalCode: string | null;
  district: string | null;
  zoning: string;
  plotRatio: string;
  planningArea: string;
  amenityCounts: Record<string, number>;
  nearestMrt: number | null;     // meters
  busStopCount: number;
  taxiStandCount: number;
  medianPsf: number | null;      // $/psf from transactions
  txnCount: number;
  medianRentPsf: number | null;  // $/psf/month from rental median
  pipelineUnits: number;
}

// --- Helpers ---

async function geocode(address: string): Promise<{ lat: number; lon: number; label: string; postalCode?: string } | null> {
  if (isOneMapConfigured()) {
    const result = await onemapGeocode(address);
    if (result) return { lat: result.lat, lon: result.lon, label: result.displayName, postalCode: result.postalCode };
  }
  const result = await nominatimGeocode(address);
  if (result) return { lat: result.lat, lon: result.lon, label: result.displayName };
  return null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function fmtNum(n: number): string {
  return Math.round(n).toLocaleString("en-SG");
}

function fmtDelta(a: number | null, b: number | null, label1: string, label2: string, unit: string, invert = false): string {
  if (a == null || b == null) return "—";
  if (a === b) return "Same";
  const diff = a - b;
  const pct = b !== 0 ? ((diff / b) * 100).toFixed(1) : "∞";
  const winner = invert ? (diff < 0 ? label1 : label2) : (diff > 0 ? label1 : label2);
  return `${winner} ${diff > 0 ? "+" : ""}${pct}%${unit ? ` ${unit}` : ""}`;
}

function fmtCountDelta(a: number, b: number, label1: string, label2: string): string {
  if (a === b) return "Same";
  const diff = a - b;
  const winner = diff > 0 ? label1 : label2;
  return `${winner} +${Math.abs(diff)}`;
}

function fmtDistDelta(a: number | null, b: number | null, label1: string, label2: string): string {
  if (a == null && b == null) return "—";
  if (a == null) return `${label2} only`;
  if (b == null) return `${label1} only`;
  if (a === b) return "Same";
  return a < b ? `${label1} closer` : `${label2} closer`;
}

// --- Data gathering ---

async function gatherLocationData(
  address: string,
  radiusMeters: number,
  extra: ToolExtra,
  stepLabel: string,
): Promise<LocationData | null> {
  // 1. Geocode (OneMap returns postal code directly; Nominatim doesn't)
  const geo = await geocode(address);
  if (!geo) return null;

  // 2. Derive URA district from postal code.
  // OneMap's search often returns NIL postal for street-name queries (matches
  // street segment, not a building). Fall back to reverse geocode using the
  // coordinates, which locates the nearest building and returns its postal code.
  let postalCode: string | null = geo.postalCode ?? null;
  if (!postalCode && isOneMapConfigured()) {
    const rev = await onemapReverseGeocode(geo.lat, geo.lon);
    postalCode = rev?.postalCode ?? null;
  }
  const district = postalToDistrict(postalCode);

  // 3. Land use (always available, no key needed)
  // Pick the most representative parcel: prefer residential, then first with a plot ratio
  const parcels = await queryLandUse(geo.lat, geo.lon, radiusMeters);
  const residentialParcel = parcels.find((p) => p.landUse.toUpperCase().includes("RESIDENTIAL"));
  const ratedParcel = parcels.find((p) => p.grossPlotRatio && p.grossPlotRatio !== "N/A" && p.grossPlotRatio !== "EVA");
  const topParcel = residentialParcel ?? ratedParcel ?? parcels[0];
  const zoning = topParcel?.landUse ?? "Unknown";
  const plotRatio = topParcel?.grossPlotRatio ?? "N/A";
  const planningArea = topParcel?.planningArea ?? "Unknown";

  // 4. Amenities (no key needed, but 5s rate limit)
  const ALL_CATEGORIES = [
    "school", "hospital", "clinic", "food_court", "marketplace",
    "park", "mrt", "bus_stop", "supermarket", "pharmacy",
  ];
  // MRT stations are routinely >500m from a street-centre coordinate, so a
  // single-radius query would produce "nearest MRT = none" almost always.
  // Overpass QL allows different `around:` radii within one union query, so we
  // bump just the MRT radius — one API call, no extra rate-limit pressure.
  const MRT_RADIUS = 2000;
  const amenityResult = await queryNearbyAmenities(
    geo.lat, geo.lon, radiusMeters, ALL_CATEGORIES,
    () => logInfo(extra, `${stepLabel}: waiting for amenity service…`),
    { mrt: MRT_RADIUS },
  );
  const { amenities } = amenityResult;

  const amenityCounts: Record<string, number> = {};
  for (const cat of ALL_CATEGORIES) {
    // MRT uses the larger radius, so don't include it in density counts —
    // it would be inconsistent with the other categories' user-chosen radius.
    if (cat === "mrt") continue;
    amenityCounts[cat] = amenities.filter((a) => a.category === cat).length;
  }

  const mrtStations = amenities.filter((a) => a.category === "mrt");
  const nearestMrt = mrtStations.length > 0 ? mrtStations[0].distanceMeters : null;

  // 5. Transport (needs LTA key)
  let busStopCount = 0;
  let taxiStandCount = 0;
  if (isLtaConfigured()) {
    const [busResult, taxiResult] = await Promise.all([
      queryNearbyBusStops(geo.lat, geo.lon, radiusMeters),
      queryNearbyTaxiStands(geo.lat, geo.lon, radiusMeters),
    ]);
    busStopCount = busResult.stops.length;
    taxiStandCount = taxiResult.stands.length;
  }

  return {
    label: geo.label,
    lat: geo.lat,
    lon: geo.lon,
    postalCode,
    district,
    zoning,
    plotRatio,
    planningArea,
    amenityCounts,
    nearestMrt,
    busStopCount,
    taxiStandCount,
    medianPsf: null,      // filled after URA fetch
    txnCount: 0,
    medianRentPsf: null,  // filled after URA fetch
    pipelineUnits: 0,
  };
}

// --- Output builder ---

function buildComparisonTable(a: LocationData, b: LocationData, name1: string, name2: string): string {
  const lines: string[] = [];
  lines.push(`## Area Comparison: ${name1} vs ${name2}`);
  lines.push("");

  const header = `| Category | ${name1} | ${name2} | Delta |`;
  const divider = "|---|---|---|---|";
  const rows: string[] = [];

  // Zoning
  rows.push(`| Planning Area | ${a.planningArea} | ${b.planningArea} | — |`);
  rows.push(`| Postal Code | ${a.postalCode ?? "—"} | ${b.postalCode ?? "—"} | — |`);
  rows.push(`| URA District | ${a.district ? "D" + a.district : "—"} | ${b.district ? "D" + b.district : "—"} | — |`);
  rows.push(`| Zoning | ${a.zoning} | ${b.zoning} | ${a.zoning === b.zoning ? "Same" : "Different"} |`);
  rows.push(`| Plot Ratio | ${a.plotRatio} | ${b.plotRatio} | ${a.plotRatio === b.plotRatio ? "Same" : "Different"} |`);

  // URA data (if available)
  if (a.medianPsf != null || b.medianPsf != null) {
    rows.push(`| Median $/psf | ${a.medianPsf != null ? "$" + fmtNum(a.medianPsf) : "—"} | ${b.medianPsf != null ? "$" + fmtNum(b.medianPsf) : "—"} | ${fmtDelta(a.medianPsf, b.medianPsf, name1, name2, "")} |`);
    rows.push(`| Transactions | ${fmtNum(a.txnCount)} | ${fmtNum(b.txnCount)} | ${fmtCountDelta(a.txnCount, b.txnCount, name1, name2)} |`);
  }
  if (a.medianRentPsf != null || b.medianRentPsf != null) {
    rows.push(`| Median rent $/psf | ${a.medianRentPsf != null ? "$" + a.medianRentPsf.toFixed(2) : "—"} | ${b.medianRentPsf != null ? "$" + b.medianRentPsf.toFixed(2) : "—"} | ${fmtDelta(a.medianRentPsf, b.medianRentPsf, name1, name2, "")} |`);
  }
  if (a.pipelineUnits > 0 || b.pipelineUnits > 0) {
    rows.push(`| Pipeline units | ${fmtNum(a.pipelineUnits)} | ${fmtNum(b.pipelineUnits)} | ${a.pipelineUnits < b.pipelineUnits ? name1 + " less risk" : a.pipelineUnits > b.pipelineUnits ? name2 + " less risk" : "Same"} |`);
  }

  // Transport
  rows.push(`| MRT distance | ${a.nearestMrt != null ? Math.round(a.nearestMrt) + "m" : "—"} | ${b.nearestMrt != null ? Math.round(b.nearestMrt) + "m" : "—"} | ${fmtDistDelta(a.nearestMrt, b.nearestMrt, name1, name2)} |`);

  if (isLtaConfigured()) {
    rows.push(`| Bus stops | ${a.busStopCount} | ${b.busStopCount} | ${fmtCountDelta(a.busStopCount, b.busStopCount, name1, name2)} |`);
    rows.push(`| Taxi stands | ${a.taxiStandCount} | ${b.taxiStandCount} | ${fmtCountDelta(a.taxiStandCount, b.taxiStandCount, name1, name2)} |`);
  }

  // Amenities
  const amenityLabels: [string, string][] = [
    ["school", "Schools"], ["park", "Parks"],
    ["supermarket", "Supermarkets"], ["food_court", "Hawker/Food Cts"],
    ["hospital", "Hospitals"], ["clinic", "Clinics"],
    ["pharmacy", "Pharmacies"],
  ];
  for (const [key, label] of amenityLabels) {
    const ac = a.amenityCounts[key] ?? 0;
    const bc = b.amenityCounts[key] ?? 0;
    if (ac > 0 || bc > 0) {
      rows.push(`| ${label} | ${ac} | ${bc} | ${fmtCountDelta(ac, bc, name1, name2)} |`);
    }
  }

  lines.push(header, divider, ...rows);

  // Attributions
  lines.push("");
  lines.push("---");
  const attributions: string[] = [
    "(c) Urban Redevelopment Authority — https://www.ura.gov.sg",
  ];
  if (isOneMapConfigured()) {
    attributions.push("OneMap, Singapore Land Authority — https://www.onemap.gov.sg");
  } else {
    attributions.push("Data (c) OpenStreetMap contributors — https://www.openstreetmap.org/copyright");
  }
  attributions.push("Data (c) OpenStreetMap contributors — https://www.openstreetmap.org/copyright");
  if (isLtaConfigured()) {
    attributions.push("Contains information from LTA DataMall — https://datamall.lta.gov.sg");
  }
  lines.push(attributions.join("\n"));
  lines.push(PROPERTY_DISCLAIMER);

  return lines.join("\n");
}

// --- Tool registration ---

export function registerCompareTools(server: McpServer): void {
  server.tool(
    "compare_areas",
    "Compare two Singapore locations side-by-side. Returns a structured table with zoning, prices, rents, pipeline supply, transport, and amenity counts with deltas and verdicts. Use this instead of calling individual tools twice — guarantees a consistent comparison format.",
    {
      address1: z.string().describe("First location address (e.g. 'Bishan Street 13')"),
      address2: z.string().describe("Second location address (e.g. 'Toa Payoh Lorong 6')"),
      radiusMeters: z.coerce.number().optional().default(500)
        .describe("Search radius for amenities/transport in meters (default 500, max 5000)"),
    },
    async ({ address1, address2, radiusMeters: rawRadius }, extra: ToolExtra) => {
      const radiusMeters = clampRadius(rawRadius);
      await logInfo(extra, `compare_areas: "${address1}" vs "${address2}", radius=${radiusMeters}m`);

      // Short names for table headers (first word or two of each address)
      const name1 = address1.split(/[\s,]+/).slice(0, 2).join(" ");
      const name2 = address2.split(/[\s,]+/).slice(0, 2).join(" ");

      // 1. Gather data for both locations
      // Overpass has a 5s rate limit, so we do locations sequentially
      await sendProgress(extra, 0, 4, `Analysing ${name1}…`);
      const locA = await gatherLocationData(address1, radiusMeters, extra, name1);
      if (!locA) {
        return { content: [{ type: "text" as const, text: `Could not resolve address: "${address1}". Try a more specific Singapore address.` }] };
      }

      await sendProgress(extra, 1, 4, `Analysing ${name2}…`);
      const locB = await gatherLocationData(address2, radiusMeters, extra, name2);
      if (!locB) {
        return { content: [{ type: "text" as const, text: `Could not resolve address: "${address2}". Try a more specific Singapore address.` }] };
      }

      // 2. Fetch URA data once, filter for both districts
      if (isUraDataConfigured()) {
        await sendProgress(extra, 2, 4, "Fetching property market data…");
        const waitCb = (delay: number) => logInfo(extra, `compare_areas: waiting for data service (${Math.ceil(delay / 1000)}s)…`);

        const [txnResult, rentalResult, pipelineResult] = await Promise.all([
          queryPrivateTransactions(undefined, waitCb),
          queryRentalMedian(waitCb),
          queryPipeline(waitCb),
        ]);

        // Transactions — median $/psf by district
        if (!txnResult.error) {
          for (const loc of [locA, locB]) {
            if (!loc.district) continue;
            const districtTxns = txnResult.records.filter((r) => r.district === loc.district);
            const prices = districtTxns
              .map((r) => {
                const price = parseFloat(r.price);
                const area = parseFloat(r.area);
                return area > 0 ? price / (area * 10.764) : NaN; // sqm to sqft
              })
              .filter((v) => !isNaN(v));
            loc.medianPsf = median(prices);
            loc.txnCount = districtTxns.length;
          }
        }

        // Rental median — median $/psf/month by district
        if (!rentalResult.error) {
          for (const loc of [locA, locB]) {
            if (!loc.district) continue;
            const districtRentals = rentalResult.records.filter((r) => r.district === loc.district);
            const rents = districtRentals.map((r) => r.median).filter((v) => v > 0);
            loc.medianRentPsf = median(rents);
          }
        }

        // Pipeline — total units by district
        if (!pipelineResult.error) {
          for (const loc of [locA, locB]) {
            if (!loc.district) continue;
            loc.pipelineUnits = pipelineResult.records
              .filter((r) => r.district === loc.district)
              .reduce((sum, r) => sum + r.totalUnits, 0);
          }
        }
      }

      // 3. Build comparison table
      await sendProgress(extra, 3, 4, "Building comparison…");
      const table = buildComparisonTable(locA, locB, name1, name2);

      await sendProgress(extra, 4, 4, "Done");
      return { content: [{ type: "text" as const, text: table }] };
    },
  );
}
