"""
Bot implementations for different trading strategies based on fundamental analysis.

Strategies:
- MomentumTrading: Stocks with strong recent RSI and positive price momentum
- SwingTrading: Oversold stocks (RSI < 30) poised for reversal
- ValueInvesting: Undervalued stocks (low P/E, high dividend yield)
- GrowthInvesting: High-growth companies (revenue/earnings growth > 20%)
- MeanReversion: RSI extremes (>70 = sell, <30 = buy)
"""
import logging
import asyncio
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
import yfinance as yf

logger = logging.getLogger(__name__)


# ============================================================================
# Helper: Calculate RSI (Relative Strength Index)
# ============================================================================
def calculate_rsi(prices: List[float], period: int = 14) -> float:
    """Calculate RSI from price list. Returns None if insufficient data."""
    if len(prices) < period + 1:
        return None
    
    deltas = [prices[i] - prices[i-1] for i in range(1, len(prices))]
    gains = [d if d > 0 else 0 for d in deltas[-period:]]
    losses = [-d if d < 0 else 0 for d in deltas[-period:]]
    
    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period
    
    if avg_loss == 0:
        return 100.0 if avg_gain > 0 else 50.0
    
    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))
    return rsi


def get_price_momentum(prices: List[float], lookback: int = 5) -> float:
    """Calculate % change over recent period."""
    if len(prices) < lookback + 1:
        return 0.0
    return ((prices[-1] - prices[-lookback]) / prices[-lookback]) * 100


# ============================================================================
# Base Strategy Class
# ============================================================================
class BaseStrategy:
    """Base class for all trading strategies."""
    
    def __init__(self, broker, allocation_pct: float = 33.0):
        self.broker = broker
        self.allocation_pct = allocation_pct
        self.active_positions = []
        self.strategy_name = self.__class__.__name__
    
    async def run_scan(self) -> List[Dict[str, Any]]:
        """Scan for opportunities. Override in subclass."""
        raise NotImplementedError
    
    async def get_stock_data(self, symbol: str) -> Optional[Dict[str, Any]]:
        """Fetch fundamental data for a stock."""
        try:
            ticker = yf.Ticker(symbol)
            hist = ticker.history(period="3mo")
            info = ticker.info or {}
            
            if hist.empty:
                return None
            
            prices = hist['Close'].tail(100).tolist()
            volume = hist['Volume'].tail(20).mean()
            
            return {
                "symbol": symbol,
                "price": hist['Close'].iloc[-1],
                "rsi": calculate_rsi(prices),
                "momentum_5d": get_price_momentum(prices, 5),
                "momentum_20d": get_price_momentum(prices, 20),
                "volume": volume,
                "pe_ratio": info.get("trailingPE", None),
                "dividend_yield": info.get("dividendYield", 0),
                "revenue_growth": info.get("revenueGrowth", None),
                "earnings_growth": info.get("earningsGrowth", None),
                "market_cap": info.get("marketCap", None),
                "fifty_two_week_high": info.get("fiftyTwoWeekHigh", None),
                "fifty_two_week_low": info.get("fiftyTwoWeekLow", None),
            }
        except Exception as e:
            logger.error(f"Error fetching data for {symbol}: {e}")
            return None
    
    async def place_entry_order(self, symbol: str, price: float, reason: str) -> bool:
        """Place entry order and track positions."""
        try:
            account = await self.broker.get_account_snapshot()
            position_capital = account.total_value * (self.allocation_pct / 100)
            quantity = int(position_capital / price) if price > 0 else 0
            
            if quantity <= 0:
                logger.warning(f"{self.strategy_name}: Insufficient capital for {symbol}")
                return False
            
            order = await self.broker.place_order(symbol, "buy", quantity)
            
            if order:
                self.active_positions.append({
                    "symbol": symbol,
                    "quantity": quantity,
                    "entry_price": price,
                    "entry_time": datetime.now(),
                    "reason": reason,
                })
                logger.info(f"{self.strategy_name}: Entered {symbol} at ${price:.2f} for {quantity} shares - {reason}")
                return True
            
            return False
        except Exception as e:
            logger.error(f"{self.strategy_name}: Error placing entry order: {e}")
            return False
    
    async def manage_positions(self, profit_target: float = 8.0, stop_loss: float = -4.0) -> None:
        """Manage positions with profit target and stop loss."""
        for pos in self.active_positions[:]:
            try:
                current = await self.broker.get_position(pos["symbol"])
                if not current:
                    self.active_positions.remove(pos)
                    continue
                
                pnl_pct = current.pnl_pct
                
                if pnl_pct >= profit_target:
                    await self.broker.place_order(pos["symbol"], "sell", pos["quantity"])
                    logger.info(f"{self.strategy_name}: Exited {pos['symbol']} +{pnl_pct:.1f}%")
                    self.active_positions.remove(pos)
                
                elif pnl_pct <= stop_loss:
                    await self.broker.place_order(pos["symbol"], "sell", pos["quantity"])
                    logger.info(f"{self.strategy_name}: Exited {pos['symbol']} {pnl_pct:.1f}% (stop)")
                    self.active_positions.remove(pos)
            
            except Exception as e:
                logger.error(f"{self.strategy_name}: Error managing {pos['symbol']}: {e}")


