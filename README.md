# sg-propertyplus-mcp

![License: MIT](https://img.shields.io/badge/License-MIT-green.svg) ![Node](https://img.shields.io/badge/Node-18%2B-brightgreen) ![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue) ![MCP SDK](https://img.shields.io/badge/MCP%20SDK-1.29-blueviolet) ![Singapore](https://img.shields.io/badge/Singapore-Property%20Data-red)

**The most comprehensive Singapore property MCP server.** A TypeScript Model Context Protocol (MCP) server with 25 tools, 7 government data sources, advanced MCP features (sampling, roots, resources, progress notifications), and dual transports (stdio + Streamable HTTP).

`sg-propertyplus-mcp` gives AI assistants (Claude, GPT, and any MCP-compatible client) real-time, authoritative access to Singapore's property and investment data ecosystem — URA, HDB, LTA, OneMap, SingStat, OSM, and MOE — in a single well-typed server.

> **Research that takes hours across 5+ government portals → seconds of AI-synthesized insight.**

---

## ⚖️ Legal & Professional Disclaimer

**Professional Status:** Independent, open-source project developed by the author in a personal capacity for educational and technical demonstration purposes. **Not** affiliated with, endorsed by, or representative of any government agency, nor any past or present employer.

**Intended Use:** Built specifically as a **Real Estate Sales Support and Investment Research aid for consumers and investors**. It reads public open data — it does not assess, advise on, or process planning matters.

**Out of Scope:** This project does **not** provide — and must not be used for — statutory urban planning, development application (DA) processing, planning consultancy, zoning advisory, or any professional land-use governance activity. Geographic coverage is **Singapore only**; no other jurisdiction (including Australia) is supported.

**Data Accuracy:** Informational data only. Property transactions, zoning, and planning decisions should always be verified via official Urban Redevelopment Authority (URA) and Housing & Development Board (HDB) channels before making financial or legal commitments.

---

## 🛠️ Features & Performance Optimization

- **Performance First:** 5 years of private transaction data is available, with queries defaulting to a **12-month window** for lightning-fast responses and to prevent LLM timeouts when scanning 140k+ records.
- **Investment Analysis:** Compare private transaction yields against HDB resale trends and upcoming pipeline supply.
- **Predictive Intelligence:** - **Supply Risk:** Tools prioritize completion years to flag potential oversupply in specific districts for investor awareness.
    - **Gentrification Signals:** Tracks "Change of Use" permission records to flag neighbourhood trend signals for investors and buyers.
- **Due Diligence:** Verify residential use approval and check for nearby amenities (schools, healthcare, hawkers) for prospective buyers.
- **Smart Mobility:** Real-time bus arrivals, taxi availability, and live carpark lot counts.

---

## 🧩 Advanced Model Context Protocol (MCP) Features

Beyond tools, this server implements the full spectrum of the MCP specification — useful as a reference implementation for devs building their own MCP servers.

- **Sampling** — `analyze_results` calls back to the client's LLM via `server.server.createMessage()` to synthesize insights on the last search. Includes a re-entrancy guard to prevent infinite recursion.
- **Roots** — `export_csv` / `export_md` validate target paths against client-approved root directories (`server.server.listRoots()`). Deny-by-default when the client declares no roots.
- **Resources** — `sglandscope://last-search` and `sglandscope://status` expose session state as MCP resources for clients that prefer resources over tools.
- **Progress notifications** — long-running queries (URA 4-batch fetch, LTA bus stop pagination) stream `notifications/progress` updates to the client.
- **Log notifications** — human-readable status messages pushed via `notifications/message`.
- **Dual transports** — stdio (desktop MCP clients) and Streamable HTTP (stateful sessions or stateless) switchable via a single env var.
- **Per-session state** — each HTTP client gets isolated `SessionState`; rate limiters are shared across sessions to correctly enforce upstream API quotas.
- **DNS rebinding protection** — HTTP mode validates the `Host` header against a whitelist.

---

## 🧰 MCP Tools (25)

### 🏗️ Property Location & Zoning
- `search_area` / `search_area_by_coords`: Look up Master Plan zoning and land use around an address (informational).
- `check_residential_use`: Verify whether a private unit has approved residential use (informational look-up).
- `search_planning_decisions`: Read past written permissions (e.g. "Change of Use") as a trend-reading aid for buyers and investors.

### 💰 Property Transactions & Rentals
- `search_private_transactions`: Private sale data (5 years available, 12-month default window).
- `search_private_rentals`: Signed rental contracts by quarter.
- `search_hdb_resale`: HDB transactions (2017–Present).
- `search_developer_sales`: New launch performance (units sold, median $/psf).
- `search_rental_median`: $/psf/month benchmarks with 25th/75th percentile bands.
- `search_pipeline`: Upcoming supply risk (units under construction/planning).

### 🚌 Transport & Amenities
- `search_nearby_amenities`: Schools, hospitals, parks, and hawkers via OSM.
- `search_nearest_transport`: Nearest bus stops and taxi stands by coordinates.
- `search_bus_arrival`: Live arrival times and crowding levels.
- `search_taxi_availability` / `search_carpark_availability`: Real-time availability feeds.
- `search_carpark_rates` / `search_season_carpark`: Pricing and operating hours.

### 🏫 Community & Demographics
- `search_school_info`: MOE school directory — filter by zone, level, and special programs.
- `search_population_demographics`: Census 2020 snapshot by planning area (dwelling, size, income, tenancy).

### 🧮 Financial & Comparative
- `calculate_stamp_duty`: BSD + ABSD calculator across all buyer profiles (informational only).
- `compare_areas`: Side-by-side comparison of two addresses — zoning, prices, rents, transport, amenities.

### 📊 Utilities
- `analyze_results`: AI-generated insights on your last search (requires client sampling support).
- `export_csv` / `export_md`: Export last search to CSV or Markdown (honours client-approved roots).
- `get_attributions`: List data source credits.

---

## 💬 Example Conversations

**"Should I buy a condo near Bishan MRT with a $1.5M budget?"**
The AI chains: `search_area` → `search_private_transactions` → `search_rental_median` → `search_pipeline` → `search_nearby_amenities` → `search_nearest_transport` — returning zoning context, recent sale prices, rental yield potential, pipeline supply risk, schools and clinics within walking distance, and MRT/bus accessibility. Exportable as a report via `export_md`.

**"I own a 3-bed at The Interlace. What should I charge for the renewal?"**
Actual signed rental contracts (not listing asks), median rates with 25th/75th percentile bands, and quarter-over-quarter trends. "Your proposed $6,500 is at the 40th percentile for The Interlace 3-beds — room to push to $7,000."

**"Compare Districts 15 and 20 for investment"**
Transaction data, rental yields, developer sales activity, pipeline supply, and amenity counts for both districts — side by side, with AI-synthesized verdicts.

**"I'm relocating to Singapore for work in Raffles Place. Budget $5,000/month."**
Rental contracts filtered to budget and bedroom count across multiple districts. For each area: amenity profile, transport to CBD, and rental trend direction.

**"I'm at Block 230 Ang Mo Kio. What buses are nearby and is there parking?"**
Real-time bus arrivals (next 3 buses with crowding levels), nearest taxi availability, and live carpark lot counts — all from a single coordinate.

**"I'm a PR buying my second property at $2.2M. What's my stamp duty?"**
`calculate_stamp_duty` returns the full breakdown — BSD across progressive brackets plus ABSD for the buyer profile — with effective rate, IRAS effective dates, and an informational disclaimer. No guessing, no spreadsheets.

**"What's the going rate for a 4-room in Tampines?"**
`search_hdb_resale` returns recent signed transactions filtered by town and flat type — actual prices, floor area, remaining lease, and storey range. The AI reads the trend and anchors your expectation ("median $585k over the last 20 sales, upper 25% above $620k").

**"Find condos near Nanyang Primary with 3-bed rentals under $6,000."**
`search_school_info` locates the school → `search_nearby_amenities` / `search_area_by_coords` pull nearby developments → `search_private_rentals` filters to budget and bedroom count. One prompt replaces a morning on PropertyGuru + MOE's school finder.

---

## 🚀 Quick Start

### 1. Clone

```bash
git clone https://github.com/coolMukul/sg-propertyplus-mcp.git
cd sg-propertyplus-mcp
```

### 2. Installation

This repository uses `pnpm` (see `pnpm-lock.yaml`). Install dependencies and build:

```bash
pnpm install
pnpm run build
```

### 3. Configuration

Create a `.env` file based on `.env.example`. You will need (free) API keys for:

- URA Data Service: https://eservice.ura.gov.sg/maps/api/reg.html
- LTA DataMall: https://datamall.lta.gov.sg/
- OneMap (optional): https://www.onemap.gov.sg/apidocs/register

Example variables (add these to your `.env`):

```env
URA_ACCESS_KEY=your_key_here
LTA_ACCOUNT_KEY=your_key_here
PRIVATE_TXN_LIMIT_DEFAULT=40
```

### 4. Run

Run over stdio (typical for desktop MCP clients):

```bash
pnpm start
```

Or run the HTTP transport for remote / multi-client setups:

```bash
pnpm run dev:http          # stateful mode (sessions)
pnpm run dev:http:stateless # stateless mode
```

### 5. Connect to an MCP Client

Add the server to your MCP client config. Example snippet:

```json
{
  "mcpServers": {
    "sg-propertyplus": {
      "command": "node",
      "args": ["/absolute/path/to/sg-propertyplus-mcp/dist/index.js"]
    }
  }
}
```

---

## 🏗️ Technical Architecture

**Stack:** TypeScript (strict, ES2022, NodeNext), Node 18+ native `fetch`, Express 5, Zod schemas, `@modelcontextprotocol/sdk` ^1.29.0.

**Resilience & performance:**
- Multi-batch ingestion with client-side filtering and descending-date sorting
- In-memory caching for static datasets (~5,200 bus stops, ~316 taxi stands, ~337 schools)
- Serialized rate limiters tuned per upstream: 15s backoff on SingStat 429/503, 2s pacing for data.gov.sg, 5s for Overpass, 500ms for URA
- Graceful degradation — missing API credentials disable specific tools rather than crashing the server
- Single-fetch pattern for `compare_areas` — URA transactions, rental median, and pipeline fetched once and filtered for both districts

**Modular layout:** one concern per file — `src/tools/` (tool definitions), `src/api/` (upstream clients), `src/formatters.ts`, `src/state.ts`, `src/helpers.ts`.

---

(c) 2026 SG-PropertyPlus. Data provided by URA, HDB, LTA, OneMap, SingStat, MOE, and OpenStreetMap contributors.