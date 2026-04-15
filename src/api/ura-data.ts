// URA Data Service API client.
// Provides private property transactions, rentals, developer sales,
// rental medians, and pipeline data.
//
// Auth:
//   - AccessKey (permanent) sent in header with every request.
//   - Token (daily) fetched via GET /insertNewToken/v1 with AccessKey header.
//   - Token is cached in memory with conservative 20-hour expiry.
//
// Data endpoints:
//   - PMI_Resi_Transaction: batched (batch=1,2,...), returns all when batch absent = undefined Result
//   - PMI_Resi_Rental: quarterly (refPeriod=24q1), required param
//   - PMI_Resi_Developer_Sales: quarterly (refPeriod=0924)
//   - PMI_Resi_Rental_Median: no extra params
//   - PMI_Resi_Pipeline: no extra params
//   - Car_Park_Availability: no extra params (real-time)
//   - Car_Park_Details: no extra params

import { URA_ACCESS_KEY, URA_BASE_URL } from "../config.js";
import {
  PrivateTransaction,
  PrivateRental,
  DeveloperSale,
  RentalMedian,
  PipelineProject,
  CarParkAvailability,
  CarParkDetail,
  SeasonCarPark,
  PlanningDecision,
} from "../types.js";
import { uraLimiter } from "../rate-limiter.js";

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------

let cachedToken: string | null = null;
let tokenExpiry: number = 0; // Unix ms — 0 means unknown

/** True if URA Data Service credentials are configured. */
export function isUraDataConfigured(): boolean {
  return !!URA_ACCESS_KEY;
}

/**
 * Get a valid token. Uses cached token if not expired, otherwise fetches
 * a new one via insertNewToken/v1. Returns null if no AccessKey configured.
 */
async function getToken(): Promise<string | null> {
  if (!URA_ACCESS_KEY) return null;

  // Use cached if not expired
  if (cachedToken && (tokenExpiry === 0 || Date.now() < tokenExpiry)) {
    return cachedToken;
  }

  // Fetch fresh token
  try {
    const url = `${URA_BASE_URL}/insertNewToken/v1`;
    const res = await fetch(url, {
      headers: { AccessKey: URA_ACCESS_KEY },
    });

    if (!res.ok) {
      console.error(`[ura-data] Token refresh failed: HTTP ${res.status}`);
      return null;
    }

    const data = (await res.json()) as {
      Status: string;
      Result: string;
      Message: string;
    };

    if (data.Status !== "Success" || !data.Result) {
      console.error(`[ura-data] Token refresh: unexpected status "${data.Status}"`);
      return null;
    }

    cachedToken = data.Result;
    // Token is daily — conservative 20-hour expiry
    tokenExpiry = Date.now() + 20 * 60 * 60 * 1000;

    console.error("[ura-data] Token refreshed successfully");
    return cachedToken;
  } catch (error) {
    console.error("[ura-data] Token refresh error:", error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Raw API response types
// ---------------------------------------------------------------------------

interface UraTransactionRaw {
  area: string;
  floorRange: string;
  noOfUnits: string;
  contractDate: string;
  typeOfSale: string;
  price: string;
  nettPrice?: string;
  propertyType: string;
  district: string;
  typeOfArea: string;
  tenure: string;
}

interface UraTransactionProject {
  street: string;
  project: string;
  marketSegment: string;
  x?: string;
  y?: string;
  transaction: UraTransactionRaw[];
}

interface UraRentalRaw {
  areaSqm: string;
  areaSqft: string;
  leaseDate: string;
  propertyType: string;
  district: string;
  noOfBedRoom: string;
  rent: number;
}

interface UraRentalProject {
  street: string;
  project: string;
  x?: string;
  y?: string;
  rental: UraRentalRaw[];
}

interface UraDevSaleRaw {
  refPeriod: string;
  medianPrice: number;
  highestPrice: number;
  lowestPrice: number;
  launchedToDate: number;
  soldInMonth: number;
  launchedInMonth: number;
  soldToDate: number;
  unitsAvail: number;
}

interface UraDevSaleProject {
  street: string;
  project: string;
  district: string;
  propertyType: string;
  developer: string;
  marketSegment: string;
  x?: string;
  y?: string;
  developerSales: UraDevSaleRaw[];
}

interface UraRentalMedianRaw {
  refPeriod: string;
  median: number;
  psf25: number;
  psf75: number;
  district: string;
}

interface UraRentalMedianProject {
  street: string;
  project: string;
  x?: string;
  y?: string;
  rentalMedian: UraRentalMedianRaw[];
}

interface UraPipelineRaw {
  project: string;
  street: string;
  district: string;
  developerName: string;
  totalUnits: number;
  noOfCondo: number;
  noOfApartment: number;
  noOfTerrace: number;
  noOfSemiDetached: number;
  noOfDetachedHouse: number;
  expectedTOPYear: string;
}

interface UraApiResponse {
  Status: string;
  Result?: unknown[];
  Message?: string;
}

// ---------------------------------------------------------------------------
// Generic fetch helper
// ---------------------------------------------------------------------------

async function fetchUra(
  service: string,
  extraParams?: string,
  onWait?: (delayMs: number) => void | Promise<void>,
): Promise<{ result: unknown[]; error?: string }> {
  // Try up to 2 times: if the first attempt gets 401 (expired token),
  // force-refresh the token and retry once before giving up.
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getToken();
    if (!token) {
      return { result: [], error: "This feature requires API credentials. Check your server's environment configuration." };
    }

    await uraLimiter.wait(onWait);

    const params = extraParams ? `&${extraParams}` : "";
    const url = `${URA_BASE_URL}/invokeUraDS/v1?service=${service}${params}`;

    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          AccessKey: URA_ACCESS_KEY,
          Token: token,
        },
      });
    } catch (err: any) {
      console.error(`[ura-data] Network error: ${err.message}`);
      return { result: [], error: "Could not reach data service. Retry after 30 seconds delay." };
    }

    if (res.status === 401 && attempt === 0) {
      // Token expired — force refresh and retry
      console.error("[ura-data] 401 — token expired, refreshing and retrying…");
      cachedToken = null;
      tokenExpiry = 0;
      continue;
    }

    if (!res.ok) {
      console.error(`[ura-data] HTTP ${res.status}: ${res.statusText}`);
      return { result: [], error: "Data service returned an error. Retry after 30 seconds delay." };
    }

    const data = (await res.json()) as UraApiResponse;
    return { result: data.Result ?? [] };
  }

  return { result: [], error: "Authentication failed after token refresh. Retry after 30 seconds delay." };
}