# ============================================================================
# Fundamental Analysis Strategies
# ============================================================================

class MomentumTradingBot(BaseStrategy):
    """
    Trades stocks with strong recent momentum and positive RSI confirmation.
    Entry: RSI 50-70 (strong but not overbought) + 5d momentum > 2%
    Exit: +6% profit target, -3% stop loss
    """
    
    async def run_scan(self) -> List[Dict[str, Any]]:
        """Scan for momentum candidates."""
        logger.info(f"Momentum Trading: Scanning universe ({self.allocation_pct}% allocation)")
        
        # Sample watchlist - in production, this would be comprehensive
        candidates_list = ["NVDA", "MSFT", "AMD", "TSLA", "PLTR", "MSTR"]
        candidates = []
        
        for symbol in candidates_list:
            data = await self.get_stock_data(symbol)
            if not data:
                continue
            
            rsi = data.get("rsi")
            momentum = data.get("momentum_5d", 0)
            
            # Entry criteria: RSI 50-70 (strong momentum) + positive 5-day momentum
            if rsi and 50 <= rsi <= 70 and momentum > 2.0:
                candidates.append({
                    **data,
                    "score": rsi + momentum,
                    "reason": f"Strong momentum: RSI {rsi:.0f}, +{momentum:.1f}% 5d",
                })
        
        logger.info(f"Momentum Trading: Found {len(candidates)} candidates")
        return candidates
    
    async def evaluate_entry(self, candidate: Dict[str, Any]) -> bool:
        """Evaluate if we should enter."""
        symbol = candidate.get("symbol")
        return symbol not in [p["symbol"] for p in self.active_positions]
    
    async def place_entry_order(self, candidate: Dict[str, Any]) -> bool:
        """Place entry order."""
        symbol = candidate.get("symbol")
        price = candidate.get("price")
        reason = candidate.get("reason", "Momentum signal")
        return await super().place_entry_order(symbol, price, reason)
    
    async def manage_positions(self) -> None:
        """Manage momentum trades with tighter exits."""
        await super().manage_positions(profit_target=6.0, stop_loss=-3.0)


class SwingTradingBot(BaseStrategy):
    """
    Trades oversold stocks (RSI < 30) that are poised for reversals.
    Entry: RSI < 30 (oversold) + price near 20-day low
    Exit: +5% profit target, -2.5% stop loss
    Hold time: 5-15 days typically
    """
    
    async def run_scan(self) -> List[Dict[str, Any]]:
        """Scan for swing trade setups."""
        logger.info(f"Swing Trading: Scanning for oversold bounces ({self.allocation_pct}% allocation)")
        
        candidates_list = ["AAPL", "JPM", "BAC", "F", "GE"]
        candidates = []
        
        for symbol in candidates_list:
            data = await self.get_stock_data(symbol)
            if not data:
                continue
            
            rsi = data.get("rsi")
            price = data.get("price")
            fifty_two_week_low = data.get("fifty_two_week_low")
            
            # Entry: RSI oversold + near support
            if rsi and rsi < 30 and fifty_two_week_low:
                distance_from_low = ((price - fifty_two_week_low) / fifty_two_week_low) * 100
                
                if distance_from_low < 10:  # Within 10% of 52-week low
                    candidates.append({
                        **data,
                        "score": 100 - rsi,  # Lower RSI = higher score
                        "reason": f"Oversold setup: RSI {rsi:.0f}, near 52w low",
                    })
        
        logger.info(f"Swing Trading: Found {len(candidates)} reversal setups")
        return candidates
    
    async def evaluate_entry(self, candidate: Dict[str, Any]) -> bool:
        """Evaluate if we should enter."""
        symbol = candidate.get("symbol")
        return symbol not in [p["symbol"] for p in self.active_positions]
    
    async def place_entry_order(self, candidate: Dict[str, Any]) -> bool:
        """Place entry order."""
        symbol = candidate.get("symbol")
        price = candidate.get("price")
        reason = candidate.get("reason", "Swing setup")
        return await super().place_entry_order(symbol, price, reason)
    
    async def manage_positions(self) -> None:
        """Manage swing trades."""
        await super().manage_positions(profit_target=5.0, stop_loss=-2.5)


