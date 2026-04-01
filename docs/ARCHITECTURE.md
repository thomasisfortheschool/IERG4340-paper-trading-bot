# Architecture - IERG4340 Trading System

## System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Web Dashboard (React/Next.js)            │
│  - Portfolio visualization, P&L charts                       │
│  - Strategy allocation controls                              │
│  - Screening results display                                 │
│  - Configuration management                                  │
│  → Deployed to: Vercel                                       │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       │ HTTP/REST
                       │
┌──────────────────────▼──────────────────────────────────────┐
│              Flask API Server (Python)                       │
│  - Portfolio snapshots, historical data                      │
│  - Configuration CRUD                                        │
│  - Strategy screening orchestration                          │
│  - Trading order placement/management                        │
│  → Deployed to: Railway/Heroku/GCP                          │
└──────────────────────┬──────────────────────────────────────┘
                       │
       ┌───────────────┼───────────────┐
       │               │               │
       │               │               │
   ┌───▼───┐    ┌─────▼──────┐   ┌────▼────┐
   │Config │    │ Screeners  │   │  Bots   │
   │Manager│    │            │   │         │
   └───┬───┘    ├────────────┤   ├────────┤
       │        │Fundamental │   │Blowup  │
       │        │  Screener  │   │ Stock  │
       │        ├────────────┤   ├────────┤
       │        │  Option    │   │Covered │
       │        │ Screener   │   │ Call   │
       │        ├────────────┤   ├────────┤
       │        │   Forex    │   │Forex   │
       │        │ Screener   │   │ Bot    │
       │        └────────────┘   └───┬────┘
       │                              │
       │        ┌─────────────────────┘
       │        │
   ┌───▼────────▼─────────────────────┐
   │      Broker Interface (Abstract)  │
   │  - IBKR (Paper Trading)           │
   │  - Alpaca (via factory)           │
   │  - Custom integrations            │
   └───────────────┬────────────────────┘
                   │
   ┌───────────────┼───────────────┐
   │               │               │
   │         ┌─────▼──────┐       │
   │         │ Mock Data  │       │
   │         │ (for demo) │       │
   │         └────────────┘       │
   │                              │
   ▼ (for production with real API)
```

---

## Component Architecture

### 1. Frontend Layer (Next.js + React)

**Components:**
- `Dashboard` - Main container & tab router
- `Navbar` - Account summary & metrics
- `PortfolioChart` - Recharts visualization for P&L
- `PositionsPanel` - Open positions table
- `ScreeningPanel` - Opportunity cards by strategy
- `SettingsPanel` - Configuration & allocation controls

**State Management:** Zustand store
- Global state: account, positions, config, current mode
- Selectors for derived data

**API Client:** Axios wrapper
- `accountApi` - snapshots, history
- `configApi` - config CRUD, mode switching
- `screeningApi` - opportunity queries
- `tradingApi` - order placement/cancellation

### 2. Backend API (Flask)

**Entry point:** `api/app.py`

**Route Groups:**

| Group | Purpose | Endpoints |
|-------|---------|-----------|
| Account | Portfolio data | `/account`, `/positions`, `/portfolio-history` |
| Config | User settings | `/config/current`, `/config/presets`, `/config/update`, `/mode/set` |
| Screening | Market opportunities | `/screen/blowup-stocks`, `/screen/covered-calls`, `/screen/forex` |
| Trading | Order execution | `/trade/place-order`, `/trade/cancel-order` |
| Status | System health | `/status/broker`, `/status/health` |

### 3. Strategy Components

#### ConfigManager
- Loads/saves `user_config.json`
- Provides preset configurations for 6 modes
- Validates allocations sum to 100%

**Modes:**
- Balanced: 33/33/34%
- Aggressive: 50/30/20%
- Conservative: 20/50/30%
- Options Focused: 10/80/10%
- Forex Focused: 20/20/60%
- Custom: User-defined

#### Screeners

**FundamentalScreener:**
```
Input: List of tickers
Process:
  - Fetch OHLCV data (yfinance)
  - Calculate relative volume (current / 20-day avg)
  - Get P/E, forward P/E, market cap
  - Score each stock (0-100 based on filters)
