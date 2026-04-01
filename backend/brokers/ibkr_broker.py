"""
Interactive Brokers (IBKR) implementation using ib_insync.
Supports paper trading API for demo purposes.
"""
import asyncio
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta
import logging

from ib_insync import IB, Stock, Option, Forex, Contract, Index
import pandas as pd

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
            self.ib.connect(self.host, self.port, clientId=self.client_id)
            await asyncio.sleep(1)  # Wait for connection
            self.connected = self.ib.isConnected()
            logger.info(f"IBKR Connected: {self.connected}")
            return self.connected
        except Exception as e:
            logger.error(f"IBKR Connection failed: {e}")
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
            account = self.ib.accountSummary()
            
            total_value = float(self._get_account_value(account, "NetLiquidation"))
            cash = float(self._get_account_value(account, "TotalCashValue"))
            buying_power = float(self._get_account_value(account, "BuyingPower"))
            
            positions = await self.get_positions()
            
            # Calculate P&L
            total_pnl = total_value - 100000  # Assuming 100k starting capital
            total_pnl_pct = (total_pnl / 100000) * 100 if total_pnl != 0 else 0
            
            return AccountSnapshot(
                total_value=total_value,
                cash=cash,
                buying_power=buying_power,
                total_pnl=total_pnl,
                total_pnl_pct=total_pnl_pct,
                positions=positions,
            )
        except Exception as e:
            logger.error(f"Failed to get account snapshot: {e}")
            return AccountSnapshot(0, 0, 0, 0, 0, [])
    
    async def get_positions(self) -> List[Position]:
        """Get list of open positions."""
        try:
            positions = self.ib.positions()
            result = []
            
            for pos in positions:
                contract = pos.contract
                current_price = self._get_market_price(contract)
                
                pnl = pos.marketValue - (pos.avgCost * pos.position)
                pnl_pct = (pnl / (pos.avgCost * pos.position)) * 100 if pos.avgCost > 0 else 0
                
                position = Position(
                    symbol=contract.symbol,
                    quantity=pos.position,
                    avg_price=pos.avgCost,
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
            self.ib.qualifyContracts(contract)
            
            if order_type == "market":
                order = self.ib.placeOrder(contract, 
                    self.ib.MktOrder(side.upper(), quantity))
            else:  # limit
                order = self.ib.placeOrder(contract,
                    self.ib.LimitOrder(side.upper(), quantity, price))
            
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
            ticker = self.ib.reqMktData(contract, "", snapshot=True)
            self.ib.sleep(0.5)
            
            return {
                "symbol": symbol,
                "bid": float(ticker.bid),
                "ask": float(ticker.ask),
                "last": float(ticker.last),
                "mid": (float(ticker.bid) + float(ticker.ask)) / 2,
            }
        except Exception as e:
            logger.error(f"Failed to get quote for {symbol}: {e}")
            return {}
    
    async def get_historical_data(self, symbol: str, bar_size: str = "1 day",
                                 lookback_days: int = 30) -> List[Dict[str, Any]]:
        """Get OHLCV data."""
        try:
            contract = Stock(symbol, "SMART", "USD")
            bars = self.ib.reqHistoricalData(
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
    
    def _get_account_value(self, account_summary, key: str) -> float:
        """Extract value from account summary."""
        for item in account_summary:
            if item.tag == key:
                return float(item.value)
        return 0.0
    
    def _get_market_price(self, contract: Contract) -> float:
        """Get current market price for a contract."""
        try:
            ticker = self.ib.reqMktData(contract, "", snapshot=True)
            self.ib.sleep(0.1)
            if ticker.bid > 0 and ticker.ask > 0:
                return (ticker.bid + ticker.ask) / 2
            return float(ticker.last or 0)
        except:
            return 0.0
    
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