// ---------------------------------------------------------------------------
// Batch-fetched endpoint: PMI_Resi_Transaction
// ---------------------------------------------------------------------------

const MAX_BATCHES = 5; // POC confirmed 4 batches exist

export async function queryPrivateTransactions(
  onProgress?: (batch: number, recordsSoFar: number) => void | Promise<void>,
  onWait?: (delayMs: number) => void | Promise<void>,
): Promise<{ records: PrivateTransaction[]; error?: string }> {
  if (!isUraDataConfigured()) {
    return { records: [], error: "This feature requires API credentials. Check your server's environment configuration." };
  }

  const allRecords: PrivateTransaction[] = [];
  let batch = 1;

  while (batch <= MAX_BATCHES) {
    const { result, error } = await fetchUra(
      "PMI_Resi_Transaction",
      `batch=${batch}`,
      onWait,
    );

    if (error) return { records: allRecords, error };
    if (result.length === 0) break;

    const projects = result as UraTransactionProject[];
    for (const project of projects) {
      if (!project.transaction) continue;
      for (const txn of project.transaction) {
        allRecords.push({
          project: project.project,
          street: project.street,
          marketSegment: project.marketSegment,
          area: txn.area,
          floorRange: txn.floorRange,
          noOfUnits: txn.noOfUnits,
          contractDate: txn.contractDate,
          typeOfSale: txn.typeOfSale,
          price: txn.price,
          nettPrice: txn.nettPrice ?? "",
          propertyType: txn.propertyType,
          district: txn.district,
          typeOfArea: txn.typeOfArea,
          tenure: txn.tenure,
        });
      }
    }

    if (onProgress) await onProgress(batch, allRecords.length);
    batch++;
  }

  return { records: allRecords };
}

// ---------------------------------------------------------------------------
// Quarterly endpoint: PMI_Resi_Rental
// ---------------------------------------------------------------------------

export async function queryPrivateRentals(
  refPeriod: string,
  onWait?: (delayMs: number) => void | Promise<void>,
): Promise<{ records: PrivateRental[]; error?: string }> {
  if (!isUraDataConfigured()) {
    return { records: [], error: "This feature requires API credentials. Check your server's environment configuration." };
  }

  const { result, error } = await fetchUra(
    "PMI_Resi_Rental",
    `refPeriod=${refPeriod}`,
    onWait,
  );

  if (error) return { records: [], error };

  const records: PrivateRental[] = [];
  const projects = result as UraRentalProject[];
  for (const project of projects) {
    if (!project.rental) continue;
    for (const r of project.rental) {
      records.push({
        project: project.project,
        street: project.street,
        areaSqm: r.areaSqm,
        areaSqft: r.areaSqft,
        leaseDate: r.leaseDate,
        propertyType: r.propertyType,
        district: r.district,
        noOfBedRoom: r.noOfBedRoom,
        rent: r.rent,
      });
    }
  }

  return { records };
}

