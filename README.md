# sg-propertyplus-mcp

**The most comprehensive Singapore property MCP server.** 21 tools, 7 government data sources, one conversation.

`sg-propertyplus-mcp` is a high-performance Model Context Protocol (MCP) server that provides AI assistants (Claude, GPT) with real-time, authoritative access to Singapore's property and investment data ecosystem.

> **Research that takes hours across 5+ government portals → seconds of AI-synthesized insight.**

---

## ⚖️ Legal & Professional Disclaimer

**Professional Status:** This is an independent, open-source project developed solely by the author in a personal capacity for educational and technical demonstration purposes. It is **not** affiliated with, endorsed by, or representative of any government agency, nor any past or present employer.

**Intended Use:** This tool is built specifically as a **Real Estate Sales Support and Investment Research aid**. It is not intended for statutory urban planning or any professional activity related to land-use governance.

**Data Accuracy:** This tool provides informational data only. Property transactions, zoning, and planning decisions should always be verified via official Urban Redevelopment Authority (URA) and Housing & Development Board (HDB) channels before making financial or legal commitments.

---

## 🛠️ Features & Performance Optimization

- **Performance First:** Private transaction queries now default to a **12-month window** to ensure lightning-fast responses and prevent LLM timeouts when scanning 140k+ records.
- **Investment Analysis:** Compare private transaction yields against HDB resale trends and upcoming pipeline supply.
- **Predictive Intelligence:** - **Supply Risk:** Tools now prioritize completion years to flag potential oversupply in specific districts.
    - **Gentrification Tracking:** Analyzes "Change of Use" planning permissions to identify shifting commercial interest.
- **Due Diligence:** Verify residential use approval and check for nearby amenities (schools, healthcare, hawkers) for prospective buyers.
- **Smart Mobility:** Real-time bus arrivals, taxi availability, and live carpark lot counts.

---

## 🧰 Tools (21)

### 🏗️ Site Selection & Zoning
- `search_area` / `search_area_by_coords`: Master Plan zoning and land use.
- `check_residential_use`: Authoritative check for approved private residential status.
- `search_planning_decisions`: Search written permissions for "Change of Use" or new development activity.

### 💰 Property Transactions & Rentals
- `search_private_transactions`: 5 years of private sale data (optimized for performance).
- `search_private_rentals`: Signed rental contracts by quarter.
- `search_hdb_resale`: HDB transactions (2017–Present).
- `search_developer_sales`: New launch performance (units sold, median $/psf).
- `search_rental_median`: $/psf/month benchmarks with 25th/75th percentile bands.
- `search_pipeline`: Upcoming supply risk (units under construction/planning).

### 🚌 Transport & Amenities
- `search_nearby_amenities`: Schools, hospitals, parks, and hawkers via OSM.
- `search_bus_arrival`: Live arrival times and crowding levels (LTA DataMall).
- `search_taxi_availability` / `search_carpark_availability`: Real-time availability feeds.
- `search_carpark_rates` / `search_season_carpark`: Pricing and operating hours.

---

## 🚀 Quick Start

### 1. Clone

git clone https://github.com/coolMukul/sg-propertyplus-mcp.git
cd sg-propertyplus-mcp

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

### Technical Architecture

- Language: TypeScript
- Protocol: Model Context Protocol (MCP)
- Data Strategy: Multi-batch ingestion with client-side filtering and descending-date sorting
- Resilience: Integrated 15s backoff for SingStat and 2s delay for Data.gov.sg to handle rate-limiting

(c) 2026 SG-PropertyPlus. Data provided by URA, HDB, LTA, and SingStat.