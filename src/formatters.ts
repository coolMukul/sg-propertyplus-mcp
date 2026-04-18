// Formatters — markdown tables and CSV output for all data types.

import {
  LandParcel,
  HdbResaleRecord,
  PrivateTransaction,
  PrivateRental,
  DeveloperSale,
  RentalMedian,
  PipelineProject,
  CarParkAvailability,
  CarParkDetail,
  SeasonCarPark,
  PlanningDecision,
  NearbyAmenity,
  BusStopInfo,
  BusArrivalService,
  TaxiStandInfo,
  SchoolInfo,
  DemographicSnapshot,
  DemographicMetric,
  DemographicDimension,
} from "./types.js";

// --- Markdown tables ---

export function formatLandParcelsTable(parcels: LandParcel[]): string {
  if (parcels.length === 0) {
    return "No land parcels found in this area.";
  }

  const header = "| Land Use | Plot Ratio | Region | Planning Area | Subzone |";
  const divider = "|---|---|---|---|---|";
  const rows = parcels.map(
    (p) =>
      `| ${p.landUse} | ${p.grossPlotRatio ?? "N/A"} | ${p.region} | ${p.planningArea} | ${p.subzone} |`
  );

  return [header, divider, ...rows].join("\n");
}

export function formatHdbTable(records: HdbResaleRecord[]): string {
  if (records.length === 0) {
    return "No HDB resale records found.";
  }

  const header =
    "| Month | Block | Street | Type | Storey | Area (sqm) | Price (SGD) | Lease Start | Remaining Lease |";
  const divider = "|---|---|---|---|---|---|---|---|---|";
  const rows = records.map(
    (r) =>
      `| ${r.month} | ${r.block} | ${r.streetName} | ${r.flatType} | ${r.storeyRange} | ${r.floorAreaSqm} | $${r.resalePrice.toLocaleString()} | ${r.leaseCommenceDate} | ${r.remainingLease} |`
  );

  return [header, divider, ...rows].join("\n");
}

// --- CSV ---

/** Escape a value for CSV: wrap in quotes if it contains commas, quotes, or newlines. */
function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function formatLandParcelsCsv(parcels: LandParcel[]): string {
  const header = "Land Use,Plot Ratio,Region,Planning Area,Subzone";
  const rows = parcels.map(
    (p) =>
      [p.landUse, p.grossPlotRatio ?? "N/A", p.region, p.planningArea, p.subzone]
        .map(csvEscape)
        .join(","),
  );
  return [header, ...rows].join("\n");
}

export function formatHdbCsv(records: HdbResaleRecord[]): string {
  const header =
    "Month,Block,Street,Flat Type,Storey Range,Floor Area (sqm),Resale Price (SGD),Flat Model,Lease Start,Remaining Lease";
  const rows = records.map(
    (r) =>
      [
        r.month,
        r.block,
        r.streetName,
        r.flatType,
        r.storeyRange,
        r.floorAreaSqm,
        String(r.resalePrice),
        r.flatModel,
        r.leaseCommenceDate,
        r.remainingLease,
      ]
        .map(csvEscape)
        .join(","),
  );
  return [header, ...rows].join("\n");
}

// --- Contract date formatting ---

/** Convert MMYY to human-readable "Mon YYYY". "0522" -> "May 2022". */
function formatContractDate(mmyy: string): string {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const mm = parseInt(mmyy.slice(0, 2), 10);
  const yy = parseInt(mmyy.slice(2, 4), 10);
  const year = yy >= 90 ? 1900 + yy : 2000 + yy;
  const month = months[mm - 1] ?? mmyy.slice(0, 2);
  return `${month} ${year}`;
}

// --- Private transactions ---

export function formatPrivateTransactionTable(records: PrivateTransaction[]): string {
  if (records.length === 0) {
    return "No private property transactions found matching your criteria.";
  }

  const header =
    "| Date | Project | Street | Type | District | Area (sqm) | Floor | Price (SGD) | Tenure | Segment |";
  const divider = "|---|---|---|---|---|---|---|---|---|---|";
  const rows = records.map((r) => {
    const date = formatContractDate(r.contractDate);
    const price = parseInt(r.price, 10);
    const priceStr = isNaN(price) ? r.price : `$${price.toLocaleString()}`;
    return `| ${date} | ${r.project} | ${r.street} | ${r.propertyType} | ${r.district} | ${r.area} | ${r.floorRange} | ${priceStr} | ${r.tenure} | ${r.marketSegment} |`;
  });

  return [header, divider, ...rows].join("\n");
}

