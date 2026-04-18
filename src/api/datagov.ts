// data.gov.sg client — HDB resale flat prices (2017 onwards).
// Free, no API key. CKAN datastore API.

import { DATAGOV_URL, HDB_RESALE_RESOURCE_ID, DATAGOV_DELAY_MS } from "../config.js";
import { HdbResaleRecord } from "../types.js";
import { datagovLimiter } from "../rate-limiter.js";

interface DataGovRecord {
  month: string;
  town: string;
  flat_type: string;
  block: string;
  street_name: string;
  storey_range: string;
  floor_area_sqm: string;
  flat_model: string;
  lease_commence_date: string;
  remaining_lease: string;
  resale_price: string | number;
}

interface DataGovSuccessResponse {
  success: true;
  result: {
    records: DataGovRecord[];
    total: number;
  };
}

interface DataGovErrorResponse {
  code: number;
  name: string;
  message?: string;
}

type DataGovResponse = DataGovSuccessResponse | DataGovErrorResponse;

function isErrorResponse(data: DataGovResponse): data is DataGovErrorResponse {
  return "code" in data && "name" in data;
}

export async function queryHdbResale(
  town: string,
  flatType?: string,
  limit: number = 10,
  onWait?: (delayMs: number) => void | Promise<void>,
): Promise<{ records: HdbResaleRecord[]; total: number; error?: string }> {
  const filters: Record<string, string> = { town: town.toUpperCase() };
  if (flatType) {
    filters.flat_type = flatType.toUpperCase();
  }

  const params = new URLSearchParams({
    resource_id: HDB_RESALE_RESOURCE_ID,
    filters: JSON.stringify(filters),
    limit: limit.toString(),
    sort: "month desc",
  });

  // Retry with backoff on 429 / rate-limit errors.
  // data.gov.sg can return 429 as an HTTP status OR as a 200 with error body.
  const MAX_RETRIES = 2;
  let data: DataGovResponse | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (DATAGOV_DELAY_MS > 0) {
      if (onWait) await onWait(DATAGOV_DELAY_MS);
      await new Promise<void>((r) => setTimeout(r, DATAGOV_DELAY_MS));
    }
    await datagovLimiter.wait(onWait);

    let response: Response;
    try {
      response = await fetch(`${DATAGOV_URL}?${params}`);
    } catch (err: any) {
      if (attempt < MAX_RETRIES) {
        await new Promise<void>((r) => setTimeout(r, (attempt + 1) * 15_000));
        continue;
      }
      console.error(`[datagov] Network error: ${err.message}`);
      return { records: [], total: 0, error: "Could not reach data service. Retry after 30 seconds delay." };
    }

    if (response.status === 429) {
      const backoffSec = (attempt + 1) * 15; // 15s, 30s, 45s
      console.error(`[datagov] HTTP 429 — attempt ${attempt + 1}/${MAX_RETRIES + 1}, backing off ${backoffSec}s`);
      if (attempt < MAX_RETRIES) {
        await new Promise<void>((r) => setTimeout(r, backoffSec * 1000));
        continue;
      }
      return { records: [], total: 0, error: "Data service is busy. Retry after 30 seconds delay." };
    }

    if (!response.ok) {
      console.error(`[datagov] HTTP ${response.status}: ${response.statusText}`);
      return { records: [], total: 0, error: "Data service returned an error. Retry after 30 seconds delay." };
    }

    data = (await response.json()) as DataGovResponse;

    // Rate limit response: {"code": 24, "name": "TOO_MANY_REQUESTS"}
    // This arrives as 200 OK but has a completely different shape.
    if (isErrorResponse(data)) {
      console.error(`[datagov] Error response: ${data.name} (code ${data.code})`);
      if (data.name === "TOO_MANY_REQUESTS" && attempt < MAX_RETRIES) {
        await new Promise<void>((r) => setTimeout(r, (attempt + 1) * 15_000));
        continue;
      }
      return { records: [], total: 0, error: "Data service is busy. Retry after 30 seconds delay." };
    }

    break; // Success — exit retry loop
  }

  if (!data || isErrorResponse(data)) {
    return { records: [], total: 0, error: "Could not reach data service. Retry after 30 seconds delay." };
  }

  if (!data.success || !data.result) {
    return { records: [], total: 0 };
  }

  const records = data.result.records.map((r) => ({
    month: r.month,
    town: r.town,
    flatType: r.flat_type,
    block: r.block,
    streetName: r.street_name,
    storeyRange: r.storey_range,
    floorAreaSqm: r.floor_area_sqm,
    flatModel: r.flat_model,
    leaseCommenceDate: r.lease_commence_date,
    remainingLease: r.remaining_lease,
    resalePrice:
      typeof r.resale_price === "number"
        ? r.resale_price
        : parseFloat(r.resale_price),
  }));

  return { records, total: data.result.total };
}
