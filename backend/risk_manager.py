"""
Risk management for positions: stop losses, take profits, trailing stops, max holding time.
"""
import logging
from datetime import datetime, timedelta
from typing import Optional, Tuple, List, Dict, Any
from models import RiskControls, PositionMetadata, SignalMetadata

logger = logging.getLogger(__name__)


class PositionManager:
    """Manage open positions with risk controls."""
    
    def __init__(self):
        self.positions: Dict[str, PositionMetadata] = {}
    
    def open_position(self, symbol: str, entry_price: float, signal: Optional[SignalMetadata] = None) -> PositionMetadata:
        """Record a new position."""
        position = PositionMetadata(
            symbol=symbol,
            entry_price=entry_price,
            entry_time=datetime.now(),
            entry_signal=signal,
            trailing_high=entry_price,
        )
        self.positions[symbol] = position
        logger.info(f"Opened position: {symbol} @ ${entry_price}")
        return position
    
    def close_position(self, symbol: str, exit_price: float, exit_reason: str) -> Optional[PositionMetadata]:
        """Close a position and record exit."""
        if symbol not in self.positions:
            return None
        
        position = self.positions[symbol]
        position.exit_price = exit_price
        position.exit_time = datetime.now()
        position.exit_reason = exit_reason
        position.realized_pnl = (exit_price - position.entry_price) * 1  # Assuming 1 share for simplicity
        
        logger.info(f"Closed position: {symbol} @ ${exit_price} ({exit_reason})")
        return position
    
    def evaluate_exits(self, current_prices: Dict[str, float]) -> List[Tuple[str, str, float]]:
        """
        Evaluate all positions for exit signals.
        Returns: List of (symbol, exit_reason, exit_price) tuples
        """
        exits = []
        
        for symbol, position in list(self.positions.items()):
            if symbol not in current_prices:
                continue
            
            current_price = current_prices[symbol]
            risk_control = position.entry_signal.risk_controls if position.entry_signal else RiskControls()
            
            # Update trailing high
            if position.trailing_high is None or current_price > position.trailing_high:
                position.trailing_high = current_price
            
            # Check exit conditions
            exit_reason = self._check_exit_conditions(position, current_price, risk_control)
            
            if exit_reason:
                exits.append((symbol, exit_reason, current_price))
        
        return exits
    
    def _check_exit_conditions(self, position: PositionMetadata, current_price: float, 
                               risk_control: RiskControls) -> Optional[str]:
        """Check if position should exit based on risk controls."""
        
        # Stop loss
        if risk_control.stop_loss_pct > 0:
            stop_loss_price = position.entry_price * (1 - risk_control.stop_loss_pct / 100)
            if current_price <= stop_loss_price:
                return "stop_loss"
        
        # Take profit
        if risk_control.take_profit_pct > 0:
            take_profit_price = position.entry_price * (1 + risk_control.take_profit_pct / 100)
            if current_price >= take_profit_price:
                return "take_profit"
        
        # Trailing stop
        if risk_control.trailing_stop_pct and position.trailing_high:
            trailing_stop_price = position.trailing_high * (1 - risk_control.trailing_stop_pct / 100)
            if current_price <= trailing_stop_price:
                return "trailing_stop"
        
        # Max holding time
        if risk_control.max_holding_days > 0:
            holding_time = datetime.now() - position.entry_time
            if holding_time > timedelta(days=risk_control.max_holding_days):
                return "max_holding_time"
        
        return None
    
    def get_position(self, symbol: str) -> Optional[PositionMetadata]:
        """Get position metadata."""
        return self.positions.get(symbol)
    
    def get_positions(self) -> List[PositionMetadata]:
        """Get all active positions."""
        return list(self.positions.values())
    
    def get_position_metrics(self) -> Dict[str, Any]:
        """Calculate aggregate position metrics."""
        if not self.positions:
            return {
                "total_positions": 0,
                "avg_holding_days": 0,
                "avg_unrealized_pnl_pct": 0,
            }
        
        positions = list(self.positions.values())
        holding_times = [(datetime.now() - p.entry_time).days for p in positions]
        
        return {
            "total_positions": len(positions),
            "avg_holding_days": sum(holding_times) / len(positions) if holding_times else 0,
            "symbols": [p.symbol for p in positions],
        }


class RegimeAwareRiskManager:
    """Adjust risk controls based on market regime."""
    
    @staticmethod
    def adjust_for_regime(risk_controls: RiskControls, regime: str) -> RiskControls:
        """
        Adjust risk controls based on market regime.
        - Bull: Normal controls
        - Bear: Tighter stops, smaller positions
        - High volatility: Wider stops, smaller positions
        - Range-bound: Normal controls
        """
        adjusted = RiskControls(
            stop_loss_pct=risk_controls.stop_loss_pct,
            take_profit_pct=risk_controls.take_profit_pct,
            max_holding_days=risk_controls.max_holding_days,
            max_position_size_pct=risk_controls.max_position_size_pct,
            max_loss_pct=risk_controls.max_loss_pct,
            trailing_stop_pct=risk_controls.trailing_stop_pct,
        )
        
        if regime == "bear":
            # Tighter stops in bear markets
            adjusted.stop_loss_pct = min(1.5, risk_controls.stop_loss_pct)
            adjusted.max_position_size_pct = risk_controls.max_position_size_pct * 0.75
        elif regime == "high_volatility":
            # Wider stops, smaller positions in volatile markets
            adjusted.stop_loss_pct = risk_controls.stop_loss_pct * 1.5
            adjusted.max_position_size_pct = risk_controls.max_position_size_pct * 0.5
        
        return adjusted
    
    @staticmethod
    def should_trade_in_regime(regime: str, strategy: str) -> bool:
        """Check if strategy should trade in current regime."""
        
        # Don't trade blowup stocks in bear markets
        if strategy == "blowup_stocks" and regime == "bear":
            return False
        
        # Reduce covered calls in high volatility (premium compressed)
        if strategy == "covered_calls" and regime == "high_volatility":
            return False
        
        return True
