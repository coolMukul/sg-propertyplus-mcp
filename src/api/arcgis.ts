// URA ArcGIS client — Master Plan 2019 land use spatial query.
// Finds land parcels within a radius of a point.
// Free, no API key. Geometry format: longitude,latitude (not lat,lon).

import { ARCGIS_LAND_USE_URL, ARCGIS_RESULT_LIMIT } from "../config.js";
import { LandParcel } from "../types.js";

interface ArcGisAttributes {
  LU_DESC: string | null;
  GPR: string | null;
  REGION_N: string | null;
  PLN_AREA_N: string | null;
  SUBZONE_N: string | null;
}

interface ArcGisResponse {
  features?: { attributes: ArcGisAttributes }[];
  error?: { code: number; message: string };
}

export async function queryLandUse(
  lat: number,
  lon: number,
  radiusMeters: number
): Promise<LandParcel[]> {
  // ArcGIS expects longitude,latitude order
  const body = new URLSearchParams({
    geometry: `${lon},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    outSR: "4326",
    distance: radiusMeters.toString(),
    units: "esriSRUnit_Meter",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "LU_DESC,GPR,REGION_N,PLN_AREA_N,SUBZONE_N",
    returnGeometry: "false",
    f: "json",
    resultRecordCount: ARCGIS_RESULT_LIMIT.toString(),
  });

  const response = await fetch(ARCGIS_LAND_USE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    console.error(`ArcGIS HTTP ${response.status}: ${response.statusText}`);
    return [];
  }

  const data = (await response.json()) as ArcGisResponse;

  // ArcGIS can return errors inside a 200 OK
  if (data.error) {
    console.error(`ArcGIS error ${data.error.code}: ${data.error.message}`);
    return [];
  }

  if (!data.features) {
    return [];
  }

  // Filter out parcels without a meaningful land use description
  const parcels = data.features
    .filter((f) => f.attributes.LU_DESC && f.attributes.LU_DESC.trim() !== "")
    .map((f) => ({
      landUse: f.attributes.LU_DESC!,
      grossPlotRatio: f.attributes.GPR ?? null,
      region: f.attributes.REGION_N ?? "",
      planningArea: f.attributes.PLN_AREA_N ?? "",
      subzone: f.attributes.SUBZONE_N ?? "",
    }));

  // Deduplicate — multiple polygons often share identical attributes
  const seen = new Set<string>();
  return parcels.filter((p) => {
    const key = `${p.landUse}|${p.grossPlotRatio}|${p.region}|${p.planningArea}|${p.subzone}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
