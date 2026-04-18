// MOE school directory client — General Information of Schools (data.gov.sg).
// Free, no API key. Same CKAN datastore API as HDB resale.
// ~337 schools — small enough to fetch all and filter client-side.

import { DATAGOV_URL, SCHOOL_RESOURCE_ID, DATAGOV_DELAY_MS } from "../config.js";
import { SchoolInfo } from "../types.js";
import { datagovLimiter } from "../rate-limiter.js";

// Raw record shape from the CKAN API
interface SchoolRecord {
  _id: number;
  school_name: string;
  url_address: string;
  address: string;
  postal_code: string;
  telephone_no: string;
  telephone_no_2: string;
  fax_no: string;
  fax_no_2: string;
  email_address: string;
  mrt_desc: string;
  bus_desc: string;
  principal_name: string;
  first_vp_name: string;
  second_vp_name: string;
  third_vp_name: string;
  fourth_vp_name: string;
  fifth_vp_name: string;
  sixth_vp_name: string;
  dgp_code: string;
  zone_code: string;
  type_code: string;
  nature_code: string;
  session_code: string;
  mainlevel_code: string;
  sap_ind: string;
  autonomous_ind: string;
  gifted_ind: string;
  ip_ind: string;
  mothertongue1_code: string;
  mothertongue2_code: string;
  mothertongue3_code: string;
}

interface DataGovSuccessResponse {
  success: true;
  result: {
    records: SchoolRecord[];
    total: number;
  };
}

interface DataGovErrorResponse {
  code: number;
  name: string;
  errorMsg?: string;
}

type DataGovResponse = DataGovSuccessResponse | DataGovErrorResponse;

function isErrorResponse(data: DataGovResponse): data is DataGovErrorResponse {
  return "code" in data && "name" in data;
}

function yesNo(val: string): boolean {
  return val.toUpperCase() === "YES";
}

function clean(val: string): string {
  const trimmed = val.trim();
  return trimmed === "na" || trimmed === "NA" || trimmed === "-" ? "" : trimmed;
}

function toSchoolInfo(r: SchoolRecord): SchoolInfo {
  const motherTongues: string[] = [];
  for (const mt of [r.mothertongue1_code, r.mothertongue2_code, r.mothertongue3_code]) {
    const cleaned = clean(mt);
    if (cleaned) motherTongues.push(cleaned);
  }

  return {
    schoolName: r.school_name.trim(),
    address: r.address.trim(),
    postalCode: clean(r.postal_code),
    level: clean(r.mainlevel_code),
    zone: clean(r.zone_code),
    cluster: clean(r.dgp_code),
    type: clean(r.type_code),
    nature: clean(r.nature_code),
    session: clean(r.session_code),
    sap: yesNo(r.sap_ind),
    autonomous: yesNo(r.autonomous_ind),
    gifted: yesNo(r.gifted_ind),
    ip: yesNo(r.ip_ind),
    motherTongues,
    telephone: clean(r.telephone_no),
    email: clean(r.email_address),
    url: clean(r.url_address),
    nearestMrt: clean(r.mrt_desc),
    busServices: clean(r.bus_desc),
  };
}

// In-memory cache — 337 records, fetched once per process lifetime.
// Uses a fetch-once pattern: if multiple callers arrive before the first
// fetch completes, they all wait for the same promise instead of each
// hitting the API independently (which would trigger 429s).
let cachedSchools: SchoolInfo[] | null = null;
let inflightFetch: Promise<{ records: SchoolInfo[]; total: number; error?: string }> | null = null;

export async function querySchools(
  onWait?: (delayMs: number) => void | Promise<void>,
): Promise<{ records: SchoolInfo[]; total: number; error?: string }> {
  // Return cache if available
  if (cachedSchools) {
    return { records: cachedSchools, total: cachedSchools.length };
  }

  // If another caller is already fetching, wait for the same result
  if (inflightFetch) {
    return inflightFetch;
  }

  inflightFetch = fetchSchools(onWait);
  try {
    return await inflightFetch;
  } finally {
    inflightFetch = null;
  }
}

async function fetchSchools(
  onWait?: (delayMs: number) => void | Promise<void>,
): Promise<{ records: SchoolInfo[]; total: number; error?: string }> {

  const params = new URLSearchParams({
    resource_id: SCHOOL_RESOURCE_ID,
    limit: "500", // more than the ~337 schools, ensures we get all in one call
  });

  // Retry once on 429 with 2x the suggested cooldown
  const MAX_RETRIES = 1;
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
        await new Promise<void>((r) => setTimeout(r, 20_000));
        continue;
      }
      console.error(`[schools] Network error: ${err.message}`);
      return { records: [], total: 0, error: "Could not reach data service. Try again later." };
    }

    if (response.status === 429) {
      console.error(`[schools] HTTP 429 — attempt ${attempt + 1}/${MAX_RETRIES + 1}, backing off 20s`);
      if (attempt < MAX_RETRIES) {
        await new Promise<void>((r) => setTimeout(r, 20_000));
        continue;
      }
      return { records: [], total: 0, error: "Data service is busy. Try again later." };
    }

    if (!response.ok) {
      console.error(`[schools] HTTP ${response.status}: ${response.statusText}`);
      return { records: [], total: 0, error: "Data service returned an error. Try again later." };
    }

    data = (await response.json()) as DataGovResponse;

    if (isErrorResponse(data)) {
      console.error(`[schools] Error response: ${data.name} (code ${data.code})`);
      if (data.name === "TOO_MANY_REQUESTS" && attempt < MAX_RETRIES) {
        await new Promise<void>((r) => setTimeout(r, 20_000));
        continue;
      }
      return { records: [], total: 0, error: "Data service is busy. Try again later." };
    }

    break;
  }

  if (!data || isErrorResponse(data)) {
    return { records: [], total: 0, error: "Could not reach data service. Try again later." };
  }

  if (!data.success || !data.result) {
    return { records: [], total: 0 };
  }

  cachedSchools = data.result.records.map(toSchoolInfo);
  return { records: cachedSchools, total: data.result.total };
}