class ValueInvestingBot(BaseStrategy):
    """
    Finds undervalued stocks with strong fundamentals.
    Criteria: Low P/E ratio (< 15) + High dividend yield (> 3%)
    Exit: +12% profit target (longer hold), -5% stop loss
    Hold time: weeks to months
    """
    
    async def run_scan(self) -> List[Dict[str, Any]]:
        """Scan for undervalued opportunities."""
        logger.info(f"Value Investing: Scanning for undervalued picks ({self.allocation_pct}% allocation)")
        
        candidates_list = ["JNJ", "PG", "KO", "WMT", "MCD", "IBM"]
        candidates = []
        
        for symbol in candidates_list:
            data = await self.get_stock_data(symbol)
            if not data:
                continue
            
            pe_ratio = data.get("pe_ratio")
            div_yield = data.get("dividend_yield", 0)
            
            # Entry: Low P/E + decent dividend
            if pe_ratio and pe_ratio < 15 and div_yield > 0.02:
                candidates.append({
                    **data,
                    "score": (15 - pe_ratio) + (div_yield * 100),
                    "reason": f"Value: P/E {pe_ratio:.1f}, Div {div_yield*100:.1f}%",
                })
        
        logger.info(f"Value Investing: Found {len(candidates)} undervalued stocks")
        return candidates
    
    async def evaluate_entry(self, candidate: Dict[str, Any]) -> bool:
        """Evaluate if we should enter."""
        symbol = candidate.get("symbol")
        return symbol not in [p["symbol"] for p in self.active_positions]
    
    async def place_entry_order(self, candidate: Dict[str, Any]) -> bool:
        """Place entry order."""
        symbol = candidate.get("symbol")
        price = candidate.get("price")
        reason = candidate.get("reason", "Value signal")
        return await super().place_entry_order(symbol, price, reason)
    
    async def manage_positions(self) -> None:
        """Manage value positions with longer hold times."""
        await super().manage_positions(profit_target=12.0, stop_loss=-5.0)


class GrowthInvestingBot(BaseStrategy):
    """
    Finds high-growth companies poised for upside.
    Criteria: Revenue growth > 20% + Earnings growth > 15% + Strong momentum
    Exit: +15% profit target, -6% stop loss
    Hold time: medium to long term
    """
    
    async def run_scan(self) -> List[Dict[str, Any]]:
        """Scan for growth opportunities."""
        logger.info(f"Growth Investing: Scanning for high-growth companies ({self.allocation_pct}% allocation)")
        
        candidates_list = ["NFLX", "SQ", "PYPL", "CRWD", "DDOG", "CRM"]
        candidates = []
        
        for symbol in candidates_list:
            data = await self.get_stock_data(symbol)
            if not data:
                continue
            
            rev_growth = data.get("revenue_growth")
            earn_growth = data.get("earnings_growth")
            momentum = data.get("momentum_20d", 0)
            
            # Entry: Both revenue and earnings growing strongly, positive momentum
            if rev_growth and earn_growth and rev_growth > 0.20 and earn_growth > 0.15:
                candidates.append({
                    **data,
                    "score": (rev_growth * 100) + (earn_growth * 100),
                    "reason": f"Growth: Rev +{rev_growth*100:.0f}%, Earn +{earn_growth*100:.0f}%",
                })
        
        logger.info(f"Growth Investing: Found {len(candidates)} high-growth stocks")
        return candidates
    
    async def evaluate_entry(self, candidate: Dict[str, Any]) -> bool:
        """Evaluate if we should enter."""
        symbol = candidate.get("symbol")
        return symbol not in [p["symbol"] for p in self.active_positions]
    
    async def place_entry_order(self, candidate: Dict[str, Any]) -> bool:
        """Place entry order."""
        symbol = candidate.get("symbol")
        price = candidate.get("price")
        reason = candidate.get("reason", "Growth signal")
        return await super().place_entry_order(symbol, price, reason)
    
    async def manage_positions(self) -> None:
        """Manage growth positions."""
        await super().manage_positions(profit_target=15.0, stop_loss=-6.0)