export function formatPrivateTransactionCsv(records: PrivateTransaction[]): string {
  const header =
    "Contract Date,Project,Street,Property Type,District,Area (sqm),Floor Range,Price (SGD),Nett Price,Tenure,Market Segment,Type of Sale,Type of Area,No of Units";
  const rows = records.map((r) =>
    [
      formatContractDate(r.contractDate),
      r.project, r.street, r.propertyType, r.district, r.area,
      r.floorRange, r.price, r.nettPrice, r.tenure, r.marketSegment,
      r.typeOfSale, r.typeOfArea, r.noOfUnits,
    ].map(csvEscape).join(","),
  );
  return [header, ...rows].join("\n");
}

// --- Private rentals ---

export function formatPrivateRentalTable(records: PrivateRental[]): string {
  if (records.length === 0) {
    return "No private rental contracts found matching your criteria.";
  }

  const header =
    "| Lease Date | Project | Street | Type | District | Area (sqm) | Bedrooms | Rent (SGD/mth) |";
  const divider = "|---|---|---|---|---|---|---|---|";
  const rows = records.map((r) => {
    const date = formatContractDate(r.leaseDate);
    return `| ${date} | ${r.project} | ${r.street} | ${r.propertyType} | ${r.district} | ${r.areaSqm} | ${r.noOfBedRoom} | $${r.rent.toLocaleString()} |`;
  });

  return [header, divider, ...rows].join("\n");
}

export function formatPrivateRentalCsv(records: PrivateRental[]): string {
  const header =
    "Lease Date,Project,Street,Property Type,District,Area (sqm),Area (sqft),Bedrooms,Rent (SGD/mth)";
  const rows = records.map((r) =>
    [
      formatContractDate(r.leaseDate),
      r.project, r.street, r.propertyType, r.district,
      r.areaSqm, r.areaSqft, r.noOfBedRoom, String(r.rent),
    ].map(csvEscape).join(","),
  );
  return [header, ...rows].join("\n");
}

// --- Developer sales ---

export function formatDeveloperSaleTable(records: DeveloperSale[]): string {
  if (records.length === 0) {
    return "No developer sales data found matching your criteria.";
  }

  const header =
    "| Project | Street | District | Type | Developer | Median $/psf | Sold/Month | Sold Total | Available | Segment |";
  const divider = "|---|---|---|---|---|---|---|---|---|---|";
  const rows = records.map((r) => {
    const median = r.medianPrice > 0 ? `$${r.medianPrice.toLocaleString()}` : "N/A";
    return `| ${r.project} | ${r.street} | ${r.district} | ${r.propertyType} | ${r.developer} | ${median} | ${r.soldInMonth} | ${r.soldToDate} | ${r.unitsAvail} | ${r.marketSegment} |`;
  });

  return [header, divider, ...rows].join("\n");
}

export function formatDeveloperSaleCsv(records: DeveloperSale[]): string {
  const header =
    "Period,Project,Street,District,Property Type,Developer,Market Segment,Median $/psf,Highest $/psf,Lowest $/psf,Sold In Month,Sold To Date,Launched In Month,Launched To Date,Units Available";
  const rows = records.map((r) =>
    [
      r.refPeriod, r.project, r.street, r.district, r.propertyType,
      r.developer, r.marketSegment, String(r.medianPrice),
      String(r.highestPrice), String(r.lowestPrice), String(r.soldInMonth),
      String(r.soldToDate), String(r.launchedInMonth), String(r.launchedToDate),
      String(r.unitsAvail),
    ].map(csvEscape).join(","),
  );
  return [header, ...rows].join("\n");
}

// --- Rental median ---

