"""
Mock data generator for development and demo purposes.
Generates realistic portfolio data without requiring actual broker connection.
"""
from datetime import datetime, timedelta
import random
from typing import List, Dict, Any


class MockPortfolioGenerator:
    """Generate realistic mock portfolio and market data."""
    
    def __init__(self, initial_capital: float = 100000.0):
        self.initial_capital = initial_capital
        self.current_value = initial_capital
        self.base_pnl = 0.0
    
    def generate_account_snapshot(self) -> Dict[str, Any]:
        """Generate mock account snapshot."""
        now = datetime.now()
        
        # Simulate some P&L
        daily_change = random.uniform(-0.02, 0.03)  # -2% to +3% daily
        daily_pnl = self.initial_capital * daily_change
        total_pnl = random.uniform(-2500, 5000)  # Cumulative
        
        return {
            "total_value": round(self.initial_capital + total_pnl, 2),
            "cash": round(self.initial_capital * 0.4 + random.uniform(-5000, 5000), 2),
            "buying_power": round(self.initial_capital * 0.8, 2),
            "total_pnl": round(total_pnl, 2),
            "total_pnl_pct": round((total_pnl / self.initial_capital) * 100, 2),
            "daily_pnl": round(daily_pnl, 2),
            "daily_pnl_pct": round(daily_change * 100, 2),
            "timestamp": now.isoformat(),
        }
    
    def generate_positions(self) -> List[Dict[str, Any]]:
        """Generate mock open positions."""
        positions = [
            {
                "symbol": "NVDA",
                "quantity": 50,
                "avg_price": 850.00,
                "current_price": 875.50,
                "pnl": 1275.00,
                "pnl_pct": 3.01,
                "asset_type": "stock",
                "entry_date": (datetime.now() - timedelta(days=5)).isoformat(),
            },
            {
                "symbol": "SPY",
                "quantity": 100,
                "avg_price": 450.00,
                "current_price": 452.75,
                "pnl": 275.00,
                "pnl_pct": 0.61,
                "asset_type": "stock",
                "entry_date": (datetime.now() - timedelta(days=10)).isoformat(),
            },
            {
                "symbol": "QQQ",
                "quantity": 30,
                "avg_price": 380.00,
                "current_price": 385.20,
                "pnl": 156.00,
                "pnl_pct": 1.37,
                "asset_type": "stock",
                "entry_date": (datetime.now() - timedelta(days=3)).isoformat(),
            },
        ]
        return positions
    
    def generate_daily_pnl_history(self, days: int = 30) -> List[Dict[str, Any]]:
        """Generate daily P&L history."""
        history = []
        cumulative_pnl = -500.0  # Start slightly negative
        
        for i in range(days, 0, -1):
            date = (datetime.now() - timedelta(days=i)).date()
            daily_change = random.uniform(-1500, 2000)
            cumulative_pnl += daily_change
            
            history.append({
                "date": str(date),
                "daily_pnl": round(daily_change, 2),
                "cumulative_pnl": round(cumulative_pnl, 2),
                "daily_pnl_pct": round((daily_change / self.initial_capital) * 100, 2),
            })
        
        return history
    
    def generate_blowup_stock_candidates(self) -> List[Dict[str, Any]]:
        """Generate mock blowup stock screening results."""
        candidates = [
            {
                "symbol": "MSTR",
                "price": 425.50,
                "pe_ratio": 45.2,
                "forward_pe": 38.5,
                "market_cap_millions": 52000,
                "relative_volume": 3.2,
                "volume_avg_20d": 2850000,
                "current_volume": 9100000,
                "analyst_ratings": 12,
                "passed_filters": True,
                "score": 78.5,
                "reason": "High relative volume (3.2x) | Reasonable valuation (P/E: 45.2) | 12 analyst ratings",
            },
            {
                "symbol": "PLTR",
                "price": 28.75,
                "pe_ratio": 52.0,
                "forward_pe": 48.0,
                "market_cap_millions": 65000,
                "relative_volume": 2.8,
                "volume_avg_20d": 52300000,
                "current_volume": 145800000,
                "analyst_ratings": 18,
                "passed_filters": True,
                "score": 72.3,
                "reason": "High relative volume (2.8x) | 18 analyst ratings",
            },
            {
                "symbol": "SMCI",
                "price": 875.25,
                "pe_ratio": 28.5,
                "forward_pe": 22.0,
                "market_cap_millions": 15000,
                "relative_volume": 2.4,
                "volume_avg_20d": 895000,
                "current_volume": 2143000,
                "analyst_ratings": 8,
                "passed_filters": True,
                "score": 65.8,
                "reason": "High relative volume (2.4x) | Fair forward outlook (FWD P/E: 22.0)",
            },
            {
                "symbol": "CRM",
                "price": 325.50,
                "pe_ratio": 180.0,
                "forward_pe": 65.0,
                "market_cap_millions": 325000,
                "relative_volume": 1.8,
                "volume_avg_20d": 2100000,
                "current_volume": 3780000,
                "analyst_ratings": 35,
                "passed_filters": False,
                "score": 45.2,
                "reason": "High valuation limits upside",
            },
        ]
        return candidates
    
    def generate_covered_call_opportunities(self) -> List[Dict[str, Any]]:
        """Generate mock covered call screening results."""
        opportunities = [
            {
                "symbol": "SPY",
                "stock_price": 452.75,
                "call_strike": 455.00,
                "call_premium": 1.25,
                "premium_pct": 0.28,
                "delta": 0.25,
                "expiry": datetime.now().strftime("%Y%m%d"),
                "dte": 0,
                "score": 2.8,
                "reason": "0DTE SPY call at $455 strike for $1.25 (0.28%)",
            },
            {
                "symbol": "QQQ",
                "stock_price": 385.20,
                "call_strike": 388.00,
                "call_premium": 1.75,
                "premium_pct": 0.45,
                "delta": 0.25,
                "expiry": datetime.now().strftime("%Y%m%d"),
                "dte": 0,
                "score": 4.5,
                "reason": "0DTE QQQ call at $388 strike for $1.75 (0.45%)",
            },
            {
                "symbol": "IWM",
                "stock_price": 195.50,
                "call_strike": 197.00,
                "call_premium": 0.85,
                "premium_pct": 0.44,
                "delta": 0.25,
                "expiry": datetime.now().strftime("%Y%m%d"),
                "dte": 0,
                "score": 4.4,
                "reason": "0DTE IWM call at $197 strike for $0.85 (0.44%)",
            },
        ]
        return opportunities
    
    def generate_forex_opportunities(self) -> List[Dict[str, Any]]:
        """Generate mock forex trading opportunities."""
        opportunities = [
            {
                "symbol": "EURUSD",
                "price": 1.0945,
                "signal": "buy",
                "score": 68,
                "reason": "EURUSD showing buy signal",
                "take_profit_pips": 30,
                "stop_loss_pips": 15,
            },
            {
                "symbol": "GBPUSD",
                "price": 1.2745,
                "signal": "neutral",
                "score": 42,
                "reason": "GBPUSD consolidating",
                "take_profit_pips": None,
                "stop_loss_pips": None,
            },
            {
                "symbol": "USDJPY",
                "price": 149.55,
                "signal": "sell",
                "score": 55,
                "reason": "USDJPY showing sell signal",
                "take_profit_pips": 25,
                "stop_loss_pips": 20,
            },
        ]
        return opportunities
