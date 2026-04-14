"""
Interactive Brokers (IBKR) implementation using ib_insync.
Supports paper trading API for demo purposes.
"""
import asyncio
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta, timezone
import logging
import re
import math

from ib_insync import IB, Stock, Option, Forex, Contract, Index, MarketOrder, LimitOrder
import pandas as pd
import yfinance as yf

from .base_broker import BaseBroker, Position, Order, AccountSnapshot, BrokerFactory

logger = logging.getLogger(__name__)


class IBKRBroker(BaseBroker):
    """Interactive Brokers integration using ib_insync."""
    
    def __init__(self, host: str = "127.0.0.1", port: int = 7497, 
                 client_id: int = 100, paper_trading: bool = True):
        self.host = host
        self.port = port  # 7497 = paper, 7496 = live
        self.client_id = client_id
        self.paper_trading = paper_trading
        self.ib = IB()
        self.connected = False
    
    async def connect(self) -> bool:
        """Connect to IB Gateway/TWS on paper trading port."""
        try:
            await self.ib.connectAsync(self.host, self.port, clientId=self.client_id, timeout=10)
            await asyncio.sleep(0.2)
            self.connected = self.ib.isConnected()
            logger.info(f"IBKR Connected: {self.connected}")
            return self.connected
        except Exception as e:
            logger.error(f"IBKR Connection failed: {e}")
            self.connected = False
            return False
    
    async def disconnect(self) -> bool:
        """Disconnect from IB."""
        try:
            self.ib.disconnect()
            self.connected = False
            return True
        except Exception as e:
            logger.error(f"IBKR Disconnect failed: {e}")
            return False
    
    async def get_account_snapshot(self) -> AccountSnapshot:
        """Get account summary from IB."""
        try:
            account_summary = await self.ib.accountSummaryAsync()
            account_id = self.ib.managedAccounts()[0] if self.ib.managedAccounts() else None

            # Pick display currency from available NetLiquidation rows.
            netliq_rows = [
                row for row in account_summary
                if row.tag == "NetLiquidation" and (account_id is None or row.account == account_id)
            ]
            currencies = {row.currency: float(row.value) for row in netliq_rows if row.value not in {None, ""}}
            display_currency = "HKD" if "HKD" in currencies else ("BASE" if "BASE" in currencies else (next(iter(currencies), "USD")))

            total_value = float(self._get_account_value(account_summary, "NetLiquidation", account_id, display_currency))
            cash = float(self._get_account_value(account_summary, "TotalCashValue", account_id, display_currency))

            buying_power = float(self._get_account_value(account_summary, "BuyingPower", account_id, display_currency))
            if buying_power == 0:
                buying_power = float(self._get_account_value(account_summary, "AvailableFunds", account_id, display_currency))

            # Keep snapshot path lightweight; positions are retrieved via dedicated endpoint.
            positions: List[Position] = []

            realized = float(self._get_account_value(account_summary, "RealizedPnL", account_id, display_currency))
            unrealized = float(self._get_account_value(account_summary, "UnrealizedPnL", account_id, display_currency))
            total_pnl = realized + unrealized
            base_capital = max(total_value - total_pnl, 1e-9)
            total_pnl_pct = (total_pnl / base_capital) * 100 if total_pnl != 0 else 0
            realized_pct = (realized / base_capital) * 100 if realized != 0 else 0
            unrealized_pct = (unrealized / base_capital) * 100 if unrealized != 0 else 0
            
            return AccountSnapshot(
                total_value=total_value,
                cash=cash,
                buying_power=buying_power,
                total_pnl=total_pnl,
                total_pnl_pct=total_pnl_pct,
                realized_pnl=realized,
                realized_pnl_pct=realized_pct,
                unrealized_pnl=unrealized,
                unrealized_pnl_pct=unrealized_pct,
                positions=positions,
                currency=("HKD" if display_currency == "BASE" and "HKD" in currencies else display_currency),
            )
        except Exception as e:
            logger.error(f"Failed to get account snapshot: {e}")
            return AccountSnapshot(0, 0, 0, 0, 0, positions=[])
    
    async def get_positions(self) -> List[Position]:
        """Get list of open positions."""
        try:
            positions = self.ib.positions()
            result = []

            contracts = []
            for pos in positions:
                contract = getattr(pos, "contract", None)
                if contract is None:
                    continue
                contracts.append(self._normalize_contract_for_quote(contract))
            price_by_conid: Dict[int, float] = {}

            if contracts:
                # Request one contract at a time so one malformed/permission-denied symbol
                # does not block the entire positions payload.
                for contract in contracts:
                    try:
                        tickers = await asyncio.wait_for(self.ib.reqTickersAsync(contract), timeout=1.5)
                    except Exception:
                        continue

                    for ticker in tickers or []:
                        ticker_contract = getattr(ticker, "contract", None)
                        con_id = int(getattr(ticker_contract, "conId", 0) or 0) if ticker_contract is not None else 0
                        if con_id <= 0:
                            continue

                        bid = float(getattr(ticker, "bid", 0.0) or 0.0)
                        ask = float(getattr(ticker, "ask", 0.0) or 0.0)
                        last = float(getattr(ticker, "last", 0.0) or 0.0)
                        close = float(getattr(ticker, "close", 0.0) or 0.0)

                        px = (bid + ask) / 2 if bid > 0 and ask > 0 else (last if last > 0 else close)
                        if px > 0:
                            price_by_conid[con_id] = px
            
            for pos in positions:
                contract = pos.contract
                qty = float(getattr(pos, "position", 0.0) or 0.0)
                avg_price = float(getattr(pos, "avgCost", 0.0) or 0.0)
                con_id = int(getattr(contract, "conId", 0) or 0)
                current_price = float(price_by_conid.get(con_id, 0.0) or 0.0)
                if not math.isfinite(float(current_price or 0.0)):
                    current_price = avg_price
                if current_price <= 0:
                    try:
                        current_price = float(await self._get_market_price(contract) or 0.0)
                    except Exception:
                        current_price = 0.0
                if current_price <= 0:
                    current_price = avg_price
                basis = avg_price * qty
                market_value = current_price * qty if current_price > 0 else basis
                pnl = market_value - basis
                pnl_pct = (pnl / abs(basis)) * 100 if basis else 0
                symbol = contract.symbol
                if str(getattr(contract, "secType", "")).upper() == "CASH":
                    base = str(getattr(contract, "symbol", "") or "").upper()
                    quote = str(getattr(contract, "currency", "") or "").upper()
                    if base and quote:
                        symbol = f"{base}{quote}"
                
                position = Position(
                    symbol=symbol,
                    quantity=qty,
                    avg_price=avg_price,
                    current_price=current_price,
                    pnl=pnl,
                    pnl_pct=pnl_pct,
                    asset_type=self._get_asset_type(contract),
                )
                result.append(position)
            
            return result
        except Exception as e:
            logger.error(f"Failed to get positions: {e}")
            return []
    
    async def get_position(self, symbol: str) -> Optional[Position]:
        """Get a specific position."""
        positions = await self.get_positions()
        for pos in positions:
            if pos.symbol == symbol:
                return pos
        return None
    
    async def place_order(self, symbol: str, side: str, quantity: float,
                         order_type: str = "market", price: Optional[float] = None) -> Order:
        """Place a market or limit order."""
        try:
            contract = Stock(symbol, "SMART", "USD")
            qualified = await self.ib.qualifyContractsAsync(contract)
            if qualified:
                contract = qualified[0]
            
            if order_type == "market":
                order = self.ib.placeOrder(contract, MarketOrder(side.upper(), quantity))
            else:  # limit
                order = self.ib.placeOrder(contract, LimitOrder(side.upper(), quantity, price))
            
            return Order(
                order_id=str(order.orderId),
                symbol=symbol,
                side=side,
                order_type=order_type,
                quantity=quantity,
                price=price,
                status="submitted",
                timestamp=datetime.now(),
            )
        except Exception as e:
            logger.error(f"Failed to place order: {e}")
            return None

    async def place_forex_order(self, pair: str, side: str, quantity: int) -> Optional[Order]:
        """Place a forex market order (IBKR paper/live depending on current session)."""
        try:
            normalized = str(pair or "").upper().replace("=X", "")
            if not normalized:
                return None

            contract = Forex(normalized)
            qualified = await self.ib.qualifyContractsAsync(contract)
            if qualified:
                contract = qualified[0]
            contract = self._normalize_contract_for_quote(contract)

            trade = self.ib.placeOrder(contract, MarketOrder(side.upper(), int(quantity), tif="IOC"))
            return Order(
                order_id=str(trade.order.orderId),
                symbol=normalized,
                side=side.lower(),
                order_type="market",
                quantity=float(quantity),
                price=None,
                status="submitted",
                timestamp=datetime.now(),
            )
        except Exception as e:
            logger.error("Failed to place forex order %s %s: %s", pair, side, e)
            return None

    async def place_crypto_order(self, symbol: str, side: str, quantity: float) -> Optional[Order]:
        """Place a crypto market order through IBKR's PAXOS venue when available."""
        try:
            normalized = str(symbol or "").upper().strip()
            if not normalized or "-" not in normalized:
                return None

            base, quote = normalized.split("-", 1)
            contract = Contract(secType="CRYPTO", symbol=base, currency=quote, exchange="PAXOS")
            qualified = await self.ib.qualifyContractsAsync(contract)
            if qualified:
                contract = qualified[0]
            contract = self._normalize_contract_for_quote(contract)

            side_upper = side.upper()
            if side_upper == "BUY":
                # IBKR crypto market buys require cashQty in quote currency (USD).
                notional_usd = 0.0
                try:
                    tickers = await self.ib.reqTickersAsync(contract)
                    if tickers:
                        t = tickers[0]
                        bid = float(getattr(t, "bid", 0.0) or 0.0)
                        ask = float(getattr(t, "ask", 0.0) or 0.0)
                        last = float(getattr(t, "last", 0.0) or 0.0)
                        px = (bid + ask) / 2 if bid > 0 and ask > 0 else last
                        if px > 0:
                            notional_usd = float(quantity) * px
                except Exception:
                    notional_usd = 0.0

                if notional_usd <= 0:
                    # Fallback interprets quantity as a USD notional when price is unavailable.
                    notional_usd = float(quantity)

                order = MarketOrder(side_upper, 0)
                order.cashQty = round(max(notional_usd, 10.0), 2)
                order.tif = "IOC"
                trade = self.ib.placeOrder(contract, order)
            else:
                trade = self.ib.placeOrder(contract, MarketOrder(side_upper, float(quantity), tif="IOC"))
            return Order(
                order_id=str(trade.order.orderId),
                symbol=normalized,
                side=side.lower(),
                order_type="market",
                quantity=float(quantity),
                price=None,
                status="submitted",
                timestamp=datetime.now(),
            )
        except Exception as e:
            logger.error("Failed to place crypto order %s %s: %s", symbol, side, e)
            return None

    async def sell_covered_call(
        self,
        symbol: str,
        expiry: str,
        strike: float,
        contracts: int = 1,
        limit_price: Optional[float] = None,
    ) -> Optional[Order]:
        """Submit a covered-call sell order on IBKR.

        Note: caller is responsible for ensuring sufficient underlying shares.
        """
        try:
            if contracts <= 0:
                return None

            contract = Option(symbol, expiry, float(strike), "C", "SMART")
            qualified = await self.ib.qualifyContractsAsync(contract)
            if qualified:
                contract = qualified[0]

            if limit_price is not None and float(limit_price) > 0:
                ib_order = LimitOrder("SELL", contracts, float(limit_price))
                order_type = "limit"
                order_price = float(limit_price)
            else:
                ib_order = MarketOrder("SELL", contracts)
                order_type = "market"
                order_price = None

            trade = self.ib.placeOrder(contract, ib_order)

            return Order(
                order_id=str(trade.order.orderId),
                symbol=symbol,
                side="sell",
                order_type=order_type,
                quantity=float(contracts),
                price=order_price,
                status="submitted",
                timestamp=datetime.now(),
            )
        except Exception as e:
            logger.error(
                "Failed to submit covered call for %s %s C %.2f: %s",
                symbol,
                expiry,
                strike,
                e,
            )
            return None
    
    async def cancel_order(self, order_id: str) -> bool:
        """Cancel an order."""
        try:
            self.ib.cancelOrder(int(order_id))
            return True
        except Exception as e:
            logger.error(f"Failed to cancel order: {e}")
            return False
    
    async def get_order_status(self, order_id: str) -> Optional[Order]:
        """Get order status."""
        try:
            trades = self.ib.trades()
            for trade in trades:
                if str(trade.order.orderId) == order_id:
                    return Order(
                        order_id=order_id,
                        symbol=trade.contract.symbol,
                        side="buy" if trade.order.action == "BUY" else "sell",
                        order_type="market" if trade.order.orderType == "MKT" else "limit",
                        quantity=trade.order.totalQuantity,
                        price=trade.order.lmtPrice if hasattr(trade.order, 'lmtPrice') else None,
                        status=trade.orderStatus.status.lower(),
                        filled_qty=trade.orderStatus.filled,
                    )
            return None
        except Exception as e:
            logger.error(f"Failed to get order status: {e}")
            return None
    
    async def get_quote(self, symbol: str) -> Dict[str, float]:
        """Get current market quote."""
        try:
            contract = Stock(symbol, "SMART", "USD")
            qualified = await self.ib.qualifyContractsAsync(contract)
            if qualified:
                contract = qualified[0]
            tickers = await self.ib.reqTickersAsync(contract)
            if not tickers:
                market_price = await self._get_market_price(contract)
                if market_price > 0:
                    return {
                        "symbol": symbol,
                        "bid": market_price,
                        "ask": market_price,
                        "last": market_price,
                        "mid": market_price,
                    }
                return {}
            ticker = tickers[0]
            bid = float(getattr(ticker, "bid", 0.0) or 0.0)
            ask = float(getattr(ticker, "ask", 0.0) or 0.0)
            last = float(getattr(ticker, "last", 0.0) or 0.0)
            mid = (bid + ask) / 2 if bid > 0 and ask > 0 else (last if last > 0 else 0.0)
            
            return {
                "symbol": symbol,
                "bid": bid,
                "ask": ask,
                "last": last,
                "mid": mid,
            }
        except Exception as e:
            logger.error(f"Failed to get quote for {symbol}: {e}")
            return {}
    
    async def get_historical_data(self, symbol: str, bar_size: str = "1 day",
                                 lookback_days: int = 30) -> List[Dict[str, Any]]:
        """Get OHLCV data."""
        try:
            contract = Stock(symbol, "SMART", "USD")
            qualified = await self.ib.qualifyContractsAsync(contract)
            if qualified:
                contract = qualified[0]
            bars = await self.ib.reqHistoricalDataAsync(
                contract,
                endDateTime="",
                durationStr=f"{lookback_days} D",
                barSizeSetting=bar_size,
                whatToShow="TRADES",
                useRTH=True,
            )
            
            result = []
            for bar in bars:
                result.append({
                    "timestamp": bar.date,
                    "open": float(bar.open),
                    "high": float(bar.high),
                    "low": float(bar.low),
                    "close": float(bar.close),
                    "volume": int(bar.volume),
                })
            return result
        except Exception as e:
            logger.error(f"Failed to get historical data for {symbol}: {e}")
            return []
    
    async def get_option_chain(self, symbol: str, expiry: str = None) -> Dict[str, Any]:
        """Get option chain for underlying."""
        try:
            contract = Stock(symbol, "SMART", "USD")
            qualified = await self.ib.qualifyContractsAsync(contract)
            if qualified:
                contract = qualified[0]
            if hasattr(self.ib, "reqSecDefOptParamsAsync"):
                chains = await self.ib.reqSecDefOptParamsAsync(symbol, "", "STK", contract.conId)
            else:
                chains = self.ib.reqSecDefOptParams(symbol, "", "STK", contract.conId)
            
            if not chains:
                return {}
            
            chain = chains[0]
            return {
                "symbol": symbol,
                "expirations": list(chain.expirations),
                "strikes": list(chain.strikes),
                "options_exchange": chain.exchange,
            }
        except Exception as e:
            logger.error(f"Failed to get option chain for {symbol}: {e}")
            return {}
    
    async def get_fundamental_data(self, symbol: str) -> Dict[str, Any]:
        """Get fundamental data from IBKR."""
        try:
            contract = Stock(symbol, "SMART", "USD")
            details = self.ib.reqFundamentalData(contract, "ReportsFinSummary")
            # Parsing fundamentals requires custom XML parsing
            # For now, return mock data
            return {
                "symbol": symbol,
                "pe_ratio": None,  # Would parse from details
                "forward_pe": None,
                "market_cap": None,
                "volume_avg_20d": None,
            }
        except Exception as e:
            logger.error(f"Failed to get fundamental data for {symbol}: {e}")
            return {}

    async def get_trade_logs(self, days: int = 30, asset_type: str = "all", status: str = "all") -> List[Dict[str, Any]]:
        """Return normalized recent trade logs from IBKR fills."""
        try:
            since = datetime.now(timezone.utc) - timedelta(days=max(1, int(days)))
            fills = self.ib.fills() or []
            rows: List[Dict[str, Any]] = []

            for fill in fills:
                execution = getattr(fill, "execution", None)
                contract = getattr(fill, "contract", None)
                commission_report = getattr(fill, "commissionReport", None)

                if execution is None or contract is None:
                    continue

                ts = execution.time if isinstance(execution.time, datetime) else datetime.now(timezone.utc)
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)
                if ts < since:
                    continue

                sec_type = str(getattr(contract, "secType", "STK")).upper()
                if sec_type == "OPT":
                    normalized_type = "option"
                elif sec_type == "CRYPTO":
                    normalized_type = "crypto"
                elif sec_type in {"CASH", "FX"}:
                    normalized_type = "forex"
                else:
                    normalized_type = "stock"

                symbol = str(getattr(contract, "localSymbol", None) or getattr(contract, "symbol", ""))
                underlying = str(getattr(contract, "symbol", symbol))

                if normalized_type == "option":
                    m = re.match(r"^([A-Z]{1,6})", symbol)
                    if m:
                        underlying = m.group(1)

                qty = abs(float(getattr(execution, "shares", 0.0) or 0.0))
                price = float(getattr(execution, "price", 0.0) or 0.0)
                raw_side = str(getattr(execution, "side", "") or "").strip().upper()
                if raw_side in {"BOT", "BUY"}:
                    side = "buy"
                elif raw_side in {"SLD", "SELL"}:
                    side = "sell"
                else:
                    side = "buy"
                fees = float(getattr(commission_report, "commission", 0.0) or 0.0)

                row = {
                    "trade_id": str(getattr(execution, "execId", "")) or str(getattr(execution, "permId", "")),
                    "timestamp": ts.isoformat(),
                    "strategy": "broker_fill",
                    "asset_type": normalized_type,
                    "symbol": symbol,
                    "underlying": underlying,
                    "side": side,
                    "quantity": qty,
                    "entry_price": price,
                    "exit_price": None,
                    "fees": fees,
                    "gross_pnl": 0.0,
                    "net_pnl": -fees,
                    "status": "closed",
                    "notes": "IBKR fill",
                }
                rows.append(row)

            if asset_type != "all":
                rows = [r for r in rows if str(r.get("asset_type", "")).lower() == asset_type]
            if status != "all":
                rows = [r for r in rows if str(r.get("status", "")).lower() == status]

            rows.sort(key=lambda r: r.get("timestamp", ""), reverse=True)
            return rows
        except Exception as e:
            logger.error("Failed to get IBKR trade logs: %s", e)
            return []

    async def quick_forex_round_trips(self, rounds: int = 6, quantity: int = 1000) -> List[Dict[str, Any]]:
        """Submit tiny IBKR paper forex round trips and return normalized records."""
        rows: List[Dict[str, Any]] = []
        now = datetime.now()

        safe_rounds = max(2, min(int(rounds), 12))
        safe_qty = max(1000, min(int(quantity), 5000))
        pairs = ["EURUSD", "GBPUSD", "AUDUSD", "NZDUSD"]

        for idx in range(safe_rounds):
            pair = pairs[idx % len(pairs)]
            side = "buy" if idx % 2 == 0 else "sell"
            close_side = "sell" if side == "buy" else "buy"

            try:
                contract = Forex(pair)
                qualified = await self.ib.qualifyContractsAsync(contract)
                if qualified:
                    contract = qualified[0]

                entry = 0.0
                try:
                    tickers = await self.ib.reqTickersAsync(contract)
                    if tickers:
                        t = tickers[0]
                        bid = float(getattr(t, "bid", 0.0) or 0.0)
                        ask = float(getattr(t, "ask", 0.0) or 0.0)
                        last = float(getattr(t, "last", 0.0) or 0.0)
                        entry = (bid + ask) / 2.0 if bid > 0 and ask > 0 else last
                except Exception:
                    entry = 0.0
                if not entry:
                    entry = {"EURUSD": 1.08, "GBPUSD": 1.27, "AUDUSD": 0.66, "NZDUSD": 0.60}.get(pair, 1.0)

                open_trade = self.ib.placeOrder(contract, MarketOrder(side.upper(), safe_qty))
                await asyncio.sleep(0.8)
                close_trade = self.ib.placeOrder(contract, MarketOrder(close_side.upper(), safe_qty))
                await asyncio.sleep(0.8)

                exit_price = entry
                try:
                    tickers = await self.ib.reqTickersAsync(contract)
                    if tickers:
                        t = tickers[0]
                        bid = float(getattr(t, "bid", 0.0) or 0.0)
                        ask = float(getattr(t, "ask", 0.0) or 0.0)
                        last = float(getattr(t, "last", 0.0) or 0.0)
                        px = (bid + ask) / 2.0 if bid > 0 and ask > 0 else last
                        if px > 0:
                            exit_price = px
                except Exception:
                    pass
                fees = round(0.8 + safe_qty * 0.00003, 2)
                gross = (exit_price - entry) * safe_qty if side == "buy" else (entry - exit_price) * safe_qty
                gross = round(float(gross), 2)
                net = round(gross - fees, 2)

                rows.append(
                    {
                        "trade_id": f"TRYLIVE-{now.strftime('%Y%m%d%H%M%S')}-{idx + 1:02d}",
                        "timestamp": datetime.now().isoformat(),
                        "strategy": "try_buy_sell_live",
                        "asset_type": "forex",
                        "symbol": pair,
                        "underlying": pair,
                        "side": side,
                        "quantity": safe_qty,
                        "entry_price": round(float(entry), 5),
                        "exit_price": round(float(exit_price), 5),
                        "fees": fees,
                        "gross_pnl": gross,
                        "net_pnl": net,
                        "status": "closed",
                        "order_submitted": True,
                        "execution_origin": "live_paper",
                        "is_simulated": False,
                        "notes": (
                            "Tiny live paper round-trip via IBKR"
                            f" (open_id={getattr(getattr(open_trade, 'order', None), 'orderId', 'n/a')},"
                            f" close_id={getattr(getattr(close_trade, 'order', None), 'orderId', 'n/a')})"
                        ),
                    }
                )
            except Exception as e:
                logger.error("Failed live paper round trip for %s: %s", pair, e)
                rows.append(
                    {
                        "trade_id": f"TRYLIVE-{now.strftime('%Y%m%d%H%M%S')}-{idx + 1:02d}-FAILED",
                        "timestamp": datetime.now().isoformat(),
                        "strategy": "try_buy_sell_live",
                        "asset_type": "forex",
                        "symbol": pair,
                        "underlying": pair,
                        "side": side,
                        "quantity": safe_qty,
                        "entry_price": 0.0,
                        "exit_price": None,
                        "fees": 0.0,
                        "gross_pnl": 0.0,
                        "net_pnl": 0.0,
                        "status": "closed",
                        "order_submitted": False,
                        "execution_origin": "live_paper",
                        "is_simulated": False,
                        "notes": f"Live paper submission failed: {e}",
                    }
                )

        return rows
    
    def _get_account_value(self, account_summary, key: str, account_id: Optional[str] = None, currency: Optional[str] = None) -> float:
        """Extract value from account summary."""
        for item in account_summary:
            if item.tag != key:
                continue
            if account_id and item.account != account_id:
                continue
            if currency and item.currency != currency:
                continue
            try:
                return float(item.value)
            except Exception:
                continue

        # Fallback to matching tag+account regardless of currency.
        for item in account_summary:
            if item.tag == key and (not account_id or item.account == account_id):
                try:
                    return float(item.value)
                except Exception:
                    continue
        return 0.0
    
    async def _get_market_price(self, contract: Contract) -> float:
        """Get current market price for a contract."""
        try:
            normalized = contract
            try:
                qualified = await self.ib.qualifyContractsAsync(contract)
                if qualified:
                    normalized = qualified[0]
            except Exception:
                pass

            normalized = self._normalize_contract_for_quote(normalized)

            tickers = await self.ib.reqTickersAsync(normalized)
            if not tickers:
                return float(getattr(contract, "strike", 0.0) or 0.0)

            ticker = tickers[0]
            bid = float(getattr(ticker, "bid", 0.0) or 0.0)
            ask = float(getattr(ticker, "ask", 0.0) or 0.0)
            if bid > 0 and ask > 0:
                return (bid + ask) / 2
            last = float(getattr(ticker, "last", 0.0) or 0.0)
            if last > 0:
                return last

            close = float(getattr(ticker, "close", 0.0) or 0.0)
            if close > 0:
                return close

            sec_type = str(getattr(normalized, "secType", "") or "").upper()
            symbol = str(getattr(normalized, "symbol", "") or "").upper().strip()
            currency = str(getattr(normalized, "currency", "") or "").upper().strip()
            yf_symbol = None
            if sec_type == "CASH" and symbol and currency:
                yf_symbol = f"{symbol}{currency}=X"
            elif sec_type == "STK" and symbol:
                yf_symbol = symbol
            elif sec_type == "CRYPTO" and symbol and currency:
                yf_symbol = f"{symbol}-{currency}"

            if yf_symbol:
                try:
                    yf_ticker = yf.Ticker(yf_symbol)

                    fast_info = getattr(yf_ticker, "fast_info", None)
                    for key in ("lastPrice", "regularMarketPrice", "previousClose"):
                        try:
                            value = getattr(fast_info, key, None) if fast_info is not None else None
                            if value is None and hasattr(fast_info, "get"):
                                value = fast_info.get(key)
                            fast_value = float(value) if value is not None else 0.0
                            if fast_value > 0:
                                return fast_value
                        except Exception:
                            continue

                    try:
                        info = yf_ticker.info or {}
                        for key in ("regularMarketPrice", "currentPrice", "previousClose"):
                            info_value = float(info.get(key) or 0.0)
                            if info_value > 0:
                                return info_value
                    except Exception:
                        pass

                    for period, interval in (("5d", "1d"), ("1d", "5m"), ("1d", "1m")):
                        hist = yf_ticker.history(period=period, interval=interval, auto_adjust=False)
                        if hist is not None and not hist.empty:
                            close_series = hist.get("Close")
                            if close_series is not None and len(close_series) > 0:
                                close_value = float(close_series.dropna().iloc[-1])
                                if close_value > 0:
                                    return close_value
                except Exception:
                    pass

            return 0.0
        except Exception:
            return 0.0

    def _normalize_contract_for_quote(self, contract: Contract) -> Contract:
        """Ensure a contract has an exchange accepted by IBKR market-data endpoints."""
        if contract is None:
            return contract

        try:
            sec_type = str(getattr(contract, "secType", "") or "").upper()
            exchange = str(getattr(contract, "exchange", "") or "").strip().upper()

            if sec_type == "CASH" and not exchange:
                contract.exchange = "IDEALPRO"
            elif sec_type == "STK" and not exchange:
                contract.exchange = "SMART"
            elif sec_type == "CRYPTO" and not exchange:
                contract.exchange = "PAXOS"
        except Exception:
            return contract

        return contract
    
    def _get_asset_type(self, contract: Contract) -> str:
        """Determine asset type from contract."""
        if isinstance(contract, Stock):
            return "stock"
        elif isinstance(contract, Option):
            return "option"
        elif isinstance(contract, Forex):
            return "forex"
        return "unknown"


# Register IBKR broker
BrokerFactory.register_broker("ibkr", IBKRBroker)
