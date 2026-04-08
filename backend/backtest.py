"""
Backtesting framework for validating trading signals and strategies.
"""
import logging
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional, Tuple, Callable
import yfinance as yf
import numpy as np
from models import BacktestResult, SignalMetadata, MarketRegime, ConfidenceLevel

logger = logging.getLogger(__name__)


def calculate_regime(price_history: np.ndarray, vix: Optional[float] = None) -> MarketRegime:
    """Determine market regime from price and volatility."""
    if len(price_history) < 20:
        return MarketRegime.BULL
    
    # Simple trend detection
    sma_short = np.mean(price_history[-5:])
    sma_long = np.mean(price_history[-20:])
    
    # VIX-based classification (default VIX ~20 is normal)
    if vix and vix > 25:
        return MarketRegime.HIGH_VOLATILITY
    
    if sma_short > sma_long * 1.02:
        return MarketRegime.BULL
    elif sma_short < sma_long * 0.98:
        return MarketRegime.BEAR
    else:
        return MarketRegime.RANGE_BOUND


class BacktestEngine:
    """Run historical backtest on trading signal."""
    
    def __init__(self, symbol: str, lookback_days: int = 252):
        self.symbol = symbol
        self.lookback_days = lookback_days
        self.logger = logging.getLogger(f"Backtest[{symbol}]")

    def _empty_result(self, strategy: str, start_date: datetime, end_date: datetime) -> BacktestResult:
        return BacktestResult(
            symbol=self.symbol,
            strategy=strategy,
            start_date=start_date,
            end_date=end_date,
            total_trades=0,
            winning_trades=0,
            losing_trades=0,
            win_rate=0.0,
            avg_win=0.0,
            avg_loss=0.0,
            sharpe_ratio=0.0,
            max_drawdown=0.0,
            total_return=0.0,
        )
    
    def fetch_historical_data(self, start_date: datetime, end_date: datetime) -> Dict[str, Any]:
        """Fetch OHLCV data for backtest period."""
        try:
            ticker = yf.Ticker(self.symbol)
            hist = ticker.history(start=start_date, end=end_date)
            
            if hist.empty:
                self.logger.warning(f"No data found for {self.symbol}")
                return {}
            
            return {
                'dates': hist.index.tolist(),
                'opens': hist['Open'].values,
                'highs': hist['High'].values,
                'lows': hist['Low'].values,
                'closes': hist['Close'].values,
                'volumes': hist['Volume'].values,
            }
        except Exception as e:
            self.logger.error(f"Error fetching historical data: {e}")
            return {}
    
    def simulate_strategy(
        self,
        entry_rule: Callable[[int, Dict[str, Any]], bool],
        exit_rule: Callable[[int, Dict[str, Any], Dict[str, Any]], Tuple[bool, Optional[str]]],
        data: Dict[str, Any],
        initial_capital: float = 10000,
        strategy_name: str = "test",
    ) -> BacktestResult:
        """Simulate strategy execution on historical data."""
        if not data:
            now = datetime.now()
            return self._empty_result(strategy_name, now, now)
        
        closes = data['closes']
        dates = data['dates']
        trades = []
        position = None
        capital = initial_capital
        
        for i in range(1, len(closes)):
            current_price = closes[i]
            current_date = dates[i]
            
            # Check entry signal
            if position is None and entry_rule(i, data):
                position = {
                    'entry_date': current_date,
                    'entry_price': current_price,
                    'entry_idx': i,
                }
            
            # Check exit signal
            elif position is not None:
                exit_signal, reason = exit_rule(i, data, position)
                if exit_signal:
                    profit_pct = ((current_price - position['entry_price']) / position['entry_price']) * 100
                    pnl = capital * (profit_pct / 100)
                    capital += pnl
                    
                    trades.append({
                        'entry_date': position['entry_date'],
                        'exit_date': current_date,
                        'entry_price': position['entry_price'],
                        'exit_price': current_price,
                        'profit_pct': profit_pct,
                        'reason': reason or 'exit_rule',
                        'pnl': pnl,
                    })
                    position = None
        
        # Calculate metrics
        return self._calculate_metrics(
            trades,
            capital,
            initial_capital,
            dates[0],
            dates[-1],
            strategy_name,
        )
    
    def _calculate_metrics(
        self,
        trades: List[Dict[str, Any]],
        final_capital: float,
        initial_capital: float,
        start_date: datetime,
        end_date: datetime,
        strategy_name: str,
    ) -> BacktestResult:
        """Calculate backtest performance metrics."""
        if not trades:
            return self._empty_result(strategy_name, start_date, end_date)
        
        profits = [t['profit_pct'] for t in trades]
        winning_trades = len([p for p in profits if p > 0])
        losing_trades = len([p for p in profits if p < 0])
        
        total_return = ((final_capital - initial_capital) / initial_capital) * 100
        avg_win = float(np.mean([p for p in profits if p > 0])) if winning_trades > 0 else 0.0
        avg_loss = float(np.mean([p for p in profits if p < 0])) if losing_trades > 0 else 0.0
        
        # Sharpe ratio (simplified: using profit std dev)
        profit_stdev = float(np.std(profits)) if len(profits) > 1 else 0.0
        sharpe = (float(np.mean(profits)) / profit_stdev * float(np.sqrt(252))) if profit_stdev > 0 else 0.0
        
        # Max drawdown
        cumulative_returns = np.cumprod([1 + (p / 100) for p in profits])
        running_max = np.maximum.accumulate(cumulative_returns)
        drawdown = (cumulative_returns - running_max) / running_max
        max_drawdown = float(np.min(drawdown) * 100) if len(drawdown) > 0 else 0.0
        
        win_rate = (winning_trades / len(trades) * 100) if trades else 0
        
        return BacktestResult(
            symbol=self.symbol,
            strategy=strategy_name,
            start_date=start_date,
            end_date=end_date,
            total_trades=len(trades),
            winning_trades=winning_trades,
            losing_trades=losing_trades,
            win_rate=round(win_rate, 2),
            avg_win=round(avg_win, 2),
            avg_loss=round(avg_loss, 2),
            sharpe_ratio=round(sharpe, 2),
            max_drawdown=round(max_drawdown, 2),
            total_return=round(total_return, 2),
        )
    
    def backtest_blowup_stocks(self) -> BacktestResult:
        """
        Backtest blowup stock strategy:
        - Buy: High relative volume + high score
        - Sell: After 5% gain or 2% loss
        """
        end_date = datetime.now()
        start_date = end_date - timedelta(days=self.lookback_days)
        
        data = self.fetch_historical_data(start_date, end_date)
        if not data:
            return self._empty_result("blowup_stocks", start_date, end_date)
        
        volume_ma_20 = np.convolve(data['volumes'], np.ones(20)/20, mode='valid')
        
        def entry_rule(idx: int, hist: Dict) -> bool:
            if idx < 20:
                return False
            current_volume_ratio = hist['volumes'][idx] / volume_ma_20[idx - 20]
            # Buy on high volume breakout
            return current_volume_ratio > 2.0 and hist['closes'][idx] > hist['closes'][idx-1]
        
        def exit_rule(idx: int, hist: Dict[str, Any], position: Dict[str, Any]) -> Tuple[bool, Optional[str]]:
            entry_price = position['entry_price']
            current_price = hist['closes'][idx]
            profit_pct = ((current_price - entry_price) / entry_price) * 100
            holding_days = (idx - position['entry_idx'])
            
            if profit_pct >= 5:
                return True, 'take_profit'
            elif profit_pct <= -2:
                return True, 'stop_loss'
            elif holding_days > 30:
                return True, 'max_holding_time'
            
            return False, None
        
        return self.simulate_strategy(entry_rule, exit_rule, data, strategy_name="blowup_stocks")
    
    def backtest_covered_calls(self) -> BacktestResult:
        """
        Backtest covered call strategy:
        - Buy stock, sell call
        - Exit on assignment or after X days
        """
        # Simplified: buy stock and sell after 1-3% gain
        end_date = datetime.now()
        start_date = end_date - timedelta(days=self.lookback_days)
        
        data = self.fetch_historical_data(start_date, end_date)
        if not data:
            return self._empty_result("covered_calls", start_date, end_date)
        
        def entry_rule(idx: int, hist: Dict) -> bool:
            if idx < 5:
                return False
            # Enter on price support (lower than 5-day avg)
            price_avg_5 = np.mean(hist['closes'][idx-5:idx])
            return hist['closes'][idx] < price_avg_5 * 0.98
        
        def exit_rule(idx: int, hist: Dict[str, Any], position: Dict[str, Any]) -> Tuple[bool, Optional[str]]:
            entry_price = position['entry_price']
            current_price = hist['closes'][idx]
            profit_pct = ((current_price - entry_price) / entry_price) * 100
            holding_days = (idx - position['entry_idx'])
            
            if profit_pct >= 2:  # Covered call premium target
                return True, 'take_profit'
            elif holding_days > 7:  # Weekly expiry
                return True, 'max_holding_time'
            
            return False, None
        
        return self.simulate_strategy(entry_rule, exit_rule, data, strategy_name="covered_calls")


def get_confidence_from_win_rate(win_rate: float) -> ConfidenceLevel:
    """Convert win rate percentage to confidence level."""
    if win_rate > 70:
        return ConfidenceLevel.HIGH
    elif win_rate > 50:
        return ConfidenceLevel.MEDIUM
    else:
        return ConfidenceLevel.LOW
