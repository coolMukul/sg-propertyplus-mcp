// Shared interfaces for SG-PropertyPlus MCP server.

/** Geocoding result from Nominatim or OneMap */
export interface GeocodingResult {
  lat: number;
  lon: number;
  displayName: string;
  postalCode?: string;  // available from OneMap search, not from Nominatim
}

/** A land parcel from URA ArcGIS Master Plan 2019 */
export interface LandParcel {
  landUse: string;
  grossPlotRatio: string | null;
  region: string;
  planningArea: string;
  subzone: string;
}

/** An HDB resale transaction from data.gov.sg */
export interface HdbResaleRecord {
  month: string;
  town: string;
  flatType: string;
  block: string;
  streetName: string;
  storeyRange: string;
  floorAreaSqm: string;
  flatModel: string;
  leaseCommenceDate: string;
  remainingLease: string;
  resalePrice: number;
}

/** A private property sale transaction from URA Data Service */
export interface PrivateTransaction {
  project: string;
  street: string;
  marketSegment: string;   // "CCR" | "RCR" | "OCR"
  area: string;            // sqm (exact, e.g. "257")
  floorRange: string;      // e.g. "21-25", "-" for landed
  noOfUnits: string;
  contractDate: string;    // MMYY e.g. "0522" = May 2022
  typeOfSale: string;      // "1"=new, "2"=sub sale, "3"=resale
  price: string;           // SGD (string from API)
  nettPrice: string;       // nett price excluding discounts (new sales only, empty otherwise)
  propertyType: string;    // "Condominium", "Apartment", "Terrace", etc.
  district: string;        // e.g. "05", "07"
  typeOfArea: string;      // "Strata" or "Land"
  tenure: string;          // "Freehold", "99 yrs lease commencing from 2024"
}

/** A private property rental contract from URA Data Service */
export interface PrivateRental {
  project: string;
  street: string;
  areaSqm: string;         // range, e.g. "150-160"
  areaSqft: string;        // range, e.g. "1600-1700"
  leaseDate: string;       // MMYY e.g. "0124" = Jan 2024
  propertyType: string;    // "Non-landed Properties", "Terrace House", etc.
  district: string;        // e.g. "10", "20"
  noOfBedRoom: string;     // e.g. "4", "NA"
  rent: number;            // monthly rent in SGD (number, not string)
}

/** Developer sales record from URA Data Service */
export interface DeveloperSale {
  project: string;
  street: string;
  district: string;
  propertyType: string;       // "Non-Landed", "Landed"
  developer: string;
  marketSegment: string;      // "CCR" | "RCR" | "OCR"
  refPeriod: string;          // "0924" = Sep 2024
  medianPrice: number;        // $/psf
  highestPrice: number;       // $/psf
  lowestPrice: number;        // $/psf
  launchedToDate: number;
  soldInMonth: number;
  launchedInMonth: number;
  soldToDate: number;
  unitsAvail: number;
}

/** Rental median record from URA Data Service */
export interface RentalMedian {
  project: string;
  street: string;
  district: string;
  refPeriod: string;          // "2023Q4"
  median: number;             // $/psf/month
  psf25: number;              // 25th percentile
  psf75: number;              // 75th percentile
}

/** Pipeline project record from URA Data Service */
export interface PipelineProject {
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
  expectedTOPYear: string;    // year or "na"
}

/** Car park availability from URA Data Service (real-time) */
export interface CarParkAvailability {
  carparkNo: string;
  lotType: string;       // "C" = car, "M" = motorcycle, "H" = heavy vehicle
  lotsAvailable: string; // string from API
}

/** Car park details and rates from URA Data Service */
export interface CarParkDetail {
  ppCode: string;
  ppName: string;
  vehCat: string;         // "Car", "Motorcycle", etc.
  parkCapacity: number;
  parkingSystem: string;  // "C" = coupon, "B" = electronic
  startTime: string;      // "08.30 AM"
  endTime: string;        // "05.00 PM"
  weekdayRate: string;    // "$0.50"
  weekdayMin: string;     // "30mins"
  satdayRate: string;
  satdayMin: string;
  sunPHRate: string;
  sunPHMin: string;
}

/** Season car park details from URA Data Service */
export interface SeasonCarPark {
  ppCode: string;
  ppName: string;
  vehCat: string;
  monthlyRate: string;
  parkingHrs: string;
  ticketType: string;
}

/** Planning decision record from URA Data Service */
export interface PlanningDecision {
  address: string;
  submissionDesc: string;
  decisionDate: string;      // "03/01/2011"
  decisionType: string;      // "Written Permission"
  applType: string;          // "Change of Use", "Subdivision", etc.
  decisionNo: string;
  submissionNo: string;
}