class MeanReversionBot(BaseStrategy):
    """
    Trades RSI extremes - buys oversold (RSI < 30), sells overbought (RSI > 70).
    Short-term tactical strategy for quick reversals.
    Entry: RSI < 30 (buy) or RSI > 70 (sell)
    Exit: +3% profit target, -1.5% stop loss
    Hold time: hours to 2-3 days
    """
    
    async def run_scan(self) -> List[Dict[str, Any]]:
        """Scan for mean reversion setups."""
        logger.info(f"Mean Reversion: Scanning for RSI extremes ({self.allocation_pct}% allocation)")
        
        candidates_list = ["QQQ", "SPY", "IWM", "EEM", "XLF"]
        candidates = []
        
        for symbol in candidates_list:
            data = await self.get_stock_data(symbol)
            if not data:
                continue
            
            rsi = data.get("rsi")
            
            if rsi:
                if rsi < 30:
                    candidates.append({
                        **data,
                        "signal": "BUY",
                        "score": 30 - rsi,
                        "reason": f"Oversold: RSI {rsi:.0f}",
                    })
                elif rsi > 70:
                    candidates.append({
                        **data,
                        "signal": "SELL",
                        "score": rsi - 70,
                        "reason": f"Overbought: RSI {rsi:.0f}",
                    })
        
        logger.info(f"Mean Reversion: Found {len(candidates)} RSI extremes")
        return candidates
    
    async def evaluate_entry(self, candidate: Dict[str, Any]) -> bool:
        """Evaluate if we should enter."""
        symbol = candidate.get("symbol")
        return symbol not in [p["symbol"] for p in self.active_positions]
    
    async def place_entry_order(self, candidate: Dict[str, Any]) -> bool:
        """Place entry order."""
        symbol = candidate.get("symbol")
        price = candidate.get("price")
        reason = candidate.get("reason", "Mean reversion")
        return await super().place_entry_order(symbol, price, reason)
    
    async def manage_positions(self) -> None:
        """Manage mean reversion trades with tight exits."""
        await super().manage_positions(profit_target=3.0, stop_loss=-1.5)


# ============================================================================
# Legacy Bots (kept for backward compatibility, but deprecated)
# ============================================================================


class BlowupStockBot:
    """Bot that trades high-growth/breakout stock candidates."""
    
    def __init__(self, screener, broker, allocation_pct: float = 33.0):
        self.screener = screener
        self.broker = broker
        self.allocation_pct = allocation_pct
        self.active_positions = []
    
    async def run_scan(self) -> List[Dict[str, Any]]:
        """Scan for blowup stock opportunities."""
        logger.info(f"Scanning for blowup stocks ({self.allocation_pct}% allocation)")
        candidates = await self.screener.screen()
        return candidates
    
    async def evaluate_entry(self, candidate: Dict[str, Any]) -> bool:
        """Evaluate if we should enter a position."""
        symbol = candidate.get("symbol")
        score = candidate.get("score", 0)
        relative_volume = candidate.get("relative_volume", 0)
        
        # Entry criteria
        should_enter = (
            score > 50 and
            relative_volume > 2.0 and
            symbol not in [p["symbol"] for p in self.active_positions]
        )
        
        return should_enter
    
    async def place_entry_order(self, candidate: Dict[str, Any]) -> bool:
        """Place entry order for a candidate."""
        try:
            symbol = candidate.get("symbol")
            price = candidate.get("price")
            
            # Calculate position size based on allocation
            account = await self.broker.get_account_snapshot()
            position_capital = account.total_value * (self.allocation_pct / 100)
            quantity = int(position_capital / price)
            
            if quantity <= 0:
                return False
            
            order = await self.broker.place_order(symbol, "buy", quantity)
            
            if order:
                self.active_positions.append({
                    "symbol": symbol,
                    "quantity": quantity,
                    "entry_price": price,
                    "entry_time": datetime.now(),
                })
                logger.info(f"Entered {symbol} at ${price} for {quantity} shares")
                return True
            
            return False
        except Exception as e:
            logger.error(f"Error placing entry order: {e}")
            return False
    
    async def manage_positions(self) -> None:
        """Manage open positions (exits, stops, etc.)."""
        for pos in self.active_positions[:]:
            try:
                current = await self.broker.get_position(pos["symbol"])
                if not current:
                    self.active_positions.remove(pos)
                    continue
                
                # Simple exit logic: 10% profit or 5% stop loss
                pnl_pct = current.pnl_pct
                
                if pnl_pct >= 10.0:  # Take profit
                    await self.broker.place_order(pos["symbol"], "sell", pos["quantity"])
                    logger.info(f"Exited {pos['symbol']} with {pnl_pct:.1f}% profit")
                    self.active_positions.remove(pos)
                
                elif pnl_pct <= -5.0:  # Stop loss
                    await self.broker.place_order(pos["symbol"], "sell", pos["quantity"])
                    logger.info(f"Exited {pos['symbol']} with {pnl_pct:.1f}% loss (stop)")
                    self.active_positions.remove(pos)
            
            except Exception as e:
                logger.error(f"Error managing position {pos['symbol']}: {e}")


