# sg-propertyplus-mcp

**The most comprehensive Singapore property MCP server.** 21 tools, 7 government data sources, one conversation.

Land use zoning, private property transactions, HDB resale prices, rental contracts, developer sales, development pipeline, nearby amenities, real-time transport, carpark availability, and planning decisions — all accessible from any MCP-compatible AI assistant.

> **2-4 hours of manual research across 5+ government websites &rarr; one conversation.**

---

## Who Is This For?

- **Property investors** evaluating districts, comparing yields, and monitoring pipeline supply risk
- **Property agents** preparing viewing briefs and client area reports in minutes, not hours
- **Home buyers** doing due diligence on a purchase — zoning, prices, schools, transport, all in one place
- **Expat tenants** navigating a new city — actual rental contract data, not listing asks
- **Developers** checking zoning, plot ratios, and planning approvals for site feasibility

---

## Example Conversations

**"Should I buy a condo near Bishan MRT with a $1.5M budget?"**
The AI chains: `search_area` &rarr; `search_private_transactions` &rarr; `search_rental_median` &rarr; `search_pipeline` &rarr; `search_nearby_amenities` &rarr; `search_nearest_transport` — returning zoning context, recent sale prices, rental yield potential, pipeline supply risk, schools and clinics within walking distance, and MRT/bus accessibility. Exportable as a report via `export_md`.

**"I own a 3-bed at The Interlace. What should I charge for the renewal?"**
Actual signed rental contracts (not listing asks), median rates with 25th/75th percentile bands, and quarter-over-quarter trends. "Your proposed $6,500 is at the 40th percentile for The Interlace 3-beds — room to push to $7,000."

**"Compare Districts 15 and 20 for investment"**
Transaction data, rental yields, developer sales activity, pipeline supply, and amenity counts for both districts — side by side, with AI-synthesized verdicts.

**"I'm relocating to Singapore for work in Raffles Place. Budget $5,000/month."**
Rental contracts filtered to budget and bedroom count across multiple districts. For each area: amenity profile, transport to CBD, and rental trend direction.

**"I'm at Block 230 Ang Mo Kio. What buses are nearby and is there parking?"**
Real-time bus arrivals (next 3 buses with crowding levels), nearest taxi availability, and live carpark lot counts — all from a single coordinate.

---

## Tools (21)

### Land Use & Zoning
| Tool | Description |
|---|---|
| `search_area` | Search land use and zoning near a Singapore address |
| `search_area_by_coords` | Search land use and zoning near a lat/lng coordinate |
| `check_residential_use` | Check if an address is approved for residential use |
| `search_planning_decisions` | Planning permissions — granted, rejected, or pending |

### Property Transactions & Rentals
| Tool | Description |
|---|---|
| `search_hdb_resale` | HDB resale transactions by town and flat type (2017 onwards) |
| `search_private_transactions` | Private property sale prices — 5 years, ~140k records |
| `search_private_rentals` | Private rental contracts by quarter (actual signed rents) |
| `search_developer_sales` | New launch sales: median/high/low $/psf, units sold |
| `search_rental_median` | Median rental rates with 25th/75th percentile bands |
| `search_pipeline` | Upcoming developments: unit counts, developer, expected TOP |

### Nearby Amenities
| Tool | Description |
|---|---|
| `search_nearby_amenities` | Schools, hospitals, parks, MRT, hawker centres, supermarkets, pharmacies near a coordinate |

### Transport & Parking
| Tool | Description |
|---|---|
| `search_nearest_transport` | Bus stops and taxi stands near a coordinate |
| `search_bus_arrival` | Real-time bus arrival times (20s refresh, crowding levels) |
| `search_taxi_availability` | Available taxis near a coordinate (real-time) |
| `search_carpark_availability` | Real-time car park lot counts (updates every 3-5 min) |
| `search_carpark_rates` | Car park rates, capacity, and operating hours |
| `search_season_carpark` | Season parking monthly rates and ticket types |

### Analysis & Export
| Tool | Description |
|---|---|
| `analyze_results` | AI-powered analysis of last search results (MCP sampling) |
| `export_csv` | Export last search to CSV (respects MCP roots) |
| `export_md` | Export last search to Markdown |
| `get_attributions` | Data source attributions and licences |

### Resources
| URI | Description |
|---|---|
| `sgpropertyplus://last-search` | Last search results (query, data, timestamp) |
| `sgpropertyplus://status` | Server status, uptime, search count |

---

## Quick Start

### Prerequisites

- Node.js >= 20.6
- npm

### Install

```bash
git clone https://github.com/coolMukul/sg-propertyplus-mcp.git
cd sg-propertyplus-mcp
npm install
cp .env.example .env
npm run build
```

### Works Out of the Box (No API Keys)

These tools require **zero configuration**:

