"""
Option screener for identifying covered call opportunities.
Focuses on 0DTE (same-day) expiries with favorable premiums.
"""
import logging
from typing import List, Dict, Any
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


class OptionScreener:
    """Screen for covered call opportunities on major indices."""
    
    DEFAULT_SYMBOLS = ["SPY", "QQQ", "IWM", "UVXY", "TQQQ", "SQQQ"]
    
    def __init__(self, config: Dict[str, Any] = None):
        self.config = config or self._default_config()
    
    @staticmethod
    def _default_config() -> Dict[str, Any]:
        return {
            "symbols": ["SPY", "QQQ", "IWM", "UVXY"],
            "target_delta": 0.25,
            "min_premium_pct": 0.5,  # Min 0.5% of stock price
            "dte_target": 0,  # 0DTE
            "max_holding_days": 1,
        }
    
    async def screen_for_opportunities(self, broker=None) -> List[Dict[str, Any]]:
        """Find covered call opportunities."""
        opportunities = []
        
        for symbol in self.config["symbols"]:
            try:
                opp = await self._analyze_symbol(symbol, broker)
                if opp and opp.get("score", 0) > 0:
                    opportunities.append(opp)
            except Exception as e:
                logger.error(f"Error analyzing {symbol}: {e}")
        
        # Sort by score
        opportunities.sort(key=lambda x: x.get("score", 0), reverse=True)
        return opportunities
    
    async def _analyze_symbol(self, symbol: str, broker=None) -> Dict[str, Any]:
        """Analyze a symbol for covered call opportunity."""
        try:
            # Get market data
            if broker:
                quote = await broker.get_quote(symbol)
                stock_price = quote.get("last", 0)
                option_chain = await broker.get_option_chain(symbol)
            else:
                # Mock data for demo
                quote = {"symbol": symbol, "last": self._get_mock_price(symbol)}
                stock_price = self._get_mock_price(symbol)
                option_chain = self._get_mock_option_chain(symbol)
            
            if not quote or not option_chain:
                return None
            
            # Find 0DTE call options
            expirations = option_chain.get("expirations", [])
            today_expiry = None
            
            for exp in expirations:
                exp_date = datetime.strptime(exp, "%Y%m%d").date()
                if exp_date == datetime.now().date():
                    today_expiry = exp
                    break
            
            if not today_expiry:
                return None  # No 0DTE expiry
            
            strikes = sorted(option_chain.get("strikes", []))
            
            # Find OTM calls with target delta
            opportunities = []
            target_delta = self.config["target_delta"]
            
            for strike in strikes:
                if strike > stock_price:  # OTM call
                    # Mock option premium calculation
                    premium = self._estimate_premium(stock_price, strike, target_delta)
                    premium_pct = (premium / stock_price) * 100
                    
                    if premium_pct >= self.config["min_premium_pct"]:
                        opportunities.append({
                            "strike": strike,
                            "premium": premium,
                            "premium_pct": premium_pct,
                            "delta": target_delta,
                        })
            
            if not opportunities:
                return None
            
            # Best opportunity (highest premium while staying OTM)
            best = max(opportunities, key=lambda x: x["premium_pct"])
            
            return {
                "symbol": symbol,
                "stock_price": round(stock_price, 2),
                "call_strike": round(best["strike"], 2),
                "call_premium": round(best["premium"], 3),
                "premium_pct": round(best["premium_pct"], 2),
                "delta": round(best["delta"], 2),
                "expiry": today_expiry,
                "dte": 0,
                "score": round(best["premium_pct"] * 10, 2),  # Score based on premium
                "reason": f"0DTE {symbol} call at ${best['strike']:.0f} strike for ${best['premium']:.2f} ({best['premium_pct']:.2f}%)",
            }
        except Exception as e:
            logger.debug(f"Error analyzing {symbol}: {e}")
            return None
    
    def _get_mock_price(self, symbol: str) -> float:
        """Get mock stock price for demo."""
        prices = {
            "SPY": 452.0,
            "QQQ": 385.0,
            "IWM": 195.0,
            "UVXY": 16.5,
            "TQQQ": 52.0,
            "SQQQ": 42.0,
        }
        return prices.get(symbol, 100.0)
    
    def _get_mock_option_chain(self, symbol: str) -> Dict[str, Any]:
        """Get mock option chain for demo."""
        today = datetime.now().strftime("%Y%m%d")
        base_price = self._get_mock_price(symbol)
        
        strikes = []
        for i in range(-10, 11):
            strikes.append(round(base_price + (i * (base_price * 0.02)), 2))
        
        return {
            "expirations": [today],
            "strikes": sorted(strikes),
        }
    
    def _estimate_premium(self, stock_price: float, strike: float, delta: float) -> float:
        """Simple premium estimation for demo."""
        # Very simplified premium calculation
        # In reality, use Black-Scholes or get from broker
        price_diff = strike - stock_price
        premium = (stock_price * 0.01) + (price_diff * 0.05)  # Mock formula
        return max(0.01, premium)