export function formatRentalMedianTable(records: RentalMedian[]): string {
  if (records.length === 0) {
    return "No rental median data found.";
  }

  const header =
    "| Period | Project | Street | District | Median $/psf/mth | 25th %ile | 75th %ile |";
  const divider = "|---|---|---|---|---|---|---|";
  const rows = records.map((r) =>
    `| ${r.refPeriod} | ${r.project} | ${r.street} | ${r.district} | $${r.median.toFixed(2)} | $${r.psf25.toFixed(2)} | $${r.psf75.toFixed(2)} |`,
  );

  return [header, divider, ...rows].join("\n");
}

export function formatRentalMedianCsv(records: RentalMedian[]): string {
  const header = "Period,Project,Street,District,Median $/psf/mth,25th Percentile,75th Percentile";
  const rows = records.map((r) =>
    [
      r.refPeriod, r.project, r.street, r.district,
      String(r.median), String(r.psf25), String(r.psf75),
    ].map(csvEscape).join(","),
  );
  return [header, ...rows].join("\n");
}

// --- Pipeline ---

export function formatPipelineTable(records: PipelineProject[]): string {
  if (records.length === 0) {
    return "No pipeline project data found.";
  }

  const header =
    "| Project | Street | District | Developer | Total Units | Condo | Apt | Terrace | Semi-D | Detached | Expected TOP |";
  const divider = "|---|---|---|---|---|---|---|---|---|---|---|";
  const rows = records.map((r) =>
    `| ${r.project} | ${r.street} | ${r.district} | ${r.developerName} | ${r.totalUnits.toLocaleString()} | ${r.noOfCondo} | ${r.noOfApartment} | ${r.noOfTerrace} | ${r.noOfSemiDetached} | ${r.noOfDetachedHouse} | ${r.expectedTOPYear} |`,
  );

  return [header, divider, ...rows].join("\n");
}

export function formatPipelineCsv(records: PipelineProject[]): string {
  const header =
    "Project,Street,District,Developer,Total Units,Condos,Apartments,Terraces,Semi-Detached,Detached,Expected TOP";
  const rows = records.map((r) =>
    [
      r.project, r.street, r.district, r.developerName, String(r.totalUnits),
      String(r.noOfCondo), String(r.noOfApartment), String(r.noOfTerrace),
      String(r.noOfSemiDetached), String(r.noOfDetachedHouse), r.expectedTOPYear,
    ].map(csvEscape).join(","),
  );
  return [header, ...rows].join("\n");
}

// --- Car park availability ---

export function formatCarParkAvailabilityTable(records: CarParkAvailability[]): string {
  if (records.length === 0) {
    return "No car park availability data found.";
  }

  const lotTypeLabels: Record<string, string> = { C: "Car", M: "Motorcycle", H: "Heavy Vehicle" };
  const header = "| Carpark No | Lot Type | Lots Available |";
  const divider = "|---|---|---|";
  const rows = records.map((r) =>
    `| ${r.carparkNo} | ${lotTypeLabels[r.lotType] ?? r.lotType} | ${r.lotsAvailable} |`,
  );

  return [header, divider, ...rows].join("\n");
}

export function formatCarParkAvailabilityCsv(records: CarParkAvailability[]): string {
  const header = "Carpark No,Lot Type,Lots Available";
  const rows = records.map((r) =>
    [r.carparkNo, r.lotType, r.lotsAvailable].map(csvEscape).join(","),
  );
  return [header, ...rows].join("\n");
}

// --- Car park details ---

export function formatCarParkDetailTable(records: CarParkDetail[]): string {
  if (records.length === 0) {
    return "No car park details found.";
  }

  const header =
    "| Name | Code | Vehicle | Capacity | Weekday Rate | Sat Rate | Sun/PH Rate | Hours |";
  const divider = "|---|---|---|---|---|---|---|---|";
  const rows = records.map((r) =>
    `| ${r.ppName.trim()} | ${r.ppCode} | ${r.vehCat} | ${r.parkCapacity} | ${r.weekdayRate}/${r.weekdayMin} | ${r.satdayRate}/${r.satdayMin} | ${r.sunPHRate}/${r.sunPHMin} | ${r.startTime}-${r.endTime} |`,
  );

  return [header, divider, ...rows].join("\n");
}

