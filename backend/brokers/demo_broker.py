"""
Live Demo Broker — a fully self-contained virtual broker.

No credentials or external connections needed. Orders are filled at real
market prices fetched from yfinance, and the portfolio state is held in
memory for the lifetime of the backend process.

Register it like any other broker so the bot strategies run against it
exactly the same way they would against IBKR or Alpaca.
"""
from __future__ import annotations

import math
import uuid
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import yfinance as yf

from brokers.base_broker import (
    AccountSnapshot,
    BaseBroker,
    BrokerFactory,
    Order,
    Position,
)

logger = logging.getLogger(__name__)

_DEMO_INITIAL_CAPITAL = 100_000.0
_FOREX_PAIRS = {
    "EURUSD": "EURUSD=X",
    "GBPUSD": "GBPUSD=X",
    "USDJPY": "USDJPY=X",
    "AUDUSD": "AUDUSD=X",
    "NZDUSD": "NZDUSD=X",
}

_DEMO_FALLBACK_PRICES = {
    "AAPL": 190.0,
    "MSFT": 420.0,
    "NVDA": 900.0,
    "TSLA": 180.0,
    "SPY": 510.0,
    "QQQ": 440.0,
    "EURUSD": 1.08,
    "GBPUSD": 1.27,
    "USDJPY": 155.0,
    "BTC-USD": 65000.0,
    "ETH-USD": 3200.0,
}


def _resolve_yf_ticker(symbol: str) -> str:
    """Map trading symbol to yfinance ticker string."""
    upper = symbol.strip().upper()
    if upper in _FOREX_PAIRS:
        return _FOREX_PAIRS[upper]
    if upper.endswith("=X"):
        return upper
    # Crypto symbols like BTC-USD, ETH-USD pass through as-is
    return upper


def _fetch_price(symbol: str) -> float:
    """Fetch the latest market price; falls back to stable demo prices."""
    ticker_str = _resolve_yf_ticker(symbol)
    cache_key = symbol.strip().upper().replace("=X", "")
    try:
        hist = yf.Ticker(ticker_str).history(period="5d", interval="1d")
        if hist is not None and not hist.empty and "Close" in hist.columns:
            closes = hist["Close"].dropna()
            if not closes.empty:
                return float(closes.iloc[-1])
    except Exception:
        pass
    try:
        hist = yf.Ticker(ticker_str).history(period="1d", interval="5m")
        if hist is not None and not hist.empty and "Close" in hist.columns:
            closes = hist["Close"].dropna()
            if not closes.empty:
                return float(closes.iloc[-1])
    except Exception:
        pass

    fallback = _DEMO_FALLBACK_PRICES.get(cache_key)
    if fallback and fallback > 0:
        return float(fallback)
    return 1.0


@dataclass
class _DemoLot:
    symbol: str
    side: str          # "buy" or "sell"
    quantity: float
    fill_price: float
    asset_type: str
    opened_at: datetime = field(default_factory=datetime.now)


