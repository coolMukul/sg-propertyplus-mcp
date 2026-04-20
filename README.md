# SG-PropertyPlus MCP Server

An advanced Model Context Protocol (MCP) server that provides deep intelligence on the Singapore property market. By aggregating data from URA, HDB, LTA, and SingStat, it allows AI agents (like Claude or ChatGPT) to perform professional-grade real estate analysis.

## 🚀 Key Features

* **Private Property Insights (URA):** Sale transactions, rental contracts, and developer sales.
* **Performance Optimized:** Intelligent data fetching (12-month defaults) to prevent Gateway Timeouts on large datasets (140k+ records).
* **Predictive Intelligence:** * **Supply Risk Analysis:** Analyzes the upcoming residential pipeline to flag potential oversupply in specific districts.
    * **Gentrification Tracking:** Identifies "Change of Use" planning permissions to spot neighborhood transformations.
* **Public Housing (HDB):** Historical resale prices and trends.
* **Urban Context:** Real-time car park availability, school locations, and land use (Master Plan 2019).
* **Transport Links (LTA):** Real-time bus arrivals and taxi availability near target properties.

## 🛠 Setup

### 1. Prerequisites
* Node.js v20 or higher.
* API Credentials for:
    * [URA Data Service](https://eservice.ura.gov.sg/maps/api/reg.html) (Free)
    * [LTA DataMall](https://datamall.lta.gov.sg) (Free)
    * [OneMap](https://www.onemap.gov.sg/apidocs/register) (Free, optional)

### 2. Environment Configuration
Create a `.env` file in the root directory (refer to `.env.example`):
```env
URA_ACCESS_KEY=your_key_here
LTA_ACCOUNT_KEY=your_key_here
PRIVATE_TXN_LIMIT_DEFAULT=40