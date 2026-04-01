# IERG4340 Paper Trading System - Quick Start Guide

## 5-Minute Setup (Demo Mode)

### No broker connection needed! Uses realistic mock data.

### 1. Start Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
python api/app.py
```
✅ API running at `http://localhost:5000/api`

### 2. Start Frontend
```bash
# In new terminal
cd frontend
npm install
echo "NEXT_PUBLIC_API_URL=http://localhost:5000/api" > .env.local
npm run dev
```
✅ Dashboard at `http://localhost:3000`

### 3. Explore Dashboard

- **📊 Overview** → Daily P&L charts (mock data)
- **💼 Positions** → Sample open positions
- **🔍 Opportunities** → Screening results:
  - High-growth stocks (MSTR, PLTR, etc.)
  - 0DTE covered calls on SPY, QQQ, IWM
  - Forex signals
- **⚙️ Settings** → Adjust allocation, filters, trading mode

---

## Connect to Real Broker (IBKR)

### Prerequisites
- IB Gateway or TWS running on your machine
- Paper trading account with IBKR
- Port 7497 open (paper trading)

### Steps

1. **Verify IB Gateway:**
   - Launch IB Gateway
   - Account → Paper Trading Account
   - Check "Enable API"
   - Socket Port should be 7497

2. **Update Backend Config:**
   ```bash
   cd backend
   # Edit .env or set environment variables
   export IB_HOST=127.0.0.1
   export IB_PORT=7497
   export IB_CLIENT_ID=100
   ```

3. **Restart API:**
   ```bash
   python api/app.py
   ```

4. **Check Connection:**
   - Frontend → Settings → API Configuration shows "IBKR"
   - Account data reflects your real IBKR account

---

## Configuration Quick Start

### Trading Mode Presets

| Mode | Allocation | Best For |
|------|-----------|----------|
| **Balanced** | 33/33/34% | All-around diversification |
| **Aggressive** | 50% stocks, 30% calls, 20% forex | Growth-focused |
| **Conservative** | 20% stocks, 50% calls, 30% forex | Income-focused |
| **Options Focused** | 10% stocks, 80% calls, 10% forex | Premium collection |
| **Forex Focused** | 20% stocks, 20% calls, 60% forex | Currency trading |
| **Custom** | User-defined | Your own mix |

### Adjust Screening Filters

**Settings Tab** → Customize:
- Minimum Relative Volume (default: 2.0x)
- Maximum P/E Ratio (default: 30)
- Covered Call Premium % (default: 0.5%)
- Option Delta (default: 0.25)

---

## Deployment Options

### Vercel (Frontend) - 2 minutes
```bash
# Push frontend to GitHub
# Connect to vercel.com
# Set NEXT_PUBLIC_API_URL environment variable
# Done! Auto-deploys on every push
```

### Railway (Backend) - 3 minutes
```bash
# Push to GitHub
# vercel.app → New Project
# Select your repo
# Set IB_HOST, IB_PORT env vars
# Deploy
```

See [DEPLOYMENT.md](docs/DEPLOYMENT.md) for detailed guide.

---

## Common Questions

**Q: Do I need IBKR to use this?**  
A: No! Built-in mock data works instantly. IBKR is optional for real data demo.

**Q: Can I use a different broker?**  
A: Yes! Backend is broker-agnostic. Edit `brokers/` folder to add Alpaca, etc.

**Q: How does it decide what to trade?**  
A: Three independent screeners:
- **Blowup Stocks**: Relative volume + P/E
- **Covered Calls**: Premium % + delta
- **Forex**: Momentum signals

**Q: Is the P&L real?**  
A: With IBKR: Yes, from your paper account. With mock: Simulated.

**Q: Can I place real trades?**  
A: Only if you configure real IBKR account (not recommended for demo).

---

## Troubleshooting

### API won't start
```bash
# Port in use?
lsof -i :5000  # Mac/Linux
netstat -ano | findstr :5000  # Windows

# Missing dependencies?
pip install -r requirements.txt
```

### Dashboard shows "No data"
```bash
# Check API is running
curl http://localhost:5000/api/status/health

# Check CORS - should see Origin error in console if issue
```

### IBKR connection fails
```bash
# Verify Gateway running:
# Settings → API → check "Enable Applications"

# Test connection:
curl http://localhost:5000/api/status/broker
# Should return {"connected": true}
```

---

## Next Steps

1. **Understand the strategies** - Read [ARCHITECTURE.md](docs/ARCHITECTURE.md)
2. **Customize parameters** - Adjust filters in Settings
3. **Switch trading mode** - Test different allocations
4. **Review screening results** - Check opportunities for each strategy
5. **Deploy to Vercel** - Share dashboard with professor
6. **Connect to IBKR** - Go live with paper account

---

## Resources

- 📖 [Full Documentation](README.md)
- 🔌 [API Reference](docs/API.md)
- 🏗️ [Architecture Details](docs/ARCHITECTURE.md)
- 🚀 [Deployment Guide](docs/DEPLOYMENT.md)
- ⚙️ [Configuration Options](docs/CONFIG.md)

---

## Ready to demo? 🎉

**To impress your professor:**
1. Show live dashboard with mock data
2. Demonstrate strategy allocation switching
3. Explain screener logic & filtering
4. Deploy to Vercel (live URL)
5. Discuss extensibility & API design

Good luck! 🚀

