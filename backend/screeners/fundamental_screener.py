"""
Fundamental screener for identifying potential high-growth stocks.
Uses relative volume, P/E ratio, analyst activity, etc.
"""
import logging
from typing import List, Dict, Any
import asyncio
import yfinance as yf

logger = logging.getLogger(__name__)


class FundamentalScreener:
    """Screen stocks based on fundamental metrics."""

    # Sample list of stocks to screen by market.
    US_SCREENING_UNIVERSE = [
        "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "TSLA", "META", "AVGO", "COST", "ASML",
        "NFLX", "ADBE", "CSCO", "INTC", "CRM", "AMD", "QCOM", "INTU", "SNPS", "CDNS",
        "MSTR", "PLTR", "MRVL", "SNPS", "SQ", "RBLX", "DDOG", "ZS", "TTD", "WDAY",
        "CRWD", "PSTG", "OKTA", "NET", "FTNT", "PANW", "MNST", "LLY", "SMCI", "BKNG",
    ]

    HK_SCREENING_UNIVERSE = [
        "0700.HK", "9988.HK", "3690.HK", "9618.HK", "1810.HK", "0005.HK", "0939.HK", "1299.HK",
        "2318.HK", "0388.HK", "9983.HK", "1211.HK", "2382.HK", "9999.HK", "1024.HK", "6862.HK",
    ]

    JP_SCREENING_UNIVERSE = [
        "7203.T", "6758.T", "9984.T", "8306.T", "9432.T", "7974.T", "8035.T", "6861.T",
        "4063.T", "6501.T", "6098.T", "4661.T", "4519.T", "6857.T", "6723.T", "9983.T",
    ]

    KR_SCREENING_UNIVERSE = [
        "005930.KS", "000660.KS", "035420.KS", "005380.KS", "035720.KS", "051910.KS", "006400.KS", "068270.KS",
        "207940.KS", "105560.KS", "012330.KS", "028260.KS", "096770.KS", "086790.KS", "034730.KS", "066570.KS",
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
            "top_n": 10,
            "max_workers": 8,
        }
    
    async def screen(self, symbols: List[str] = None) -> List[Dict[str, Any]]:
        """Screen stocks and return candidates."""
        if symbols is None:
            symbols = self.US_SCREENING_UNIVERSE

        max_workers = max(2, int(self.config.get("max_workers", 8)))
        semaphore = asyncio.Semaphore(max_workers)

        async def _safe_eval(sym: str):
            async with semaphore:
                try:
                    return await self.evaluate_stock(sym)
                except Exception as e:
                    logger.error(f"Error screening {sym}: {e}")
                    return None

        results = await asyncio.gather(*[_safe_eval(symbol) for symbol in symbols])
        candidates = [r for r in results if r and r.get("passed_filters")]
        
        # Sort by score (higher is better)
        candidates.sort(key=lambda x: x.get("score", 0), reverse=True)
        top_n = max(5, min(int(self.config.get("top_n", 10) or 10), 50))
        return candidates[:top_n]

    @classmethod
    def get_universe(cls, market: str) -> List[str]:
        market_key = str(market or "us").strip().lower()
        if market_key == "hk":
            return cls.HK_SCREENING_UNIVERSE
        if market_key == "jp":
            return cls.JP_SCREENING_UNIVERSE
        if market_key == "kr":
            return cls.KR_SCREENING_UNIVERSE
        return cls.US_SCREENING_UNIVERSE
    
    async def evaluate_stock(self, symbol: str) -> Dict[str, Any]:
        """Evaluate a single stock against criteria."""
        return await asyncio.to_thread(self._evaluate_stock_sync, symbol)

    @staticmethod
    def _estimate_dcf(detailed_info: Dict[str, Any], current_price: float) -> Dict[str, Any]:
        """Estimate a simple 5-year DCF fair value per share."""
        try:
            fcf_raw = detailed_info.get("freeCashflow")
            shares_raw = detailed_info.get("sharesOutstanding")
            rev_growth_raw = detailed_info.get("revenueGrowth")

            fcf = float(fcf_raw) if fcf_raw is not None else None
            shares = float(shares_raw) if shares_raw is not None else None
            revenue_growth = float(rev_growth_raw) if rev_growth_raw is not None else None

            if not fcf or not shares or fcf <= 0 or shares <= 0:
                return {"available": False}

            growth_rate = 0.08
            if revenue_growth is not None:
                growth_rate = max(0.02, min(0.18, revenue_growth))

            discount_rate = 0.10
            terminal_growth = 0.025

            pv_sum = 0.0
            running_fcf = fcf
            for year in range(1, 6):
                running_fcf *= (1.0 + growth_rate)
                pv_sum += running_fcf / ((1.0 + discount_rate) ** year)

            terminal_fcf = running_fcf * (1.0 + terminal_growth)
            terminal_value = terminal_fcf / max(1e-9, (discount_rate - terminal_growth))
            terminal_pv = terminal_value / ((1.0 + discount_rate) ** 5)

            fair_value = (pv_sum + terminal_pv) / shares
            if current_price <= 0:
                return {"available": False}

            upside_pct = ((fair_value / current_price) - 1.0) * 100.0
            return {
                "available": True,
                "fair_value": round(fair_value, 2),
                "upside_pct": round(upside_pct, 2),
            }
        except Exception:
            return {"available": False}

    def _evaluate_stock_sync(self, symbol: str) -> Dict[str, Any]:
        """Blocking stock evaluation logic run in thread workers."""
        try:
            # Fetch data
            ticker = yf.Ticker(symbol)
            hist = ticker.history(period="6mo")
            info = ticker.fast_info or {}
            detailed_info = ticker.info or {}

            if not hist.empty:
                hist = hist.dropna(subset=["Close", "Volume"]).copy()
            
            if hist.empty:
                return None
            
            # Calculate metrics
            current_price = hist["Close"].iloc[-1]
            price_20d_avg = hist["Close"][-20:].mean()
            volume_20d_avg = hist["Volume"][-20:].mean()
            current_volume = hist["Volume"].iloc[-1]
            relative_volume = current_volume / volume_20d_avg if volume_20d_avg > 0 else 0
            
            pe_ratio = detailed_info.get("trailingPE", float("inf"))
            forward_pe = detailed_info.get("forwardPE", float("inf"))
            market_cap_raw = detailed_info.get("marketCap") or info.get("marketCap")
            market_cap = market_cap_raw / 1e6 if market_cap_raw else 0
            dcf = self._estimate_dcf(detailed_info, float(current_price))
            
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
                analyst_count = detailed_info.get("numberOfAnalystRatings") or detailed_info.get("numberOfAnalystOpinions") or 0
                analyst_score = min((analyst_count / 30) * 20, 20)

                # DCF valuation gap adjustment.
                dcf_score = 0
                if dcf.get("available"):
                    upside = float(dcf.get("upside_pct") or 0)
                    if upside >= 25:
                        dcf_score = 10
                    elif upside >= 10:
                        dcf_score = 6
                    elif upside <= -20:
                        dcf_score = -10
                    elif upside <= -10:
                        dcf_score = -6
                
                score = rel_vol_score + val_score + mom_score + analyst_score + dcf_score
            
            return {
                "symbol": symbol,
                "price": round(current_price, 2),
                "pe_ratio": round(pe_ratio, 2) if pe_ratio != float("inf") else None,
                "forward_pe": round(forward_pe, 2) if forward_pe != float("inf") else None,
                "market_cap_millions": round(market_cap, 0),
                "relative_volume": round(relative_volume, 2),
                "volume_avg_20d": int(volume_20d_avg),
                "current_volume": int(current_volume),
                "analyst_ratings": detailed_info.get("numberOfAnalystRatings") or detailed_info.get("numberOfAnalystOpinions") or 0,
                "dcf_available": bool(dcf.get("available")),
                "dcf_fair_value": dcf.get("fair_value"),
                "dcf_upside_pct": dcf.get("upside_pct"),
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
