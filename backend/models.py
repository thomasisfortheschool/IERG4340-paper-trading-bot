"""
Enhanced data models for risk management, recommendations, and backtesting.
"""
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, Dict, Any, List
from enum import Enum


class ConfidenceLevel(str, Enum):
    """Signal confidence levels."""
    HIGH = "high"      # >70% historical win rate
    MEDIUM = "medium"  # 50-70% historical win rate
    LOW = "low"        # <50% historical win rate


class MarketRegime(str, Enum):
    """Market regime classification."""
    BULL = "bull"              # Trending up, low VIX
    BEAR = "bear"              # Trending down, high VIX
    RANGE_BOUND = "range_bound"  # Consolidating
    HIGH_VOLATILITY = "high_volatility"  # VIX > 25, choppy


@dataclass
class RiskControls:
    """Position-level risk parameters."""
    stop_loss_pct: float = 2.0  # Stop loss as % below entry
    take_profit_pct: float = 5.0  # Take profit target as % above entry
    max_holding_days: int = 30  # Max days to hold position
    max_position_size_pct: float = 5.0  # Max position as % of portfolio
    max_loss_pct: float = 1.0  # Max loss per position as % of portfolio
    trailing_stop_pct: Optional[float] = None  # Trailing stop (e.g., 3% below high)


@dataclass
class SignalMetadata:
    """Metadata about a trading signal."""
    symbol: str
    signal_type: str  # 'buy', 'sell', 'hold'
    confidence: ConfidenceLevel
    data_sources: List[str]  # e.g., ['yfinance', 'insider_buying', 'earnings_surprise']
    reason: str  # Short explanation
    historical_win_rate: float  # 0-100%, based on backtest
    expected_return: float  # Expected return %
    max_drawdown_risk: float  # Historical max drawdown %
    recommended_entry_price: float
    recommended_exit_price: float
    recommended_holding_days: int
    risk_controls: RiskControls = field(default_factory=RiskControls)
    regime: MarketRegime = MarketRegime.BULL
    created_at: datetime = field(default_factory=datetime.now)
    expires_at: Optional[datetime] = None  # Signal validity period


@dataclass
class PositionMetadata:
    """Extended metadata for open positions."""
    symbol: str
    entry_price: float
    entry_time: datetime
    entry_signal: Optional[SignalMetadata] = None
    exit_price: Optional[float] = None
    exit_time: Optional[datetime] = None
    exit_reason: Optional[str] = None  # 'stop_loss', 'take_profit', 'max_holding_time', 'manual'
    realized_pnl: float = 0.0
    trailing_high: Optional[float] = None  # For trailing stops


@dataclass
class BacktestResult:
    """Result of a backtesting run."""
    symbol: str
    strategy: str  # e.g., 'blowup_stocks', 'covered_calls'
    start_date: datetime
    end_date: datetime
    total_trades: int
    winning_trades: int
    losing_trades: int
    win_rate: float  # 0-100%
    avg_win: float  # Average winning trade %
    avg_loss: float  # Average losing trade %
    sharpe_ratio: float
    max_drawdown: float  # Worst peak-to-trough %
    total_return: float  # Overall return %
    by_regime: Dict[str, Dict[str, float]] = field(default_factory=dict)  # Performance by market regime
    metadata: Dict[str, Any] = field(default_factory=dict)  # Additional metrics


@dataclass
class StrategyConfig:
    """Customizable strategy configuration."""
    strategy_name: str  # 'blowup_stocks', 'covered_calls', 'forex'
    enabled: bool = True
    allocation_pct: float = 33.0
    
    # Entry rules (customizable)
    entry_rules: Dict[str, Any] = field(default_factory=dict)
    # Example: {
    #   "min_score": 50,
    #   "min_relative_volume": 2.0,
    #   "max_pe_ratio": 30,
    # }
    
    # Exit rules (customizable)
    exit_rules: Dict[str, Any] = field(default_factory=dict)
    # Example: {
    #   "profit_target_pct": 5,
    #   "stop_loss_pct": 2,
    #   "max_holding_days": 30,
    # }
    
    # Risk controls per regime
    risk_controls_by_regime: Dict[MarketRegime, RiskControls] = field(default_factory=dict)
    
    # Position sizing
    position_sizing_method: str = "equal_weight"  # 'equal_weight', 'score_weighted', 'volatility_adjusted'
    
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ExternalDataSource:
    """Configuration for external data sources."""
    source_name: str  # 'news_api', 'rss_feeds', 'earnings_calendar', 'macro_indicators'
    enabled: bool = True
    api_key: Optional[str] = None
    refresh_interval_minutes: int = 60
    config: Dict[str, Any] = field(default_factory=dict)  # Source-specific config
