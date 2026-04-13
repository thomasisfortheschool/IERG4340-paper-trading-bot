"""
Alpaca paper trading broker implementation.
Uses Alpaca REST APIs for account, positions, quotes, and orders.
"""
from datetime import datetime
from typing import Optional, List, Dict, Any
import logging
import re
import requests

from .base_broker import BaseBroker, Position, Order, AccountSnapshot, BrokerFactory

logger = logging.getLogger(__name__)


class AlpacaBroker(BaseBroker):
    """Alpaca paper trading broker implementation."""

    def __init__(
        self,
        api_key: str,
        api_secret: str,
        base_url: str = "https://paper-api.alpaca.markets",
        paper_trading: bool = True,
    ):
        self.api_key = api_key
        self.api_secret = api_secret
        self.base_url = base_url.rstrip("/")
        self.paper_trading = paper_trading
        self.connected = False

    def _headers(self) -> Dict[str, str]:
        return {
            "APCA-API-KEY-ID": self.api_key,
            "APCA-API-SECRET-KEY": self.api_secret,
            "Content-Type": "application/json",
        }

    async def connect(self) -> bool:
        """Validate connectivity by fetching Alpaca account."""
        try:
            resp = requests.get(
                f"{self.base_url}/v2/account",
                headers=self._headers(),
                timeout=15,
            )
            self.connected = resp.status_code == 200
            if not self.connected:
                logger.error("Alpaca connect failed: %s %s", resp.status_code, resp.text)
            return self.connected
        except Exception as e:
            logger.error("Alpaca connect failed: %s", e)
            self.connected = False
            return False

    async def disconnect(self) -> bool:
        self.connected = False
        return True

    async def get_account_snapshot(self) -> AccountSnapshot:
        try:
            account_resp = requests.get(
                f"{self.base_url}/v2/account",
                headers=self._headers(),
                timeout=15,
            )
            account_resp.raise_for_status()
            account = account_resp.json()

            positions = await self.get_positions()
            equity = float(account.get("equity") or 0.0)
            last_equity = float(account.get("last_equity") or equity or 0.0)
            daily_pnl = equity - last_equity
            daily_pnl_pct = (daily_pnl / last_equity * 100.0) if last_equity else 0.0
            unrealized_pnl = sum(float(position.pnl or 0.0) for position in positions)
            total_pnl = float(account.get("equity") or 0.0) - float(account.get("last_equity") or 0.0)
            realized_pnl = total_pnl - unrealized_pnl
            base_capital = max(equity - total_pnl, 1e-9)
            realized_pnl_pct = (realized_pnl / base_capital * 100.0) if realized_pnl else 0.0
            unrealized_pnl_pct = (unrealized_pnl / base_capital * 100.0) if unrealized_pnl else 0.0

            return AccountSnapshot(
                total_value=equity,
                cash=float(account.get("cash") or 0.0),
                buying_power=float(account.get("buying_power") or 0.0),
                total_pnl=total_pnl,
                total_pnl_pct=daily_pnl_pct,
                realized_pnl=realized_pnl,
                realized_pnl_pct=realized_pnl_pct,
                unrealized_pnl=unrealized_pnl,
                unrealized_pnl_pct=unrealized_pnl_pct,
                daily_pnl=daily_pnl,
                daily_pnl_pct=daily_pnl_pct,
                positions=positions,
            )
        except Exception as e:
            logger.error("Failed to get Alpaca account snapshot: %s", e)
            return AccountSnapshot(0.0, 0.0, 0.0, 0.0, 0.0, positions=[])

    async def get_positions(self) -> List[Position]:
        try:
            resp = requests.get(
                f"{self.base_url}/v2/positions",
                headers=self._headers(),
                timeout=15,
            )
            resp.raise_for_status()
            raw_positions = resp.json()

            result: List[Position] = []
            for p in raw_positions:
                qty = float(p.get("qty") or 0.0)
                avg_price = float(p.get("avg_entry_price") or 0.0)
                current_price = float(p.get("current_price") or 0.0)
                pnl = float(p.get("unrealized_pl") or 0.0)
                cost_basis = abs(avg_price * qty)
                pnl_pct = (pnl / cost_basis * 100.0) if cost_basis else 0.0

                result.append(
                    Position(
                        symbol=p.get("symbol", ""),
                        quantity=qty,
                        avg_price=avg_price,
                        current_price=current_price,
                        pnl=pnl,
                        pnl_pct=pnl_pct,
                        asset_type="stock",
                    )
                )
            return result
        except Exception as e:
            logger.error("Failed to get Alpaca positions: %s", e)
            return []

    async def get_position(self, symbol: str) -> Optional[Position]:
        try:
            resp = requests.get(
                f"{self.base_url}/v2/positions/{symbol}",
                headers=self._headers(),
                timeout=15,
            )
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            p = resp.json()
            qty = float(p.get("qty") or 0.0)
            avg_price = float(p.get("avg_entry_price") or 0.0)
            current_price = float(p.get("current_price") or 0.0)
            pnl = float(p.get("unrealized_pl") or 0.0)
            cost_basis = abs(avg_price * qty)
            pnl_pct = (pnl / cost_basis * 100.0) if cost_basis else 0.0

            return Position(
                symbol=p.get("symbol", symbol),
                quantity=qty,
                avg_price=avg_price,
                current_price=current_price,
                pnl=pnl,
                pnl_pct=pnl_pct,
                asset_type="stock",
            )
        except Exception as e:
            logger.error("Failed to get Alpaca position %s: %s", symbol, e)
            return None

    async def place_order(
        self,
        symbol: str,
        side: str,
        quantity: float,
        order_type: str = "market",
        price: Optional[float] = None,
    ) -> Order:
        try:
            payload: Dict[str, Any] = {
                "symbol": symbol,
                "qty": str(quantity),
                "side": side.lower(),
                "type": order_type,
                "time_in_force": "day",
            }
            if order_type == "limit" and price is not None:
                payload["limit_price"] = str(price)

            resp = requests.post(
                f"{self.base_url}/v2/orders",
                headers=self._headers(),
                json=payload,
                timeout=15,
            )
            resp.raise_for_status()
            order = resp.json()

            return Order(
                order_id=order.get("id", ""),
                symbol=order.get("symbol", symbol),
                side=order.get("side", side),
                order_type=order.get("type", order_type),
                quantity=float(order.get("qty") or quantity),
                price=float(order.get("limit_price")) if order.get("limit_price") else price,
                status=order.get("status", "submitted"),
                filled_qty=float(order.get("filled_qty") or 0.0),
                filled_price=float(order.get("filled_avg_price")) if order.get("filled_avg_price") else None,
                timestamp=datetime.utcnow(),
            )
        except Exception as e:
            logger.error("Failed to place Alpaca order: %s", e)
            return Order(
                order_id="",
                symbol=symbol,
                side=side,
                order_type=order_type,
                quantity=quantity,
                price=price,
                status="failed",
                timestamp=datetime.utcnow(),
            )

    async def cancel_order(self, order_id: str) -> bool:
        try:
            resp = requests.delete(
                f"{self.base_url}/v2/orders/{order_id}",
                headers=self._headers(),
                timeout=15,
            )
            return resp.status_code in (200, 204)
        except Exception as e:
            logger.error("Failed to cancel Alpaca order %s: %s", order_id, e)
            return False

    async def get_order_status(self, order_id: str) -> Order:
        try:
            resp = requests.get(
                f"{self.base_url}/v2/orders/{order_id}",
                headers=self._headers(),
                timeout=15,
            )
            if resp.status_code == 404:
                return Order(
                    order_id=order_id,
                    symbol="",
                    side="",
                    order_type="market",
                    quantity=0.0,
                    price=None,
                    status="not_found",
                    timestamp=datetime.utcnow(),
                )
            resp.raise_for_status()
            order = resp.json()
            return Order(
                order_id=order.get("id", order_id),
                symbol=order.get("symbol", ""),
                side=order.get("side", ""),
                order_type=order.get("type", "market"),
                quantity=float(order.get("qty") or 0.0),
                price=float(order.get("limit_price")) if order.get("limit_price") else None,
                status=order.get("status", "unknown"),
                filled_qty=float(order.get("filled_qty") or 0.0),
                filled_price=float(order.get("filled_avg_price")) if order.get("filled_avg_price") else None,
                timestamp=datetime.utcnow(),
            )
        except Exception as e:
            logger.error("Failed to get Alpaca order status %s: %s", order_id, e)
            return Order(
                order_id=order_id,
                symbol="",
                side="",
                order_type="market",
                quantity=0.0,
                price=None,
                status="error",
                timestamp=datetime.utcnow(),
            )

    async def get_quote(self, symbol: str) -> Dict[str, float]:
        try:
            # Alpaca market data endpoint
            resp = requests.get(
                f"https://data.alpaca.markets/v2/stocks/{symbol}/quotes/latest?feed=iex",
                headers=self._headers(),
                timeout=15,
            )
            resp.raise_for_status()
            quote = resp.json().get("quote", {})
            bid = float(quote.get("bp") or 0.0)
            ask = float(quote.get("ap") or 0.0)
            mid = (bid + ask) / 2.0 if bid and ask else 0.0
            return {
                "bid": bid,
                "ask": ask,
                "last": mid,
                "mid": mid,
            }
        except Exception as e:
            logger.error("Failed to get Alpaca quote for %s: %s", symbol, e)
            return {}

    async def get_historical_data(
        self,
        symbol: str,
        bar_size: str = "1Day",
        lookback_days: int = 30,
    ) -> List[Dict[str, Any]]:
        try:
            resp = requests.get(
                f"https://data.alpaca.markets/v2/stocks/{symbol}/bars",
                headers=self._headers(),
                params={
                    "timeframe": bar_size,
                    "limit": lookback_days,
                    "feed": "iex",
                },
                timeout=15,
            )
            resp.raise_for_status()
            bars = resp.json().get("bars", [])
            return [
                {
                    "timestamp": b.get("t"),
                    "open": float(b.get("o") or 0.0),
                    "high": float(b.get("h") or 0.0),
                    "low": float(b.get("l") or 0.0),
                    "close": float(b.get("c") or 0.0),
                    "volume": int(b.get("v") or 0),
                }
                for b in bars
            ]
        except Exception as e:
            logger.error("Failed to get Alpaca historical data for %s: %s", symbol, e)
            return []

    async def get_option_chain(self, symbol: str, expiry: Optional[str] = None) -> Dict[str, Any]:
        # Not implemented in this project for Alpaca.
        return {}

    async def get_fundamental_data(self, symbol: str) -> Dict[str, Any]:
        # Fundamentals are sourced from yfinance in this project.
        return {}

    async def get_trade_logs(self, days: int = 30, asset_type: str = "all", status: str = "all") -> List[Dict[str, Any]]:
        """Return normalized recent trade logs from Alpaca fill activities."""
        try:
            resp = requests.get(
                f"{self.base_url}/v2/account/activities",
                headers=self._headers(),
                params={
                    "activity_types": "FILL",
                    "direction": "desc",
                    "page_size": 200,
                },
                timeout=15,
            )
            resp.raise_for_status()
            activities = resp.json() or []

            cutoff = datetime.utcnow().timestamp() - max(1, int(days)) * 86400
            rows: List[Dict[str, Any]] = []

            for a in activities:
                ts_text = a.get("transaction_time") or a.get("date")
                if not ts_text:
                    continue

                try:
                    ts = datetime.fromisoformat(str(ts_text).replace("Z", "+00:00"))
                except Exception:
                    continue

                if ts.timestamp() < cutoff:
                    continue

                symbol = str(a.get("symbol") or "")
                if re.match(r"^[A-Z]{1,6}\d{6}[CP]\d{8}$", symbol):
                    normalized_type = "option"
                    underlying = symbol[:6].rstrip()
                else:
                    normalized_type = "stock"
                    underlying = symbol

                side = str(a.get("side") or "buy").lower()
                qty = abs(float(a.get("qty") or 0.0))
                price = float(a.get("price") or 0.0)

                row = {
                    "trade_id": str(a.get("id") or a.get("order_id") or ""),
                    "timestamp": ts.isoformat(),
                    "strategy": "broker_fill",
                    "asset_type": normalized_type,
                    "symbol": symbol,
                    "underlying": underlying,
                    "side": side,
                    "quantity": qty,
                    "entry_price": price,
                    "exit_price": None,
                    "fees": 0.0,
                    "gross_pnl": 0.0,
                    "net_pnl": 0.0,
                    "status": "closed",
                    "notes": "Alpaca fill",
                }
                rows.append(row)

            if asset_type != "all":
                rows = [r for r in rows if str(r.get("asset_type", "")).lower() == asset_type]
            if status != "all":
                rows = [r for r in rows if str(r.get("status", "")).lower() == status]

            rows.sort(key=lambda r: r.get("timestamp", ""), reverse=True)
            return rows
        except Exception as e:
            logger.error("Failed to get Alpaca trade logs: %s", e)
            return []


BrokerFactory.register_broker("alpaca", AlpacaBroker)