// ---------------------------------------------------------------------------
// Quarterly endpoint: PMI_Resi_Developer_Sales
// ---------------------------------------------------------------------------

export async function queryDeveloperSales(
  refPeriod: string,
  onWait?: (delayMs: number) => void | Promise<void>,
): Promise<{ records: DeveloperSale[]; error?: string }> {
  if (!isUraDataConfigured()) {
    return { records: [], error: "This feature requires API credentials. Check your server's environment configuration." };
  }

  const { result, error } = await fetchUra(
    "PMI_Resi_Developer_Sales",
    `refPeriod=${refPeriod}`,
    onWait,
  );

  if (error) return { records: [], error };

  const records: DeveloperSale[] = [];
  const projects = result as UraDevSaleProject[];
  for (const project of projects) {
    if (!project.developerSales) continue;
    for (const ds of project.developerSales) {
      records.push({
        project: project.project,
        street: project.street,
        district: project.district,
        propertyType: project.propertyType,
        developer: project.developer,
        marketSegment: project.marketSegment,
        refPeriod: ds.refPeriod,
        medianPrice: ds.medianPrice,
        highestPrice: ds.highestPrice,
        lowestPrice: ds.lowestPrice,
        launchedToDate: ds.launchedToDate,
        soldInMonth: ds.soldInMonth,
        launchedInMonth: ds.launchedInMonth,
        soldToDate: ds.soldToDate,
        unitsAvail: ds.unitsAvail,
      });
    }
  }

  return { records };
}

// ---------------------------------------------------------------------------
// Simple endpoint: PMI_Resi_Rental_Median
// ---------------------------------------------------------------------------

export async function queryRentalMedian(
  onWait?: (delayMs: number) => void | Promise<void>,
): Promise<{ records: RentalMedian[]; error?: string }> {
  if (!isUraDataConfigured()) {
    return { records: [], error: "This feature requires API credentials. Check your server's environment configuration." };
  }

  const { result, error } = await fetchUra("PMI_Resi_Rental_Median", undefined, onWait);
  if (error) return { records: [], error };

  const records: RentalMedian[] = [];
  const projects = result as UraRentalMedianProject[];
  for (const project of projects) {
    if (!project.rentalMedian) continue;
    for (const rm of project.rentalMedian) {
      records.push({
        project: project.project,
        street: project.street,
        district: rm.district,
        refPeriod: rm.refPeriod,
        median: rm.median,
        psf25: rm.psf25,
        psf75: rm.psf75,
      });
    }
  }

  return { records };
}

// ---------------------------------------------------------------------------
// Simple endpoint: PMI_Resi_Pipeline
// ---------------------------------------------------------------------------

export async function queryPipeline(
  onWait?: (delayMs: number) => void | Promise<void>,
): Promise<{ records: PipelineProject[]; error?: string }> {
  if (!isUraDataConfigured()) {
    return { records: [], error: "This feature requires API credentials. Check your server's environment configuration." };
  }

  const { result, error } = await fetchUra("PMI_Resi_Pipeline", undefined, onWait);
  if (error) return { records: [], error };

  // Pipeline is flat — no nested array
  const records = (result as UraPipelineRaw[]).map((r) => ({
    project: r.project,
    street: r.street,
    district: r.district,
    developerName: r.developerName,
    totalUnits: r.totalUnits,
    noOfCondo: r.noOfCondo,
    noOfApartment: r.noOfApartment,
    noOfTerrace: r.noOfTerrace,
    noOfSemiDetached: r.noOfSemiDetached,
    noOfDetachedHouse: r.noOfDetachedHouse,
    expectedTOPYear: r.expectedTOPYear,
  }));

  return { records };
}

// ---------------------------------------------------------------------------
// Simple endpoint: Car_Park_Availability (real-time)
// ---------------------------------------------------------------------------

interface UraCarParkAvailabilityRaw {
  lotsAvailable: string;
  lotType: string;
  carparkNo: string;
  geometries?: { coordinates: string }[];
}