export function formatCarParkDetailCsv(records: CarParkDetail[]): string {
  const header =
    "Code,Name,Vehicle Category,Capacity,Parking System,Start Time,End Time,Weekday Rate,Weekday Min,Saturday Rate,Saturday Min,Sun/PH Rate,Sun/PH Min";
  const rows = records.map((r) =>
    [
      r.ppCode, r.ppName.trim(), r.vehCat, String(r.parkCapacity), r.parkingSystem,
      r.startTime, r.endTime, r.weekdayRate, r.weekdayMin,
      r.satdayRate, r.satdayMin, r.sunPHRate, r.sunPHMin,
    ].map(csvEscape).join(","),
  );
  return [header, ...rows].join("\n");
}

// --- Season car parks ---

export function formatSeasonCarParkTable(records: SeasonCarPark[]): string {
  if (records.length === 0) {
    return "No season car park data found.";
  }

  const header =
    "| Name | Code | Vehicle | Monthly Rate | Hours | Ticket Type |";
  const divider = "|---|---|---|---|---|---|";
  const rows = records.map((r) =>
    `| ${r.ppName.trim()} | ${r.ppCode} | ${r.vehCat} | $${r.monthlyRate} | ${r.parkingHrs} | ${r.ticketType} |`,
  );

  return [header, divider, ...rows].join("\n");
}

export function formatSeasonCarParkCsv(records: SeasonCarPark[]): string {
  const header = "Code,Name,Vehicle Category,Monthly Rate,Parking Hours,Ticket Type";
  const rows = records.map((r) =>
    [r.ppCode, r.ppName.trim(), r.vehCat, r.monthlyRate, r.parkingHrs, r.ticketType]
      .map(csvEscape).join(","),
  );
  return [header, ...rows].join("\n");
}

// --- Planning decisions ---

export function formatPlanningDecisionTable(records: PlanningDecision[]): string {
  if (records.length === 0) {
    return "No planning decisions found.";
  }

  const header =
    "| Date | Address | Type | Application | Description |";
  const divider = "|---|---|---|---|---|";
  const rows = records.map((r) =>
    `| ${r.decisionDate} | ${r.address} | ${r.decisionType} | ${r.applType} | ${r.submissionDesc} |`,
  );

  return [header, divider, ...rows].join("\n");
}

export function formatPlanningDecisionCsv(records: PlanningDecision[]): string {
  const header =
    "Decision Date,Address,Decision Type,Application Type,Description,Decision No,Submission No";
  const rows = records.map((r) =>
    [
      r.decisionDate, r.address, r.decisionType, r.applType,
      r.submissionDesc, r.decisionNo, r.submissionNo,
    ].map(csvEscape).join(","),
  );
  return [header, ...rows].join("\n");
}

// --- Nearby amenities ---

const CATEGORY_LABELS: Record<string, string> = {
  school: "School",
  hospital: "Hospital",
  clinic: "Clinic",
  food_court: "Food Court / Hawker",
  marketplace: "Market",
  park: "Park",
  mrt: "MRT/LRT Station",
  bus_stop: "Bus Stop",
  supermarket: "Supermarket",
  pharmacy: "Pharmacy",
};

