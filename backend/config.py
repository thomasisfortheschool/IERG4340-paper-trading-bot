"""
Configuration and strategy allocation management.
"""
from dataclasses import dataclass
from enum import Enum
from typing import Dict, Any
import json
from pathlib import Path


class TradingMode(str, Enum):
    """Available trading strategy modes."""
    AGGRESSIVE = "aggressive"  # 50% blow-up, 30% options, 20% forex
    BALANCED = "balanced"      # 33% blow-up, 33% options, 33% forex
    CONSERVATIVE = "conservative"  # 20% blow-up, 50% options, 30% forex
    OPTIONS_FOCUSED = "options_focused"  # 10% blow-up, 80% options, 10% forex
    FOREX_FOCUSED = "forex_focused"  # 20% blow-up, 20% options, 60% forex
    CUSTOM = "custom"  # User-defined allocation


@dataclass
class FundamentalScreenerConfig:
    """Configuration for fundamental analysis screener."""
    relative_volume_threshold: float = 2.0  # Relative to 20-day average
    pe_ratio_max: float = 30.0
    forward_pe_ratio_max: float = 25.0
    price_min: float = 5.0
    price_max: float = 500.0
    market_cap_min_millions: float = 100.0
    earnings_surprise_min_pct: float = 5.0
    analyst_upgrade_days: int = 30  # Recent analyst upgrades
    insider_buying_days: int = 30
    options_volume_threshold: int = 100  # Min contracts


@dataclass
class OptionScreenerConfig:
    """Configuration for covered call screening."""
    symbols: list = None  # SPY, QQQ, IWM, etc.
    target_delta: float = 0.25
    min_premium_pct: float = 0.5  # Min premium as % of stock price
    dte_target: int = 0  # 0DTE = same day
    max_holding_days: int = 1
    
    def __post_init__(self):
        if self.symbols is None:
            self.symbols = ["SPY", "QQQ", "IWM", "UVXY"]


@dataclass
class ForexConfig:
    """Configuration for forex trading."""
    pairs: list = None  # EUR/USD, GBP/USD, etc.
    leverage: float = 1.0
    max_position_size_pct: float = 5.0
    take_profit_pips: int = 30
    stop_loss_pips: int = 15
    
    def __post_init__(self):
        if self.pairs is None:
            self.pairs = ["EURUSD", "GBPUSD", "USDJPY"]


@dataclass
class StrategyAllocation:
    """Asset allocation across strategies."""
    blowup_stocks_pct: float = 0.33
    covered_calls_pct: float = 0.33
    forex_pct: float = 0.34
    
    def validate(self) -> bool:
        total = self.blowup_stocks_pct + self.covered_calls_pct + self.forex_pct
        return abs(total - 100.0) < 0.01