/** A nearby amenity from Overpass API (OpenStreetMap) */
export interface NearbyAmenity {
  category: string;    // normalized: "school", "hospital", "clinic", "food_court", "park", "mrt", "bus_stop", "supermarket", "pharmacy", "marketplace"
  name: string;        // display name (from tags.name or "(unnamed)")
  lat: number;
  lon: number;
  distanceMeters: number;  // calculated from query center point
  address: string | null;  // from tags if available
  tags: Record<string, string>;  // raw OSM tags for additional info
}

/** A bus stop from LTA DataMall */
export interface BusStopInfo {
  busStopCode: string;   // 5-digit code, e.g. "54241"
  roadName: string;
  description: string;   // landmark near stop
  lat: number;
  lon: number;
  distanceMeters: number; // calculated from query center
}

/** A bus arrival service at a specific stop from LTA DataMall */
export interface BusArrivalService {
  serviceNo: string;       // bus number, e.g. "130"
  operator: string;        // "SBST", "SMRT", "TTS", "GAS"
  nextBusMinutes: number | null;  // minutes until arrival, null if no data
  nextBusLoad: string;     // "SEA", "SDA", "LSD"
  nextBusType: string;     // "SD", "DD", "BD"
  nextBusFeature: string;  // "WAB" (wheelchair accessible) or ""
  nextBus2Minutes: number | null;
  nextBus2Load: string;
  nextBus3Minutes: number | null;
  nextBus3Load: string;
}

/** A taxi stand from LTA DataMall */
export interface TaxiStandInfo {
  taxiCode: string;
  name: string;
  type: string;       // "Stand" or "Stop"
  ownership: string;  // "LTA", "CCS", "Private"
  barrierFree: boolean;
  lat: number;
  lon: number;
  distanceMeters: number;
}

/** Reverse geocode result from OneMap */
export interface ReverseGeocodeResult {
  buildingName: string | null;
  block: string | null;
  road: string;
  postalCode: string | null;
  lat: number;
  lon: number;
}

/** A school from MOE General Information of Schools (data.gov.sg) */
export interface SchoolInfo {
  schoolName: string;
  address: string;
  postalCode: string;
  level: string;          // "PRIMARY", "SECONDARY (S1-S5)", "JUNIOR COLLEGE", etc.
  zone: string;           // "NORTH", "SOUTH", "EAST", "WEST"
  cluster: string;        // dgp_code, e.g. "WOODLANDS", "TAMPINES"
  type: string;           // "GOVERNMENT SCHOOL", "GOVERNMENT-AIDED SCH", etc.
  nature: string;         // "CO-ED SCHOOL", "BOYS' SCHOOL", "GIRLS' SCHOOL"
  session: string;        // "FULL DAY", "SINGLE SESSION"
  sap: boolean;
  autonomous: boolean;
  gifted: boolean;
  ip: boolean;
  motherTongues: string[];     // e.g. ["CHINESE", "MALAY", "TAMIL"]
  telephone: string;
  email: string;
  url: string;
  nearestMrt: string;
  busServices: string;
}

/** One metric within a demographic dimension (e.g. "HDB Dwellings", "3-Room Flats") */
export interface DemographicMetric {
  label: string;
  value: number | null;
  pctOfTotal?: number;             // only set for top-level metrics
  children?: DemographicMetric[];  // one level of nesting (e.g. HDB subtypes)
}

/** A single dimension of demographic data for one planning area */
export interface DemographicDimension {
  name: string;          // e.g. "Type of Dwelling"
  source: string;        // e.g. "Census of Population 2020"
  lastUpdated?: string;  // e.g. "18/06/2021"
  uom: string;           // e.g. "Number", "Thousands"
  total: number | null;  // total for this dimension at this area
  metrics: DemographicMetric[];
}

/** Combined demographic snapshot for one planning area */
export interface DemographicSnapshot {
  planningArea: string;
  dimensions: DemographicDimension[];
  unavailable: string[];  // dimension labels that couldn't be fetched
}

/** Stored state for the last search performed */
export interface SearchState {
  type: "land-use" | "hdb-resale" | "private-transaction" | "private-rental"
    | "developer-sales" | "rental-median" | "pipeline"
    | "carpark-availability" | "carpark-details" | "season-carpark"
    | "planning-decision" | "nearby-amenities"
    | "nearest-transport" | "bus-arrival" | "taxi-availability"
    | "school-info"
    | "area-comparison"
    | "demographics";
  query: Record<string, unknown>;
  results: LandParcel[] | HdbResaleRecord[] | PrivateTransaction[]
    | PrivateRental[] | DeveloperSale[] | RentalMedian[] | PipelineProject[]
    | CarParkAvailability[] | CarParkDetail[] | SeasonCarPark[]
    | PlanningDecision[] | NearbyAmenity[]
    | BusStopInfo[] | BusArrivalService[] | TaxiStandInfo[]
    | SchoolInfo[]
    | DemographicSnapshot[];
  timestamp: string;
}
