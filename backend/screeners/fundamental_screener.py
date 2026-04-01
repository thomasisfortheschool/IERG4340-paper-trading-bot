"""
Fundamental screener for identifying potential high-growth stocks.
Uses relative volume, P/E ratio, analyst activity, etc.
"""
import logging
from typing import List, Dict, Any
import asyncio
import yfinance as yf
import pandas as pd
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


class FundamentalScreener:
    """Screen stocks based on fundamental metrics."""
    
    # Sample list of stocks to screen (S&P 500 subset)
    SCREENING_UNIVERSE = [
        "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "TSLA", "META", "AVGO", "COST", "ASML",
        "NFLX", "ADBE", "CSCO", "INTC", "CRM", "AMD", "QCOM", "INTU", "SNPS", "CDNS",
        "MSTR", "PLTR", "MRVL", "SYNOPSYS", "SQ", "RBLX", "DDOG", "ZS", "TTD", "WDAY",
        "CRWD", "PSTG", "OKTA", "NET", "FTNT", "PANW", "MNST", "LLY", "SMCI", "BKNG",
    ]
    
    def __init__(self, config: Dict[str, Any] = None):
        self.config = config or self._default_config()
    
    @staticmethod
    def _default_config() -> Dict[str, Any]:
        return {
            "relative_volume_threshold": 2.0,
            "pe_ratio_max": 30.0,
            "forward_pe_ratio_max": 25.0,
            "price_min": 5.0,
            "price_max": 500.0,
            "market_cap_min_millions": 100.0,
            "earnings_surprise_min_pct": 5.0,
            "analyst_upgrade_days": 30,
        }
    
    async def screen(self, symbols: List[str] = None) -> List[Dict[str, Any]]:
        """Screen stocks and return candidates."""
        if symbols is None:
            symbols = self.SCREENING_UNIVERSE
        
        candidates = []
        for symbol in symbols:
            try:
                result = await self.evaluate_stock(symbol)
                if result and result.get("passed_filters"):
                    candidates.append(result)
            except Exception as e:
                logger.error(f"Error screening {symbol}: {e}")
        
        # Sort by score (higher is better)
        candidates.sort(key=lambda x: x.get("score", 0), reverse=True)
        return candidates[:10]  # Top 10 candidates
    
    async def evaluate_stock(self, symbol: str) -> Dict[str, Any]:
        """Evaluate a single stock against criteria."""
        try:
            # Fetch data
            ticker = yf.Ticker(symbol)
            hist = ticker.history(period="1y")
            info = ticker.info
            
            if hist.empty:
                return None
            
            # Calculate metrics
            current_price = hist["Close"].iloc[-1]
            price_20d_avg = hist["Close"][-20:].mean()
            volume_20d_avg = hist["Volume"][-20:].mean()
            current_volume = hist["Volume"].iloc[-1]
            relative_volume = current_volume / volume_20d_avg if volume_20d_avg > 0 else 0
            
            pe_ratio = info.get("trailingPE", float("inf"))
            forward_pe = info.get("forwardPE", float("inf"))
            market_cap = info.get("marketCap", 0) / 1e6 if info.get("marketCap") else 0
            
            # Filter checks
            filters_passed = (
                relative_volume >= self.config["relative_volume_threshold"] and
                (pe_ratio is None or pe_ratio <= self.config["pe_ratio_max"]) and
                (forward_pe is None or forward_pe <= self.config["forward_pe_ratio_max"]) and
                current_price >= self.config["price_min"] and
                current_price <= self.config["price_max"] and
                market_cap >= self.config["market_cap_min_millions"]
            )
            
            # Calculate composite score
            score = 0
            if filters_passed:
                # Relative volume score (0-30)
                rel_vol_score = min((relative_volume / self.config["relative_volume_threshold"]) * 30, 30)
                
                # Valuation score (0-30)
                val_score = 30 * max(0, (self.config["pe_ratio_max"] - (pe_ratio or 0)) / self.config["pe_ratio_max"])
                
                # Price momentum score (0-20)
                mom_score = 20 if current_price > price_20d_avg else 10
                
                # Analyst activity score (0-20)
                analyst_score = min((info.get("numberOfAnalystRatings", 0) / 30) * 20, 20)
                
                score = rel_vol_score + val_score + mom_score + analyst_score
            
            return {
                "symbol": symbol,
                "price": round(current_price, 2),
                "pe_ratio": round(pe_ratio, 2) if pe_ratio != float("inf") else None,
                "forward_pe": round(forward_pe, 2) if forward_pe != float("inf") else None,
                "market_cap_millions": round(market_cap, 0),
                "relative_volume": round(relative_volume, 2),
                "volume_avg_20d": int(volume_20d_avg),
                "current_volume": int(current_volume),
                "analyst_ratings": info.get("numberOfAnalystRatings", 0),
                "passed_filters": filters_passed,
                "score": round(score, 2),
                "reason": self._build_reason(relative_volume, pe_ratio, forward_pe, market_cap),
            }
        except Exception as e:
            logger.debug(f"Error evaluating {symbol}: {e}")
            return None
    
    def _build_reason(self, rel_vol: float, pe: float, fwd_pe: float, market_cap: float) -> str:
        """Build human-readable explanation for candidate."""
        reasons = []
        
        if rel_vol >= self.config["relative_volume_threshold"]:
            reasons.append(f"High relative volume ({rel_vol:.1f}x)")
        
        if pe is not None and pe <= self.config["pe_ratio_max"]:
            reasons.append(f"Reasonable valuation (P/E: {pe:.1f})")
        
        if fwd_pe is not None and fwd_pe <= self.config["forward_pe_ratio_max"]:
            reasons.append(f"Fair forward outlook (FWD P/E: {fwd_pe:.1f})")
        
        return " | ".join(reasons) if reasons else "Meets screening criteria"