export async function queryCarParkAvailability(
  onWait?: (delayMs: number) => void | Promise<void>,
): Promise<{ records: CarParkAvailability[]; error?: string }> {
  if (!isUraDataConfigured()) {
    return { records: [], error: "This feature requires API credentials. Check your server's environment configuration." };
  }

  const { result, error } = await fetchUra("Car_Park_Availability", undefined, onWait);
  if (error) return { records: [], error };

  const records = (result as UraCarParkAvailabilityRaw[]).map((r) => ({
    carparkNo: r.carparkNo,
    lotType: r.lotType,
    lotsAvailable: r.lotsAvailable,
  }));

  return { records };
}

// ---------------------------------------------------------------------------
// Simple endpoint: Car_Park_Details
// ---------------------------------------------------------------------------

interface UraCarParkDetailRaw {
  weekdayMin: string;
  ppName: string;
  endTime: string;
  weekdayRate: string;
  startTime: string;
  ppCode: string;
  sunPHRate: string;
  satdayMin: string;
  sunPHMin: string;
  parkingSystem: string;
  parkCapacity: number;
  vehCat: string;
  satdayRate: string;
  geometries?: { coordinates: string }[];
}

export async function queryCarParkDetails(
  onWait?: (delayMs: number) => void | Promise<void>,
): Promise<{ records: CarParkDetail[]; error?: string }> {
  if (!isUraDataConfigured()) {
    return { records: [], error: "This feature requires API credentials. Check your server's environment configuration." };
  }

  const { result, error } = await fetchUra("Car_Park_Details", undefined, onWait);
  if (error) return { records: [], error };

  const records = (result as UraCarParkDetailRaw[]).map((r) => ({
    ppCode: r.ppCode,
    ppName: r.ppName,
    vehCat: r.vehCat,
    parkCapacity: r.parkCapacity,
    parkingSystem: r.parkingSystem,
    startTime: r.startTime,
    endTime: r.endTime,
    weekdayRate: r.weekdayRate,
    weekdayMin: r.weekdayMin,
    satdayRate: r.satdayRate,
    satdayMin: r.satdayMin,
    sunPHRate: r.sunPHRate,
    sunPHMin: r.sunPHMin,
  }));

  return { records };
}

// ---------------------------------------------------------------------------
// Simple endpoint: Season_Car_Park_Details
// ---------------------------------------------------------------------------

interface UraSeasonCarParkRaw {
  ppCode: string;
  ppName: string;
  vehCat: string;
  monthlyRate: string;
  parkingHrs: string;
  ticketType: string;
  geometries?: { coordinates: string }[];
}

export async function querySeasonCarParks(
  onWait?: (delayMs: number) => void | Promise<void>,
): Promise<{ records: SeasonCarPark[]; error?: string }> {
  if (!isUraDataConfigured()) {
    return { records: [], error: "This feature requires API credentials. Check your server's environment configuration." };
  }

  const { result, error } = await fetchUra("Season_Car_Park_Details", undefined, onWait);
  if (error) return { records: [], error };

  const records = (result as UraSeasonCarParkRaw[]).map((r) => ({
    ppCode: r.ppCode,
    ppName: r.ppName,
    vehCat: r.vehCat,
    monthlyRate: r.monthlyRate,
    parkingHrs: r.parkingHrs,
    ticketType: r.ticketType,
  }));

  return { records };
}

// ---------------------------------------------------------------------------
// Parameterised endpoint: EAU_Appr_Resi_Use
// ---------------------------------------------------------------------------

interface UraResiUseResponse {
  Status: string;
  isResiUse: string; // "Y" or "NA"
  Message?: string;
}

export async function checkResidentialUse(
  blkHouseNo: string,
  street: string,
  storeyNo?: string,
  unitNo?: string,
  onWait?: (delayMs: number) => void | Promise<void>,
): Promise<{ isResiUse: string; error?: string }> {
  if (!isUraDataConfigured()) {
    return { isResiUse: "NA", error: "This feature requires API credentials. Check your server's environment configuration." };
  }

  const params = new URLSearchParams({ blkHouseNo, street });
  if (storeyNo) params.set("storeyNo", storeyNo);
  if (unitNo) params.set("unitNo", unitNo);

  const token = await getToken();
  if (!token) {
    return { isResiUse: "NA", error: "Could not authenticate. Token refresh failed." };
  }

  await uraLimiter.wait(onWait);

  const url = `${URA_BASE_URL}/invokeUraDS/v1?service=EAU_Appr_Resi_Use&${params}`;
  const res = await fetch(url, {
    headers: { AccessKey: URA_ACCESS_KEY, Token: token },
  });

  if (!res.ok) {
    console.error(`[ura-data] Residential use check HTTP ${res.status}`);
    return { isResiUse: "NA", error: "Data service returned an error. Retry after 30 seconds delay." };
  }

  const data = (await res.json()) as UraResiUseResponse;
  return { isResiUse: data.isResiUse ?? "NA" };
}