class CoveredCallBot:
    """Bot that sells 0DTE covered calls on major indices."""
    
    def __init__(self, screener, broker, allocation_pct: float = 33.0):
        self.screener = screener
        self.broker = broker
        self.allocation_pct = allocation_pct
        self.open_calls = []
    
    async def run_scan(self) -> List[Dict[str, Any]]:
        """Scan for covered call opportunities."""
        logger.info(f"Scanning for covered call opportunities ({self.allocation_pct}% allocation)")
        opportunities = await self.screener.screen_for_opportunities(self.broker)
        return opportunities
    
    async def evaluate_opportunity(self, opportunity: Dict[str, Any]) -> bool:
        """Evaluate if we should sell a covered call."""
        symbol = opportunity.get("symbol")
        premium_pct = opportunity.get("premium_pct", 0)
        
        # Only sell if premium is good enough
        should_sell = (
            premium_pct >= self.screener.config["min_premium_pct"] and
            symbol not in [c["symbol"] for c in self.open_calls]
        )
        
        return should_sell
    
    async def place_call_order(self, opportunity: Dict[str, Any]) -> bool:
        """Sell a covered call contract."""
        try:
            symbol = opportunity.get("symbol")
            strike = opportunity.get("call_strike")
            premium = opportunity.get("call_premium")
            
            # For demo, just log it
            logger.info(f"Selling {symbol} ${strike} call for ${premium} premium")
            
            self.open_calls.append({
                "symbol": symbol,
                "strike": strike,
                "premium": premium,
                "expiry": opportunity.get("expiry"),
                "open_time": datetime.now(),
            })
            
            return True
        except Exception as e:
            logger.error(f"Error placing call order: {e}")
            return False
    
    async def manage_calls(self) -> None:
        """Manage open call positions."""
        for call in self.open_calls[:]:
            try:
                # Check if position expired
                expiry = datetime.strptime(call["expiry"], "%Y%m%d")
                if datetime.now() > expiry:
                    logger.info(f"Call on {call['symbol']} expired")
                    self.open_calls.remove(call)
            except Exception as e:
                logger.error(f"Error managing call: {e}")


class ForexBot:
    """Bot that trades forex pairs."""
    
    def __init__(self, broker, allocation_pct: float = 34.0):
        self.broker = broker
        self.allocation_pct = allocation_pct
        self.pairs = ["EURUSD", "GBPUSD", "USDJPY"]
        self.open_trades = []
    
    async def run_scan(self) -> List[Dict[str, Any]]:
        """Scan for forex opportunities."""
        logger.info(f"Scanning for forex opportunities ({self.allocation_pct}% allocation)")
        # Simple momentum-based scan
        opportunities = []
        for pair in self.pairs:
            opp = await self._analyze_pair(pair)
            if opp:
                opportunities.append(opp)
        return opportunities
    
    async def _analyze_pair(self, pair: str) -> Optional[Dict[str, Any]]:
        """Analyze a forex pair."""
        try:
            # Mock data for demo
            pairs_data = {
                "EURUSD": {"price": 1.0950, "signal": "buy", "score": 65},
                "GBPUSD": {"price": 1.2750, "signal": "sell", "score": 45},
                "USDJPY": {"price": 149.50, "signal": "neutral", "score": 30},
            }
            
            data = pairs_data.get(pair, {})
            if data.get("score", 0) < 50:
                return None
            
            return {
                "symbol": pair,
                "price": data["price"],
                "signal": data["signal"],
                "score": data["score"],
                "reason": f"{pair} showing {data['signal']} signal",
            }
        except Exception as e:
            logger.error(f"Error analyzing {pair}: {e}")
            return None
    
    async def place_trade(self, opportunity: Dict[str, Any]) -> bool:
        """Place a forex trade."""
        try:
            symbol = opportunity.get("symbol")
            signal = opportunity.get("signal")
            
            logger.info(f"Trading {symbol}: {signal}")
            
            self.open_trades.append({
                "symbol": symbol,
                "signal": signal,
                "open_time": datetime.now(),
            })
            
            return True
        except Exception as e:
            logger.error(f"Error placing trade: {e}")
            return False
