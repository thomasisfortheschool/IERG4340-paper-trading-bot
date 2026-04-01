# API Reference - IERG4340 Trading System

## Base URL
```
http://localhost:5000/api
```

## Authentication
Currently no authentication (local development). Add in production.

---

## Account & Portfolio Endpoints

### Get Account Snapshot
**GET** `/account`

Returns current account status (value, cash, buying power, P&L).

**Response:**
```json
{
  "total_value": 102500.00,
  "cash": 50000.00,
  "buying_power": 100000.00,
  "total_pnl": 2500.00,
  "total_pnl_pct": 2.5,
  "daily_pnl": 150.00,
  "daily_pnl_pct": 0.15
}
```

### Get Open Positions
**GET** `/positions`

List all active positions.

**Response:**
```json
{
  "positions": [
    {
      "symbol": "NVDA",
      "quantity": 50,
      "avg_price": 850.00,
      "current_price": 875.50,
      "pnl": 1275.00,
      "pnl_pct": 3.01,
      "asset_type": "stock"
    }
  ]
}
```

### Get Portfolio History
**GET** `/portfolio-history?days=30`

Historical daily P&L for charting.

**Query Parameters:**
- `days` (int, default=30): Number of days to return

**Response:**
```json
{
  "history": [
    {
      "date": "2024-01-01",
      "daily_pnl": 250.00,
      "cumulative_pnl": 1000.00,
      "daily_pnl_pct": 0.25
    }
  ]
}
```

---

## Configuration Endpoints

### Get Current Configuration
**GET** `/config/current`

Fetch active user configuration.

**Response:**
```json
{
  "mode": "balanced",
  "allocation": {
    "blowup_stocks_pct": 33.33,
    "covered_calls_pct": 33.33,
    "forex_pct": 33.34
  },
  "fundamental_screener": {
    "relative_volume_threshold": 2.0,
    "pe_ratio_max": 30.0,
    "forward_pe_ratio_max": 25.0,
    "price_min": 5.0,
    "price_max": 500.0
  },
  "option_screener": {
    "symbols": ["SPY", "QQQ", "IWM", "UVXY"],
    "min_premium_pct": 0.5,
    "target_delta": 0.25
  }
}
```

### Get Configuration Presets
**GET** `/config/presets`

Available trading mode presets.

**Response:**
```json
{
  "presets": {
    "balanced": { ... },
    "aggressive": { ... },
    "conservative": { ... },
    "options_focused": { ... },
    "forex_focused": { ... }
  }
}
```

### Update Configuration
**POST** `/config/update`

Save custom configuration.

**Request Body:**
```json
{
  "mode": "custom",
  "allocation": {
    "blowup_stocks_pct": 40.0,
    "covered_calls_pct": 35.0,
    "forex_pct": 25.0
  }
}
```

**Response:**
```json
{
  "status": "success",
  "config": { ... }
}
```

### Set Trading Mode
**POST** `/mode/set`

Switch to preset trading mode.

**Request Body:**
```json
{
  "mode": "aggressive"
}
```

---

## Screening Endpoints

### Screen Blowup Stocks
**GET** `/screen/blowup-stocks`

Find high-growth stock opportunities.

**Response:**
```json
{
  "candidates": [
    {
      "symbol": "MSTR",
      "price": 425.50,
      "pe_ratio": 45.2,
      "forward_pe": 38.5,
      "market_cap_millions": 52000,
      "relative_volume": 3.2,
      "analyst_ratings": 12,
      "score": 78.5,
      "reason": "High relative volume (3.2x) | Reasonable valuation"
    }
  ]
}
```

### Screen Covered Calls
**GET** `/screen/covered-calls`

Find 0DTE covered call opportunities on indices.

**Response:**
```json
{
  "opportunities": [
    {
      "symbol": "SPY",
      "stock_price": 452.75,
      "call_strike": 455.00,
      "call_premium": 1.25,
      "premium_pct": 0.28,
      "delta": 0.25,
      "expiry": "20240101",
      "dte": 0,
      "score": 2.8
    }
  ]
}
```

### Screen Forex
**GET** `/screen/forex`

Forex trading signals.

**Response:**
```json
{
  "opportunities": [
    {
      "symbol": "EURUSD",
      "price": 1.0945,
      "signal": "buy",
      "score": 68,
      "reason": "EURUSD showing buy signal"
    }
  ]
}
```

---

## Trading Endpoints

### Place Order
**POST** `/trade/place-order`

Execute a new trade.

**Request Body:**
```json
{
  "symbol": "AAPL",
  "side": "buy",
  "quantity": 10,
  "order_type": "market"
}
```

**Response:**
```json
{
  "status": "success",
  "order_id": "DEMO-12345",
  "symbol": "AAPL",
  "side": "buy",
  "quantity": 10
}
```

### Cancel Order
**POST** `/trade/cancel-order/{orderId}`

Cancel an open order.

**Response:**
```json
{
  "status": "success",
  "order_id": "DEMO-12345",
  "action": "cancelled"
}
```

---

## Health & Status

### Health Check
**GET** `/status/health`

System status.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T12:00:00Z"
}
```

### Broker Status
**GET** `/status/broker`

Broker connection status.

**Response:**
```json
{
  "connected": true,
  "broker": "IBKR",
  "account_type": "paper"
}
```

---

## Error Responses

All endpoints return appropriate HTTP status codes:

- `200` - Success
- `400` - Bad request (validation error)
- `404` - Not found
- `500` - Server error

**Error Response Format:**
```json
{
  "error": "Description of error"
}
```

---

## Rate Limiting

No rate limiting in development. Add in production (suggested: 100 requests/minute per IP).

## CORS

Allow CORS from frontend domain:
```python
CORS(app, origins=['http://localhost:3000', 'https://yourdomain.vercel.app'])
```