// ---------------------------------------------------------------------------
// Simple endpoint: Planning_Decision
// ---------------------------------------------------------------------------

interface UraPlanningDecisionRaw {
  address: string;
  submission_desc: string;
  dr_id: string;
  decision_date: string;
  decision_type: string;
  appl_type: string;
  mkts_lotno: string;
  decision_no: string;
  submission_no: string;
  delete_ind?: string;
}

export async function queryPlanningDecisions(
  query: { year?: string; lastDnloadDate?: string },
  onWait?: (delayMs: number) => void | Promise<void>,
): Promise<{ records: PlanningDecision[]; error?: string }> {
  if (!isUraDataConfigured()) {
    return { records: [], error: "This feature requires API credentials. Check your server's environment configuration." };
  }

  // API requires exactly one of year or last_dnload_date
  let params: string | undefined;
  if (query.year) {
    params = `year=${query.year}`;
  } else if (query.lastDnloadDate) {
    params = `last_dnload_date=${query.lastDnloadDate}`;
  }

  const { result, error } = await fetchUra("Planning_Decision", params, onWait);
  if (error) return { records: [], error };

  const records = (result as UraPlanningDecisionRaw[]).map((r) => ({
    address: r.address,
    submissionDesc: r.submission_desc,
    decisionDate: r.decision_date,
    decisionType: r.decision_type,
    applType: r.appl_type,
    decisionNo: r.decision_no,
    submissionNo: r.submission_no,
  }));

  return { records };
}

// ---------------------------------------------------------------------------
// Filtering helpers (pure functions, no I/O)
// ---------------------------------------------------------------------------

/** Convert MMYY to YYYYMM for numeric comparison. "0522" -> 202205. */
export function parseContractDate(mmyy: string): number {
  const mm = mmyy.slice(0, 2);
  const yy = mmyy.slice(2, 4);
  const year = parseInt(yy, 10);
  // URA data spans ~5 years. Years 90+ are 1990s, under 90 are 2000s.
  const fullYear = year >= 90 ? 1900 + year : 2000 + year;
  return fullYear * 100 + parseInt(mm, 10);
}

export function filterTransactions(
  records: PrivateTransaction[],
  filters: {
    district?: string;
    project?: string;
    propertyType?: string;
    marketSegment?: string;
    tenure?: string;
    dateFrom?: string;
    dateTo?: string;
    minPrice?: number;
    maxPrice?: number;
    minArea?: number;
    maxArea?: number;
  },
): PrivateTransaction[] {
  return records.filter((r) => {
    if (filters.district && r.district !== filters.district) return false;
    if (filters.project && !r.project.toUpperCase().includes(filters.project.toUpperCase())) return false;
    if (filters.propertyType && !r.propertyType.toUpperCase().includes(filters.propertyType.toUpperCase())) return false;
    if (filters.marketSegment && r.marketSegment !== filters.marketSegment.toUpperCase()) return false;
    if (filters.tenure && !r.tenure.toUpperCase().includes(filters.tenure.toUpperCase())) return false;

    const price = parseFloat(r.price);
    if (filters.minPrice && price < filters.minPrice) return false;
    if (filters.maxPrice && price > filters.maxPrice) return false;

    const area = parseFloat(r.area);
    if (filters.minArea && area < filters.minArea) return false;
    if (filters.maxArea && area > filters.maxArea) return false;

    if (filters.dateFrom || filters.dateTo) {
      const dateNum = parseContractDate(r.contractDate);
      if (filters.dateFrom && dateNum < parseContractDate(filters.dateFrom)) return false;
      if (filters.dateTo && dateNum > parseContractDate(filters.dateTo)) return false;
    }

    return true;
  });
}

export function filterRentals(
  records: PrivateRental[],
  filters: {
    district?: string;
    project?: string;
    propertyType?: string;
    noOfBedRoom?: string;
    minRent?: number;
    maxRent?: number;
  },
): PrivateRental[] {
  return records.filter((r) => {
    if (filters.district && r.district !== filters.district) return false;
    if (filters.project && !r.project.toUpperCase().includes(filters.project.toUpperCase())) return false;
    if (filters.propertyType && !r.propertyType.toUpperCase().includes(filters.propertyType.toUpperCase())) return false;
    if (filters.noOfBedRoom && r.noOfBedRoom !== filters.noOfBedRoom) return false;
    if (filters.minRent && r.rent < filters.minRent) return false;
    if (filters.maxRent && r.rent > filters.maxRent) return false;
    return true;
  });
}