function formatDistance(meters: number): string {
  if (meters < 1000) return `${meters}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

export function formatNearbyAmenityTable(records: NearbyAmenity[]): string {
  if (records.length === 0) {
    return "No nearby amenities found matching your criteria.";
  }

  const header = "| Category | Name | Distance | Address |";
  const divider = "|---|---|---|---|";
  const rows = records.map((r) =>
    `| ${CATEGORY_LABELS[r.category] ?? r.category} | ${r.name} | ${formatDistance(r.distanceMeters)} | ${r.address ?? "—"} |`,
  );

  return [header, divider, ...rows].join("\n");
}

export function formatNearbyAmenityCsv(records: NearbyAmenity[]): string {
  const header = "Category,Name,Distance (m),Latitude,Longitude,Address";
  const rows = records.map((r) =>
    [
      CATEGORY_LABELS[r.category] ?? r.category,
      r.name,
      String(r.distanceMeters),
      String(r.lat),
      String(r.lon),
      r.address ?? "",
    ].map(csvEscape).join(","),
  );
  return [header, ...rows].join("\n");
}

// --- Bus stops ---

export function formatBusStopTable(records: BusStopInfo[]): string {
  if (records.length === 0) {
    return "No bus stops found within the specified radius.";
  }

  const header = "| Code | Description | Road | Distance |";
  const divider = "|---|---|---|---|";
  const rows = records.map((r) =>
    `| ${r.busStopCode} | ${r.description} | ${r.roadName} | ${formatDistance(r.distanceMeters)} |`,
  );

  return [header, divider, ...rows].join("\n");
}

export function formatBusStopCsv(records: BusStopInfo[]): string {
  const header = "Bus Stop Code,Description,Road Name,Distance (m),Latitude,Longitude";
  const rows = records.map((r) =>
    [r.busStopCode, r.description, r.roadName, String(r.distanceMeters), String(r.lat), String(r.lon)]
      .map(csvEscape).join(","),
  );
  return [header, ...rows].join("\n");
}

// --- Bus arrival ---

const LOAD_LABELS: Record<string, string> = {
  SEA: "Seats Avail",
  SDA: "Standing",
  LSD: "Limited",
};

function formatEta(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes === 0) return "Arr";
  return `${minutes} min`;
}

export function formatBusArrivalTable(records: BusArrivalService[]): string {
  if (records.length === 0) {
    return "No bus services found at this stop.";
  }

  const header = "| Bus | Operator | Next | Load | 2nd | Load | 3rd | Load |";
  const divider = "|---|---|---|---|---|---|---|---|";
  const rows = records.map((r) =>
    `| ${r.serviceNo} | ${r.operator} | ${formatEta(r.nextBusMinutes)} | ${LOAD_LABELS[r.nextBusLoad] ?? r.nextBusLoad} | ${formatEta(r.nextBus2Minutes)} | ${LOAD_LABELS[r.nextBus2Load] ?? r.nextBus2Load} | ${formatEta(r.nextBus3Minutes)} | ${LOAD_LABELS[r.nextBus3Load] ?? r.nextBus3Load} |`,
  );

  return [header, divider, ...rows].join("\n");
}

export function formatBusArrivalCsv(records: BusArrivalService[]): string {
  const header = "Service,Operator,Next (min),Next Load,Next Type,2nd (min),2nd Load,3rd (min),3rd Load";
  const rows = records.map((r) =>
    [
      r.serviceNo, r.operator,
      r.nextBusMinutes !== null ? String(r.nextBusMinutes) : "", r.nextBusLoad, r.nextBusType,
      r.nextBus2Minutes !== null ? String(r.nextBus2Minutes) : "", r.nextBus2Load,
      r.nextBus3Minutes !== null ? String(r.nextBus3Minutes) : "", r.nextBus3Load,
    ].map(csvEscape).join(","),
  );
  return [header, ...rows].join("\n");
}

// --- Taxi stands ---

export function formatTaxiStandTable(records: TaxiStandInfo[]): string {
  if (records.length === 0) {
    return "No taxi stands found within the specified radius.";
  }

  const header = "| Code | Name | Type | Barrier Free | Distance |";
  const divider = "|---|---|---|---|---|";
  const rows = records.map((r) =>
    `| ${r.taxiCode} | ${r.name} | ${r.type} | ${r.barrierFree ? "Yes" : "No"} | ${formatDistance(r.distanceMeters)} |`,
  );

  return [header, divider, ...rows].join("\n");
}

export function formatTaxiStandCsv(records: TaxiStandInfo[]): string {
  const header = "Taxi Code,Name,Type,Ownership,Barrier Free,Distance (m),Latitude,Longitude";
  const rows = records.map((r) =>
    [
      r.taxiCode, r.name, r.type, r.ownership,
      r.barrierFree ? "Yes" : "No", String(r.distanceMeters),
      String(r.lat), String(r.lon),
    ].map(csvEscape).join(","),
  );
  return [header, ...rows].join("\n");
}

// --- School info ---

function formatPrograms(s: SchoolInfo): string {
  const programs: string[] = [];
  if (s.sap) programs.push("SAP");
  if (s.ip) programs.push("IP");
  if (s.gifted) programs.push("GEP");
  if (s.autonomous) programs.push("Auto");
  return programs.length > 0 ? programs.join(", ") : "—";
}

export function formatSchoolTable(records: SchoolInfo[]): string {
  if (records.length === 0) {
    return "No schools found matching your criteria.";
  }

  const header = "| School | Level | Zone | Cluster | Nature | Programs | Mother Tongues |";
  const divider = "|---|---|---|---|---|---|---|";
  const rows = records.map((s) =>
    `| ${s.schoolName} | ${s.level} | ${s.zone} | ${s.cluster} | ${s.nature} | ${formatPrograms(s)} | ${s.motherTongues.join(", ") || "—"} |`,
  );

  return [header, divider, ...rows].join("\n");
}

export function formatSchoolCsv(records: SchoolInfo[]): string {
  const header = "School Name,Address,Postal Code,Level,Zone,Cluster,Type,Nature,Session,SAP,IP,GEP,Autonomous,Mother Tongues,Telephone,Email,URL,Nearest MRT,Bus Services";
  const rows = records.map((s) =>
    [
      s.schoolName, s.address, s.postalCode, s.level, s.zone, s.cluster,
      s.type, s.nature, s.session,
      s.sap ? "Yes" : "No", s.ip ? "Yes" : "No",
      s.gifted ? "Yes" : "No", s.autonomous ? "Yes" : "No",
      s.motherTongues.join("; "),
      s.telephone, s.email, s.url, s.nearestMrt, s.busServices,
    ].map(csvEscape).join(","),
  );
  return [header, ...rows].join("\n");
}

// --- Demographic snapshot ---

function formatCount(value: number | null, uom: string): string {
  if (value === null) return "—";
  const rounded = Math.round(value);
  if (uom.toLowerCase() === "thousands") return `${rounded.toLocaleString()}k`;
  return rounded.toLocaleString();
}

function formatMetric(m: DemographicMetric, uom: string, indent: number): string {
  const pad = "  ".repeat(indent);
  const pct = m.pctOfTotal !== undefined ? ` (${m.pctOfTotal.toFixed(1)}%)` : "";
  const lines = [`${pad}- ${m.label}: ${formatCount(m.value, uom)}${pct}`];
  if (m.children && m.children.length > 0) {
    for (const c of m.children) {
      lines.push(formatMetric(c, uom, indent + 1));
    }
  }
  return lines.join("\n");
}

function formatDimension(dim: DemographicDimension): string {
  const header = `**${dim.name}** — ${dim.source}`;
  const totalLine = `Total: ${formatCount(dim.total, dim.uom)}`;
  const metricLines = dim.metrics.map((m) => formatMetric(m, dim.uom, 0)).join("\n");
  return `${header}\n${totalLine}\n${metricLines}`;
}

export function formatDemographicSnapshot(snap: DemographicSnapshot): string {
  if (snap.dimensions.length === 0) {
    return `No demographic data available for "${snap.planningArea}".`;
  }

  const parts = [`# Demographic snapshot — ${snap.planningArea}`];
  for (const dim of snap.dimensions) {
    parts.push(formatDimension(dim));
  }
  if (snap.unavailable.length > 0) {
    parts.push(`_Unavailable: ${snap.unavailable.join(", ")}_`);
  }
  return parts.join("\n\n");
}

/** CSV form: long-format rows — one per (dimension, metric, sub-metric). */
export function formatDemographicCsv(snap: DemographicSnapshot): string {
  const header = "Planning Area,Dimension,Source,Metric,Sub-Metric,Value,Percent of Total,Unit";
  const rows: string[] = [];

  for (const dim of snap.dimensions) {
    rows.push(
      [
        snap.planningArea, dim.name, dim.source, "Total", "",
        dim.total === null ? "" : String(dim.total),
        "", dim.uom,
      ].map(csvEscape).join(","),
    );
    for (const m of dim.metrics) {
      rows.push(
        [
          snap.planningArea, dim.name, dim.source, m.label, "",
          m.value === null ? "" : String(m.value),
          m.pctOfTotal === undefined ? "" : m.pctOfTotal.toFixed(2),
          dim.uom,
        ].map(csvEscape).join(","),
      );
      if (m.children) {
        for (const c of m.children) {
          rows.push(
            [
              snap.planningArea, dim.name, dim.source, m.label, c.label,
              c.value === null ? "" : String(c.value),
              "", dim.uom,
            ].map(csvEscape).join(","),
          );
        }
      }
    }
  }

  return [header, ...rows].join("\n");
}