class DemoBroker(BaseBroker):
    """
    Virtual paper-trading broker with no external dependencies.

    Starting capital: $100,000. All orders are filled immediately at the
    last yfinance close price. Portfolio state persists for the lifetime
    of the backend process.
    """

    def __init__(self, initial_capital: float = _DEMO_INITIAL_CAPITAL):
        self.initial_capital: float = float(initial_capital)
        self.cash: float = self.initial_capital
        self._lots: List[_DemoLot] = []
        self._orders: Dict[str, Order] = {}
        self._price_cache: Dict[str, tuple[float, datetime]] = {}
        self.connected: bool = False
        self._realized_pnl: float = 0.0
        self._trade_count: int = 0

    # ------------------------------------------------------------------
    # Connection lifecycle
    # ------------------------------------------------------------------

    async def connect(self) -> bool:
        self.connected = True
        logger.info("DemoBroker connected — $%.2f virtual capital", self.initial_capital)
        return True

    async def disconnect(self) -> bool:
        self.connected = False
        return True

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _get_price(self, symbol: str, max_age_seconds: float = 30.0) -> float:
        """Return cached price or fetch fresh one."""
        entry = self._price_cache.get(symbol)
        if entry is not None:
            price, ts = entry
            if (datetime.now() - ts).total_seconds() < max_age_seconds:
                return price
        price = _fetch_price(symbol)
        if price > 0:
            self._price_cache[symbol] = (price, datetime.now())
        return price

    def _detect_asset_type(self, symbol: str) -> str:
        upper = symbol.strip().upper()
        if upper in _FOREX_PAIRS or upper.endswith("=X"):
            return "forex"
        if "-USD" in upper or "-USDT" in upper:
            return "crypto"
        return "stock"

    def _build_positions(self) -> List[Position]:
        """Aggregate open lots into Position objects with live P&L."""
        aggregated: Dict[str, Dict[str, Any]] = {}
        for lot in self._lots:
            sym = lot.symbol
            if sym not in aggregated:
                aggregated[sym] = {
                    "symbol": sym,
                    "quantity": 0.0,
                    "cost_basis": 0.0,
                    "asset_type": lot.asset_type,
                }
            direction = 1.0 if lot.side == "buy" else -1.0
            aggregated[sym]["quantity"] += lot.quantity * direction
            aggregated[sym]["cost_basis"] += lot.fill_price * lot.quantity * direction

        positions: List[Position] = []
        for sym, agg in aggregated.items():
            net_qty = agg["quantity"]
            if abs(net_qty) < 1e-9:
                continue
            avg_price = abs(agg["cost_basis"] / net_qty) if abs(net_qty) > 1e-9 else 0.0
            current_price = self._get_price(sym)
            if current_price <= 0:
                current_price = avg_price

            if net_qty > 0:
                pnl = (current_price - avg_price) * net_qty
            else:
                pnl = (avg_price - current_price) * abs(net_qty)

            pnl_pct = (pnl / (avg_price * abs(net_qty)) * 100.0) if avg_price > 0 else 0.0

            positions.append(
                Position(
                    symbol=sym,
                    quantity=net_qty,
                    avg_price=round(avg_price, 5),
                    current_price=round(current_price, 5),
                    pnl=round(pnl, 2),
                    pnl_pct=round(pnl_pct, 4),
                    asset_type=agg["asset_type"],
                )
            )
        return positions

    # ------------------------------------------------------------------
    # BaseBroker — account & positions
    # ------------------------------------------------------------------

    async def get_account_snapshot(self) -> AccountSnapshot:
        positions = self._build_positions()
        unrealized = sum(p.pnl for p in positions)
        portfolio_value = sum(
            p.current_price * abs(p.quantity) for p in positions
        )
        total_value = self.cash + portfolio_value
        total_pnl = self._realized_pnl + unrealized
        total_pnl_pct = (total_pnl / self.initial_capital * 100.0) if self.initial_capital > 0 else 0.0

        return AccountSnapshot(
            total_value=round(total_value, 2),
            cash=round(self.cash, 2),
            buying_power=round(self.cash * 2.0, 2),   # 2× leverage limit
            total_pnl=round(total_pnl, 2),
            total_pnl_pct=round(total_pnl_pct, 4),
            positions=positions,
            realized_pnl=round(self._realized_pnl, 2),
            unrealized_pnl=round(unrealized, 2),
            daily_pnl=round(unrealized, 2),
            currency="USD",
        )

    async def get_positions(self) -> List[Position]:
        return self._build_positions()

    async def get_position(self, symbol: str) -> Optional[Position]:
        for pos in self._build_positions():
            if pos.symbol.upper() == symbol.upper():
                return pos
        return None

    # ------------------------------------------------------------------
    # BaseBroker — order management
    # ------------------------------------------------------------------

    async def place_order(
        self,
        symbol: str,
        side: str,
        quantity: float,
        order_type: str = "market",
        price: Optional[float] = None,
    ) -> Order:
        side = side.lower().strip()
        symbol = symbol.strip().upper()
        quantity = float(quantity)

        fill_price = price if (price and price > 0) else self._get_price(symbol)
        if fill_price <= 0:
            fill_price = 1.0  # Fallback to avoid division errors

        cost = fill_price * quantity
        asset_type = self._detect_asset_type(symbol)

        # Minimal risk check — don't blow up demo account
        if side == "buy" and cost > self.cash * 0.5 and asset_type != "forex":
            quantity = max(1.0, int(self.cash * 0.5 / fill_price))
            cost = fill_price * quantity

        order_id = f"DEMO-{uuid.uuid4().hex[:10].upper()}"
        now = datetime.now()

        # Apply fill
        if side == "buy":
            self.cash -= cost
            self._lots.append(
                _DemoLot(
                    symbol=symbol,
                    side="buy",
                    quantity=quantity,
                    fill_price=fill_price,
                    asset_type=asset_type,
                    opened_at=now,
                )
            )
        elif side == "sell":
            self.cash += cost
            # Close oldest matching buy lots (FIFO)
            remaining = quantity
            for lot in list(self._lots):
                if lot.symbol == symbol and lot.side == "buy" and remaining > 0:
                    close_qty = min(lot.quantity, remaining)
                    realized = (fill_price - lot.fill_price) * close_qty
                    self._realized_pnl += realized
                    lot.quantity -= close_qty
                    remaining -= close_qty
            self._lots = [l for l in self._lots if l.quantity > 1e-9]
            # If short — add a short lot for remaining quantity
            if remaining > 1e-9:
                self._lots.append(
                    _DemoLot(
                        symbol=symbol,
                        side="sell",
                        quantity=remaining,
                        fill_price=fill_price,
                        asset_type=asset_type,
                        opened_at=now,
                    )
                )

        self._trade_count += 1
        order = Order(
            order_id=order_id,
            symbol=symbol,
            side=side,
            order_type=order_type,
            quantity=quantity,
            price=fill_price,
            status="filled",
            filled_qty=quantity,
            filled_price=fill_price,
            timestamp=now,
        )
        self._orders[order_id] = order
        logger.info(
            "DemoBroker fill: %s %s %.2f × %s @ %.5f  cash_remaining=%.2f",
            side.upper(), symbol, quantity, asset_type, fill_price, self.cash,
        )
        return order

    async def cancel_order(self, order_id: str) -> bool:
        return False  # Demo orders fill instantly

    async def get_order_status(self, order_id: str) -> Order:
        if order_id in self._orders:
            return self._orders[order_id]
        return Order(
            order_id=order_id,
            symbol="UNKNOWN",
            side="buy",
            order_type="market",
            quantity=0,
            price=None,
            status="not_found",
        )

    # ------------------------------------------------------------------
    # BaseBroker — market data (delegate to yfinance)
    # ------------------------------------------------------------------

    async def get_quote(self, symbol: str) -> Dict[str, float]:
        price = self._get_price(symbol)
        return {
            "bid": round(price * 0.9999, 5),
            "ask": round(price * 1.0001, 5),
            "last": round(price, 5),
            "price": round(price, 5),
        }

    async def get_historical_data(
        self,
        symbol: str,
        bar_size: str = "day",
        lookback_days: int = 30,
    ) -> List[Dict[str, Any]]:
        ticker_str = _resolve_yf_ticker(symbol)
        try:
            hist = yf.Ticker(ticker_str).history(
                period=f"{max(5, min(lookback_days, 365))}d",
                interval="1d",
            )
            if hist is None or hist.empty:
                return []
            rows = []
            for ts, row in hist.iterrows():
                rows.append(
                    {
                        "date": str(ts.date()),
                        "open": round(float(row.get("Open", 0)), 5),
                        "high": round(float(row.get("High", 0)), 5),
                        "low": round(float(row.get("Low", 0)), 5),
                        "close": round(float(row.get("Close", 0)), 5),
                        "volume": float(row.get("Volume", 0)),
                    }
                )
            return rows
        except Exception as exc:
            logger.warning("DemoBroker historical data error for %s: %s", symbol, exc)
            return []

    async def get_option_chain(self, symbol: str, expiry: str = None) -> Dict[str, Any]:
        return {"error": "Options not supported in Live Demo mode", "symbol": symbol}

    async def get_fundamental_data(self, symbol: str) -> Dict[str, Any]:
        ticker_str = _resolve_yf_ticker(symbol)
        try:
            info = yf.Ticker(ticker_str).info or {}
            return {
                "symbol": symbol,
                "market_cap": info.get("marketCap"),
                "pe_ratio": info.get("trailingPE"),
                "forward_pe": info.get("forwardPE"),
                "revenue": info.get("totalRevenue"),
                "earnings_growth": info.get("earningsGrowth"),
                "revenue_growth": info.get("revenueGrowth"),
                "sector": info.get("sector"),
                "industry": info.get("industry"),
                "price": info.get("regularMarketPrice") or info.get("currentPrice"),
            }
        except Exception as exc:
            logger.warning("DemoBroker fundamental data error for %s: %s", symbol, exc)
            return {"symbol": symbol, "error": str(exc)}


# Register with the global BrokerFactory so build_and_connect_broker can find it
BrokerFactory.register_broker("demo", DemoBroker)
