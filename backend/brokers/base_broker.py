"""
Abstract base broker interface for API agnostic trading.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from typing import Optional, List, Dict, Any


@dataclass
class Position:
    """Representation of an open position."""
    symbol: str
    quantity: float
    avg_price: float
    current_price: float
    pnl: float
    pnl_pct: float
    asset_type: str  # 'stock', 'option', 'forex'


@dataclass
class Order:
    """Representation of a trade order."""
    order_id: str
    symbol: str
    side: str  # 'buy' or 'sell'
    order_type: str  # 'market', 'limit'
    quantity: float
    price: Optional[float]
    status: str  # 'submitted', 'filled', 'cancelled'
    filled_qty: float = 0.0
    filled_price: Optional[float] = None
    timestamp: datetime = None


@dataclass
class AccountSnapshot:
    """Account summary snapshot."""
    total_value: float
    cash: float
    buying_power: float
    total_pnl: float
    total_pnl_pct: float
    positions: List[Position]
    daily_pnl: float = 0.0
    daily_pnl_pct: float = 0.0
    currency: str = "USD"


class BaseBroker(ABC):
    """Abstract base class for broker integrations."""
    
    @abstractmethod
    async def connect(self) -> bool:
        """Establish connection to broker."""
        pass
    
    @abstractmethod
    async def disconnect(self) -> bool:
        """Close connection to broker."""
        pass
    
    @abstractmethod
    async def get_account_snapshot(self) -> AccountSnapshot:
        """Get current account state."""
        pass
    
    @abstractmethod
    async def get_positions(self) -> List[Position]:
        """Get list of open positions."""
        pass
    
    @abstractmethod
    async def get_position(self, symbol: str) -> Optional[Position]:
        """Get a specific position."""
        pass
    
    @abstractmethod
    async def place_order(self, symbol: str, side: str, quantity: float, 
                         order_type: str = "market", price: Optional[float] = None) -> Order:
        """Place a new order."""
        pass
    
    @abstractmethod
    async def cancel_order(self, order_id: str) -> bool:
        """Cancel an open order."""
        pass
    
    @abstractmethod
    async def get_order_status(self, order_id: str) -> Order:
        """Get status of an order."""
        pass
    
    @abstractmethod
    async def get_quote(self, symbol: str) -> Dict[str, float]:
        """Get current price quote for a symbol."""
        pass
    
    @abstractmethod
    async def get_historical_data(self, symbol: str, bar_size: str = "day", 
                                 lookback_days: int = 30) -> List[Dict[str, Any]]:
        """Get historical OHLCV data."""
        pass
    
    @abstractmethod
    async def get_option_chain(self, symbol: str, expiry: str = None) -> Dict[str, Any]:
        """Get option chain data for underlying."""
        pass
    
    @abstractmethod
    async def get_fundamental_data(self, symbol: str) -> Dict[str, Any]:
        """Get fundamental data (P/E, market cap, volume, etc.)."""
        pass


class BrokerFactory:
    """Factory for creating broker instances."""
    
    _brokers = {}
    
    @classmethod
    def register_broker(cls, name: str, broker_class):
        """Register a broker implementation."""
        cls._brokers[name] = broker_class
    
    @classmethod
    def create_broker(cls, broker_type: str, **kwargs) -> BaseBroker:
        """Create a broker instance."""
        if broker_type not in cls._brokers:
            raise ValueError(f"Unknown broker type: {broker_type}")
        return cls._brokers[broker_type](**kwargs)
    
    @classmethod
    def get_available_brokers(cls) -> List[str]:
        """Get list of available broker types."""
        return list(cls._brokers.keys())