Output: Ranked list of candidates
```

**OptionScreener:**
```
Input: Major indices [SPY, QQQ, IWM, UVXY]
Process:
  - Get option chains from broker
  - Find 0DTE (same-day) expirations
  - Calculate premium estimates
  - Filter OTM calls with target delta
Output: Ranked opportunities by premium%
```

**ForexScreener:**
```
Input: Pairs [EURUSD, GBPUSD, USDJPY]
Process:
  - Fetch pair prices
  - Apply momentum signals
  - Score each pair
Output: Buy/sell/neutral signals
```

#### Bots

**BlowupStockBot:**
```
Workflow:
1. Run screener → get candidates
2. For each candidate:
   a. Evaluate entry criteria (score, rel_vol)
   b. If passes: place buy order
3. Manage positions:
   a. Take profit at 10% gain
   b. Stop loss at 5% loss
```

**CoveredCallBot:**
```
Workflow:
1. Run screener → get opportunities
2. For each opportunity:
   a. Evaluate premium (min 0.5% of stock price)
   b. If passes: place sell call order
3. Manage calls:
   a. Wait for expiry or exit signal
   b. Close position if ITM threshold reached
```

**ForexBot:**
```
Workflow:
1. Run screener → get signals
2. For each signal:
   a. Size position (% of allocation)
   b. Place order with TP/SL
3. Manage trades:
   a. Monitor from entry
   b. Close on TP/SL hit
```

### 4. Broker Integration

**BaseBroker** (abstract):
```python
class BaseBroker(ABC):
    async def connect()
    async def get_account_snapshot()
    async def get_positions()
    async def place_order()
    async def get_option_chain()
    async def get_fundamental_data()
    ...
```

**IBKRBroker** (implementation):
- Uses `ib_insync` library
- Connects to IB Gateway (port 7497 = paper)
- Implements all abstract methods
- Handles contract qualification, market data, orders

**BrokerFactory**:
```python
broker = BrokerFactory.create_broker("ibkr", host="127.0.0.1", port=7497)
```

Extensible to:
- `AlpacaBroker`
- `InteractiveBrokersBroker` (alternative)
- `CustomBroker`

### 5. Mock Data (Demo Mode)

**MockPortfolioGenerator:**
- Generates realistic account snapshots
- Creates plausible position data
- Generates daily P&L history with realistic volatility
- Produces screening candidates with varied scores
- Zero dependencies on broker connection

**Used when:**
- Broker unavailable
- Demo/presentation mode
- Testing frontend without API

---

## Data Flow Examples

### User Opens Dashboard
```
1. Frontend: GETAccount → API
2. API: Call broker.get_account_snapshot()
3. Broker: Connect to IB Gateway, fetch account data
4. API: Return JSON response
5. Frontend: Render in Navbar + Dashboard
6. Store: Save to Zustand (setAccount)
```

### User Changes Trading Mode
```
1. UI: Click "Aggressive" preset
2. Frontend: POST /mode/set {mode: "aggressive"}
3. API: Load aggressive preset config from ConfigManager
4. ConfigManager: Save to user_config.json
5. API: Return updated config
6. Frontend: Update store (setCurrentMode, setConfig)
7. UI: Refresh with new allocation percentages
```

### User Customizes Allocation
```
1. UI: Drag slider → 40% stocks, 35% calls, 25% forex
2. React: Update component state
3. User: Click "Save Custom Allocation"
4. Frontend: POST /config/update {allocation: {...}}
5. API: ConfigManager.save_user_config()
6. API: Return success
7. Frontend: Update store
8. Future scans: Use new allocation
```

### Bot Scans for Opportunities
```
1. API: GET /screen/blowup-stocks
2. API: Instantiate FundamentalScreener
3. Screener: For each ticker in SCREENING_UNIVERSE:
   a. Fetch yfinance data
   b. Calculate metrics
   c. Score & filter