- **Land use & zoning** — `search_area`, `search_area_by_coords`, `check_residential_use`
- **HDB resale** — `search_hdb_resale`
- **Nearby amenities** — `search_nearby_amenities` (schools, hospitals, parks, MRT, hawker centres)
- **Analysis & export** — `analyze_results`, `export_csv`, `export_md`, `get_attributions`

### Optional API Keys (All Free)

Register for free keys to unlock the full 21-tool experience:

| Data | Registration | Env Var |
|---|---|---|
| Enhanced geocoding | [OneMap](https://www.onemap.gov.sg/apidocs/register) | `ONEMAP_EMAIL` + `ONEMAP_PASSWORD` |
| Private property (transactions, rentals, pipeline) | [URA Data Service](https://eservice.ura.gov.sg/maps/api/reg.html) | `URA_ACCESS_KEY` |
| Transport (bus, taxi, carpark) | [LTA DataMall](https://datamall.lta.gov.sg) | `LTA_ACCOUNT_KEY` |

Add your keys to `.env`:

```env
ONEMAP_EMAIL=your@email.com
ONEMAP_PASSWORD=your_password
URA_ACCESS_KEY=your_access_key_here
LTA_ACCOUNT_KEY=your_account_key_here
```

See [.env.example](.env.example) for all configuration options.

---

## Usage

### Claude Desktop / Claude Code

Add to your MCP client config (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "sg-propertyplus": {
      "command": "node",
      "args": ["--env-file=/path/to/sg-propertyplus-mcp/.env", "/path/to/sg-propertyplus-mcp/dist/index.js"]
    }
  }
}
```

### Claude Code CLI

```bash
claude mcp add sg-propertyplus node -- --env-file=.env dist/index.js
```

### Stdio

```bash
npm start
```

### HTTP Transport (Multi-Client)

```bash
# Stateful (sessions, SSE streams, server-push)
TRANSPORT=http npm start

# Stateless (fresh server per request, no sessions)
TRANSPORT=http HTTP_MODE=stateless npm start
```

Listens on `http://127.0.0.1:3000/mcp` by default. Configure with `HTTP_PORT` and `HTTP_HOST`.

### Development

```bash
npm run dev                  # stdio with hot reload
npm run dev:http             # HTTP stateful with hot reload
npm run dev:http:stateless   # HTTP stateless with hot reload
npm run typecheck            # type check without emitting
```

---

## Rate Limits

All data sources are free government APIs with rate limits. The server queues requests internally to stay within limits, but if your AI assistant fires many tools in parallel, some calls may fail with connection errors. This is normal — the assistant will typically retry.

| Source | Limit | Notes |
|---|---|---|
| OneMap (geocoding) | 250 req/min | Fast, rarely an issue |
| URA Data Service (property data) | Conservative 500ms pacing | Parallel calls to different URA endpoints may hit limits |
| LTA DataMall (transport) | 200ms pacing | First call is slow (~3-5s) due to fetching 5,200+ bus stops |
| Overpass API (amenities) | ~2 req/10s | Strictest limit; retries automatically on 429/504 |
| data.gov.sg (HDB resale) | No documented limit | Reliable |

**Tip:** If you see dropped calls, simply ask the assistant to retry — the rate limiter will space requests appropriately on the second attempt.

---

## Architecture

Built with TypeScript (strict mode, ES modules) on the [Model Context Protocol SDK](https://modelcontextprotocol.io).

- **Dual transport** — stdio for local clients, Streamable HTTP (stateful + stateless) for remote/multi-client
- **Per-session isolation** — each HTTP session has its own state; no cross-client data leaks
- **Serialized rate limiting** — concurrent API requests are queued per source, shared across all clients
- **Graceful degradation** — geocoding falls back automatically when credentials are unavailable; API errors return actionable messages, never raw exceptions
- **Security** — MCP roots enforcement for file exports, DNS rebinding protection on HTTP transport, sampling recursion guard
- **Zero-key baseline** — land use, HDB resale, and amenities work without any API credentials

---

## Data Attribution

This project uses publicly available Singapore government and open data sources.

| Source | Attribution |
|---|---|
| Geocoding | OneMap, Singapore Land Authority — https://www.onemap.gov.sg |
| Geocoding (fallback) | Data &copy; OpenStreetMap contributors — https://www.openstreetmap.org/copyright |
| Land use & zoning | &copy; Urban Redevelopment Authority — https://www.ura.gov.sg |
| Private property data | &copy; Urban Redevelopment Authority — https://www.ura.gov.sg |
| HDB resale transactions | Contains information from data.gov.sg accessed under the [Singapore Open Data Licence](https://data.gov.sg/open-data-licence) |
| Nearby amenities | Data &copy; OpenStreetMap contributors — https://www.openstreetmap.org/copyright |
| Transport data | Contains information from LTA DataMall accessed under the [Singapore Open Data Licence](https://data.gov.sg/open-data-licence) — https://datamall.lta.gov.sg |

## License

MIT