class ConfigManager:
    """Load and manage configuration from JSON files and environment."""
    
    DEFAULT_PRESETS = {
        TradingMode.BALANCED: {
            "blowup_stocks_pct": 33.33,
            "covered_calls_pct": 33.33,
            "forex_pct": 33.34,
        },
        TradingMode.AGGRESSIVE: {
            "blowup_stocks_pct": 50.0,
            "covered_calls_pct": 30.0,
            "forex_pct": 20.0,
        },
        TradingMode.CONSERVATIVE: {
            "blowup_stocks_pct": 20.0,
            "covered_calls_pct": 50.0,
            "forex_pct": 30.0,
        },
        TradingMode.OPTIONS_FOCUSED: {
            "blowup_stocks_pct": 10.0,
            "covered_calls_pct": 80.0,
            "forex_pct": 10.0,
        },
        TradingMode.FOREX_FOCUSED: {
            "blowup_stocks_pct": 20.0,
            "covered_calls_pct": 20.0,
            "forex_pct": 60.0,
        },
    }
    
    def __init__(self, config_dir: str = "data"):
        self.config_dir = Path(config_dir)
        self.config_dir.mkdir(exist_ok=True)
        self.user_config_file = self.config_dir / "user_config.json"
    
    def load_user_config(self) -> Dict[str, Any]:
        """Load user configuration from JSON file."""
        if self.user_config_file.exists():
            with open(self.user_config_file, "r") as f:
                return json.load(f)
        return self.get_default_config(TradingMode.BALANCED)
    
    def save_user_config(self, config: Dict[str, Any]) -> None:
        """Save user configuration to JSON file."""
        with open(self.user_config_file, "w") as f:
            json.dump(config, f, indent=2)
    
    def get_default_config(self, mode: TradingMode = TradingMode.BALANCED) -> Dict[str, Any]:
        """Get default configuration for a given trading mode."""
        preset = self.DEFAULT_PRESETS.get(mode, self.DEFAULT_PRESETS[TradingMode.BALANCED])
        return {
            "mode": mode.value,
            "allocation": preset,
            "fundamental_screener": {
                "relative_volume_threshold": 2.0,
                "pe_ratio_max": 30.0,
                "forward_pe_ratio_max": 25.0,
                "price_min": 5.0,
                "price_max": 500.0,
                "market_cap_min_millions": 100.0,
            },
            "option_screener": {
                "symbols": ["SPY", "QQQ", "IWM", "UVXY"],
                "target_delta": 0.25,
                "min_premium_pct": 0.5,
                "dte_target": 0,
            },
            "forex": {
                "pairs": ["EURUSD", "GBPUSD", "USDJPY"],
                "leverage": 1.0,
                "max_position_size_pct": 5.0,
                "tick_seconds": 1,
                "grid_step_pct": 0.0015,
                "grid_max_legs_per_pair": 3,
                "grid_take_profit_steps": 1,
            },
            "crypto": {
                "enabled": False,
                "symbols": ["BTC-USD", "ETH-USD"],
                "max_position_size_pct": 2.5,
                "max_symbol_exposure_pct": 3.0,
                "min_notional_usd": 50.0,
                "daily_loss_limit_usd": 750.0,
                "grid_step_pct": 0.003,
                "grid_max_legs_per_symbol": 3,
                "grid_take_profit_steps": 1,
                "risk_acknowledged": False,
                "advanced_user_confirmed": False,
            },
        }
    
    def get_allocation(self, mode: str = None) -> StrategyAllocation:
        """Get current strategy allocation."""
        config = self.load_user_config()
        alloc_dict = config.get("allocation", {})
        return StrategyAllocation(
            blowup_stocks_pct=alloc_dict.get("blowup_stocks_pct", 33.33),
            covered_calls_pct=alloc_dict.get("covered_calls_pct", 33.33),
            forex_pct=alloc_dict.get("forex_pct", 33.34),
        )
    
    def get_strategy_defaults(self) -> Dict[str, Any]:
        """Get default strategy configurations with risk controls."""
        return {
            "blowup_stocks": {
                "enabled": True,
                "allocation_pct": 33.33,
                "entry_rules": {
                    "min_score": 50,
                    "min_relative_volume": 2.0,
                    "max_pe_ratio": 30,
                },
                "exit_rules": {
                    "profit_target_pct": 5.0,
                    "stop_loss_pct": 2.0,
                    "max_holding_days": 30,
                },
                "risk_controls": {
                    "stop_loss_pct": 2.0,
                    "take_profit_pct": 5.0,
                    "max_holding_days": 30,
                    "max_position_size_pct": 5.0,
                    "max_loss_pct": 1.0,
                    "trailing_stop_pct": None,
                },
            },
            "covered_calls": {
                "enabled": True,
                "allocation_pct": 33.33,
                "entry_rules": {
                    "min_volume": 1000000,
                    "target_delta": 0.25,
                    "min_premium_pct": 0.5,
                },
                "exit_rules": {
                    "profit_target_pct": 2.0,
                    "max_holding_days": 7,
                },
                "risk_controls": {
                    "stop_loss_pct": 3.0,
                    "take_profit_pct": 2.0,
                    "max_holding_days": 7,
                    "max_position_size_pct": 3.0,
                    "max_loss_pct": 0.5,
                    "trailing_stop_pct": None,
                },
            },
            "forex": {
                "enabled": True,
                "allocation_pct": 33.34,
                "entry_rules": {
                    "min_volatility": 50,
                    "min_atr": 50,
                    "grid_step_pct": 0.0015,
                    "grid_max_legs_per_pair": 3,
                    "grid_take_profit_steps": 1,
                },
                "exit_rules": {
                    "profit_target_pips": 30,
                    "stop_loss_pips": 15,
                    "max_holding_hours": 24,
                },
                "risk_controls": {
                    "stop_loss_pct": 1.5,
                    "take_profit_pct": 3.0,
                    "max_holding_days": 1,
                    "max_position_size_pct": 2.0,
                    "max_loss_pct": 0.5,
                    "trailing_stop_pct": None,
                },
            },
        }
    
    def load_strategy_config(self, strategy_name: str) -> Dict[str, Any]:
        """Load strategy configuration."""
        config = self.load_user_config()
        strategies = config.get("strategies", {})
        
        if strategy_name in strategies:
            return strategies[strategy_name]
        
        # Return defaults
        defaults = self.get_strategy_defaults()
        return defaults.get(strategy_name, {})
    
    def save_strategy_config(self, strategy_name: str, config: Dict[str, Any]) -> None:
        """Save strategy configuration."""
        user_config = self.load_user_config()
        if "strategies" not in user_config:
            user_config["strategies"] = {}
        
        user_config["strategies"][strategy_name] = config
        self.save_user_config(user_config)