4. Return top 10 sorted by score
5. Frontend: Display in cards with recommendations
```

### User Places Trade
```
1. UI: Click "Buy" on opportunity
2. Frontend: POST /trade/place-order {symbol, side, quantity}
3. API: Calculate position size from allocation
4. API: broker.place_order()
5. Broker: Connect to IB Gateway, submit order
6. Broker: Return order confirmation
7. API: Return order details to frontend
8. Frontend: Show success message
```

---

## Design Patterns

### Factory Pattern (Brokers)
```python
# Register implementations
BrokerFactory.register_broker("ibkr", IBKRBroker)
BrokerFactory.register_broker("alpaca", AlpacaBroker)

# Use polymorphically
broker = BrokerFactory.create_broker("ibkr")
# Works with any broker implementation
```

### Singleton Pattern (Config)
```python
config_manager = ConfigManager()  # Single instance
config_manager.load_user_config()
config_manager.save_user_config()
```

### Observer Pattern (React/Zustand)
```typescript
// Subscribe to state changes
const account = useTradingStore((state) => state.account);
// Components re-render on account change
```

### Strategy Pattern (Trading Bots)
```python
class BlowupStockBot:
    async def run_scan() -> List[Candidate]

class CoveredCallBot:
    async def run_scan() -> List[Opportunity]

class ForexBot:
    async def run_scan() -> List[Signal]

# Interchangeable strategies
```

---

## Performance Considerations

### Frontend
- **Lazy load**: Tabs render only when active
- **Memoization**: Charts memoized to prevent re-render
- **Zustand**: Selectors prevent unnecessary renders
- **Next.js**: Image optimization, code splitting

### Backend
- **Caching**: Screener results cached 5 minutes
- **Async**: Non-blocking I/O for API calls
- **Batch requests**: Fetch multiple data sources in parallel
- **Mock data**: Instant response in demo mode

### Broker Communication
- **Connection pooling**: Reuse IBKR connection
- **Market data snapshot**: Only fetch when needed
- **Throttling**: Avoid API rate limits

---

## Extensibility Points

1. **Add new screener:**
   - Implement screener class
   - Add route in API
   - Add UI panel in frontend

2. **Add new broker:**
   - Inherit BaseBroker
   - Implement 10 methods
   - Register with BrokerFactory

3. **Add new trading bot:**
   - Create bot strategy class
   - Implement scan() & manage() methods
   - Add route & endpoint

4. **Add new UI features:**
   - Create React component
   - Add API endpoint if needed
   - Wire into Dashboard or Settings

---

## Testing Strategy

```python
# Backend unit tests
def test_fundamental_screener_filters():
    screener = FundamentalScreener()
    result = screener.evaluate_stock("AAPL")
    assert result["passed_filters"] == True
    assert result["score"] > 0

# Frontend component tests
test("Dashboard renders tabs", () => {
  render(<Dashboard />);
  expect(screen.getByRole("button", {name: /Overview/i})).toBeInTheDocument();
});
```

---

## Deployment Architecture

```
┌─────────────────────────────────────────────┐
│          Vercel (Frontend)                  │
│  - CDN for static assets                    │
│  - Automatic deployments on git push        │
│  - Analytics & monitoring                   │
│  - Custom domain setup                      │
└─────────────────┬───────────────────────────┘
                  │
              HTTPS/API
                  │
┌─────────────────▼───────────────────────────┐
│    Railway/Heroku/GCP (Backend)             │
│  - Auto-scaling based on load               │
│  - PostgreSQL optional (for data)           │
│  - Environment variables injected           │
│  - Log aggregation                          │
└─────────────────┬───────────────────────────┘
                  │
                  │
    ┌─────────────┴─────────────┐
    │                           │
┌───▼────────────┐    ┌─────────▼──────┐
│  IBKR Gateway  │    │  Mock Data     │
│  (paper trade) │    │  (fallback)    │
└────────────────┘    └────────────────┘
```

