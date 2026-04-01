# IERG4340 Paper Trading System

A comprehensive, multi-strategy paper trading bot with interactive web dashboard for demonstrating quantitative trading concepts.

## 🎯 Features

### Trading Strategies
- **Blowup Stock Bot**: Identifies high-growth stocks using relative volume, P/E ratios, and analyst sentiment
- **Covered Call Bot**: Sells 0DTE (same-day) covered calls on major indices (SPY, QQQ, IWM) for premium collection
- **Forex Bot**: Trades major forex pairs (EUR/USD, GBP/USD, USD/JPY) with momentum-based signals

### Dashboard Capabilities
- Real-time portfolio monitoring with daily P&L
- Strategy allocation control (customizable percentages for each strategy)
- Market screening results with opportunity scores
- Configurable filters for each strategy
- Multi-mode presets (Balanced, Aggressive, Conservative, etc.)
- User-friendly, Vercel-ready web interface

### API-Agnostic Design
- Primary: Interactive Brokers (IBKR) paper trading API
- Extensible to Alpaca, other brokers
- Abstract broker interface for easy integration

## 📋 Project Structure

```
IERG4340-paper-trading-bot/
├── backend/                    # Python Flask API server
│   ├── api/                   # REST API endpoints
│   ├── brokers/               # Broker integrations (abstract + IBKR)
│   ├── bots/                  # Trading strategy bot implementations
│   ├── screeners/             # Market opportunity screeners
│   ├── data/                  # Data generation & mock data
│   ├── config.py              # Strategy configuration
│   └── requirements.txt        # Python dependencies
├── frontend/                  # Next.js web dashboard
│   ├── src/
│   │   ├── app/              # Next.js pages
│   │   ├── components/       # React components
│   │   ├── lib/             # API client utilities
│   │   └── globals.css      # Styling
│   ├── package.json
│   └── tsconfig.json
├── docs/                     # Documentation
│   ├── API.md               # API endpoint reference
│   ├── DEPLOYMENT.md        # Vercel deployment guide
│   └── ARCHITECTURE.md      # System design
└── README.md
```

## 🚀 Quick Start

### Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Start API server
python api/app.py
```

The API will be available at `http://localhost:5000/api`

### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Create environment file
echo "NEXT_PUBLIC_API_URL=http://localhost:5000/api" > .env.local

# Start development server
npm run dev
```

Dashboard will be at `http://localhost:3000`

## 🔌 Configuration

### Environment Variables

**Backend (.env)**
```
IB_HOST=127.0.0.1
IB_PORT=7497              # Paper trading port
IB_CLIENT_ID=100
AUTO_BUY_SHARES=false     # Don't auto-buy to round positions
```

**Frontend (.env.local)**
```
NEXT_PUBLIC_API_URL=http://localhost:5000/api
```

### Strategy Configuration

Edit `data/user_config.json` to customize:
- Strategy allocation percentages
- Screener thresholds (relative volume, P/E, etc.)
- Covered call parameters (delta, premium %, DTE)
- Forex pair selection and leverage

Example:
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

## 📊 API Endpoints

### Account & Portfolio
- `GET /api/account` - Account snapshot (value, P&L, cash)
- `GET /api/positions` - List open positions
- `GET /api/portfolio-history?days=30` - Daily P&L history

### Configuration
- `GET /api/config/current` - Current user configuration
- `GET /api/config/presets` - Available strategy presets
- `POST /api/config/update` - Save custom configuration
- `POST /api/mode/set` - Switch trading mode

### Screening
- `GET /api/screen/blowup-stocks` - High-growth stock candidates
- `GET /api/screen/covered-calls` - 0DTE covered call opportunities
- `GET /api/screen/forex` - Forex trading signals

### Trading
- `POST /api/trade/place-order` - Place new order
- `POST /api/trade/cancel-order/{orderId}` - Cancel order

## 🧪 Demo Mode

The system includes **realistic mock data** so you can demo immediately without IBKR setup:
1. Starts with mock portfolio data
2. Generates realistic screening results
3. Simulates daily P&L

Perfect for professor demonstrations!

## 📱 Deployment to Vercel

### Prerequisites
- Vercel account
- GitHub repository

### Steps

```bash
# Push frontend to GitHub
cd frontend
git init
git add .
git commit -m "Initial commit"
git push origin main

# In Vercel dashboard:
# 1. Import project from GitHub
# 2. Set Environment Variables:
#    NEXT_PUBLIC_API_URL = https://your-api-server.com/api
# 3. Deploy
```

### Backend Deployment
For production, deploy the backend separately:
- **Railway**: `pip install flask gunicorn && gunicorn api.app:app`
- **Heroku**: Add Procfile with gunicorn command
- **AWS/GCP**: Containerize with Docker

See [DEPLOYMENT.md](docs/DEPLOYMENT.md) for details.

## 🏗️ Architecture

### Backend Flow
1. **Config Manager** → Loads user preferences and strategy allocation
2. **Broker Interface** → Abstracts API-specific details (IBKR, Alpaca, etc.)
3. **Screeners** → Generate trading opportunities using fundamental & technical analysis
4. **Bots** → Execute trading logic based on signals
5. **API Server** → Exposes REST endpoints for frontend

### Frontend Flow
1. **Dashboard** → Main view with tab navigation
2. **Charts** → Recharts for portfolio visualization
3. **Panels** → Positions, screening results, settings
4. **API Client** → Communicates with backend via axios
5. **Store** → Zustand for state management

## 🎓 Educational Value

This system demonstrates:
- **Quantitative Finance**: Fundamental analysis, options Greeks, risk management
- **Systems Design**: Broker integration, API design, state management
- **Full-Stack Development**: Python backend, React/Next.js frontend
- **Deployment**: Vercel, cloud deployment strategies
- **Software Patterns**: Factory pattern (brokers), MVC (React), configuration management

## 📚 Documentation

- [API Reference](docs/API.md) - Detailed endpoint documentation
- [Architecture](docs/ARCHITECTURE.md) - System design & patterns
- [Deployment Guide](docs/DEPLOYMENT.md) - Production deployment steps
- [Configuration Guide](docs/CONFIG.md) - All customization options

## 🔐 Security Notes

- Uses **paper trading APIs** only (no real money)
- IBKR credentials should be in `.env` (never commit!)
- API runs on localhost by default
- Before production deployment, add authentication & HTTPS

## 🤝 Contributing

Feel free to extend this system with:
- Additional screening criteria
- New trading strategies
- Support for more brokers
- Advanced charting features
- Machine learning models

## 📝 License

Educational use. Please cite IERG4340 course.

## 🆘 Troubleshooting

**API won't start**
- Verify Python 3.8+ installed
- Check Flask installed: `pip list | grep flask`
- Port 5000 not in use: `lsof -i :5000`

**Dashboard shows no data**
- Check API is running: `curl http://localhost:5000/api/status/health`
- Verify `NEXT_PUBLIC_API_URL` in `.env.local`
- Check browser console for errors

**IBKR connection fails**
- Ensure IB Gateway/TWS running on port 7497 (paper)
- Check `IB_HOST` and `IB_PORT` in backend config
- System falls back to mock data if broker unavailable

---

Built for IERG4340 - Algorithmic Trading Systems
