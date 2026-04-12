"""
Flask API server for the trading dashboard.
Provides REST endpoints for strategy control, configuration, and portfolio monitoring.
"""
import logging
import os
import json
import asyncio
import sys
import threading
import time
import socket
import random
import uuid
from collections import deque
from dataclasses import asdict
from pathlib import Path
from typing import Any
from flask import Flask, jsonify, request
from flask_cors import CORS
from datetime import datetime, timedelta
import yfinance as yf

# Support running this file directly (python api/app.py) by adding backend root to sys.path.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

_ASYNC_LOOP = asyncio.new_event_loop()


def _async_loop_runner():
    asyncio.set_event_loop(_ASYNC_LOOP)
    _ASYNC_LOOP.run_forever()


_ASYNC_THREAD = threading.Thread(target=_async_loop_runner, daemon=True)
_ASYNC_THREAD.start()

# ib_insync/eventkit expects a loop associated with MainThread during import time.
try:
    asyncio.get_event_loop()
except RuntimeError:
    asyncio.set_event_loop(asyncio.new_event_loop())

from config import ConfigManager, TradingMode
from brokers.base_broker import BrokerFactory
from brokers.ibkr_broker import IBKRBroker  # Register in BrokerFactory
from brokers.alpaca_broker import AlpacaBroker  # Register in BrokerFactory
from screeners.fundamental_screener import FundamentalScreener
from screeners.option_screener import OptionScreener
from bots.strategies import BlowupStockBot, CoveredCallBot, ForexBot
from data.mock_data import MockPortfolioGenerator

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Flask app
app = Flask(__name__)
CORS(app)

# Global state
state = {
    "broker": None,
    "broker_name": "demo",
    "config_manager": None,
    "broker_init_attempted": False,
    "portfolio_data": {},
    "scan_results": {},
    "current_mode": TradingMode.BALANCED,
    "execution_mode": "manual",  # manual | automatic
    "bot_running": False,
    "bot_heartbeat": None,
    "bot_last_run": None,
    "bot_last_error": None,
    "bot_cycle_count": 0,
    "bot_interval_seconds": 60,
    "forex_tick_seconds": 1,
    "forex_last_tick": None,
    "bot_dry_run": os.getenv("AUTO_EXECUTE_TRADES", "true").lower() != "true",
    "broker_runtime_config": {},
    "bot_logs": deque(maxlen=300),
    "bot_log_seq": 0,
    "strategy_audit": {
        "blowup": {"last_scan": None, "candidates": 0, "execution": "idle", "message": "No cycle yet"},
        "covered_call": {"last_scan": None, "candidates": 0, "execution": "idle", "message": "No cycle yet"},
        "forex_grid": {"last_tick": None, "execution": "idle", "message": "No tick yet"},
    },
    "simulated_trade_logs": deque(maxlen=500),
    "forex_grid_state": {"pairs": {}, "last_cycle": None},
    "last_ib_client_id": None,
    "daily_pnl_limit": 1000.0,  # Stop trading if daily loss exceeds this
    "daily_pnl_current": 0.0,  # Today's realized P&L
    "daily_pnl_date": datetime.now().strftime("%Y-%m-%d"),  # Track which day
    "daily_pnl_trading_halted": False,  # Is trading halted due to daily loss?
    "crypto_daily_loss_limit": 750.0,
    "crypto_daily_loss_current": 0.0,
    "crypto_daily_loss_date": datetime.now().strftime("%Y-%m-%d"),
    "crypto_daily_loss_halted": False,
}

BACKEND_ROOT = Path(__file__).resolve().parent.parent
TRADE_HISTORY_FILE = BACKEND_ROOT / "data" / "trade_history.json"
WATCHLISTS_FILE = BACKEND_ROOT / "data" / "watchlists.json"
SIM_PORTFOLIOS_FILE = BACKEND_ROOT / "data" / "simulated_portfolios.json"
TRADE_HISTORY_LOCK = threading.Lock()
WATCHLISTS_LOCK = threading.Lock()
SIM_PORTFOLIOS_LOCK = threading.Lock()


def _load_persisted_trade_logs() -> list[dict[str, Any]]:
    """Load persisted trade history from disk."""
    try:
        if not TRADE_HISTORY_FILE.exists():
            return []
        with TRADE_HISTORY_FILE.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
        if isinstance(payload, list):
            return [row for row in payload if isinstance(row, dict)]
    except Exception as e:
        logging.getLogger(__name__).warning("Failed to load trade history file: %s", e)
    return []


def _save_persisted_trade_logs(rows: list[dict[str, Any]]) -> None:
    """Persist trade history rows to disk."""
    try:
        TRADE_HISTORY_FILE.parent.mkdir(parents=True, exist_ok=True)
        with TRADE_HISTORY_FILE.open("w", encoding="utf-8") as handle:
            json.dump(rows, handle, indent=2)
    except Exception as e:
        logging.getLogger(__name__).warning("Failed to save trade history file: %s", e)


def _append_persisted_trade_logs(new_rows: list[dict[str, Any]]) -> None:
    """Append new trade history rows and flush them to disk."""
    if not new_rows:
        return

    with TRADE_HISTORY_LOCK:
        existing = _load_persisted_trade_logs()
        existing.extend([row for row in new_rows if isinstance(row, dict)])
        _save_persisted_trade_logs(existing)


def _load_json_list(file_path: Path) -> list[dict[str, Any]]:
    try:
        if not file_path.exists():
            return []
        with file_path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
        if isinstance(payload, list):
            return [row for row in payload if isinstance(row, dict)]
    except Exception as e:
        logging.getLogger(__name__).warning("Failed to load %s: %s", file_path.name, e)
    return []


def _save_json_list(file_path: Path, rows: list[dict[str, Any]]) -> None:
    try:
        file_path.parent.mkdir(parents=True, exist_ok=True)
        with file_path.open("w", encoding="utf-8") as handle:
            json.dump(rows, handle, indent=2)
    except Exception as e:
        logging.getLogger(__name__).warning("Failed to save %s: %s", file_path.name, e)


def _now_iso() -> str:
    return datetime.now().isoformat()


def _normalize_symbol_text(value: Any) -> str:
    return str(value or "").strip().upper()


def _parse_iso_date(value: Any) -> str:
    if value is None:
        return datetime.now().date().isoformat()
    text = str(value).strip()
    if not text:
        return datetime.now().date().isoformat()
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date().isoformat()
    except Exception:
        return datetime.now().date().isoformat()


def _resolve_market_symbol(symbol: str) -> str:
    raw = _normalize_symbol_text(symbol)
    if not raw:
        return raw
    if any(raw.endswith(suffix) for suffix in (".HK", ".T", ".KS", ".X")) or raw.endswith("=X"):
        return raw
    if len(raw) == 6 and raw.isalpha() and raw[:3] in {"EUR", "GBP", "AUD", "NZD", "USD"}:
        return f"{raw}=X"
    return raw


def _get_latest_market_price(symbol: str) -> float:
    ticker_symbol = _resolve_market_symbol(symbol)
    if not ticker_symbol:
        return 0.0

    try:
        hist = yf.Ticker(ticker_symbol).history(period="5d", interval="1d")
        if hist is not None and not hist.empty and "Close" in hist.columns:
            closes = hist["Close"].dropna()
            if not closes.empty:
                return float(closes.iloc[-1])
    except Exception:
        pass

    try:
        hist = yf.Ticker(ticker_symbol).history(period="1d", interval="5m")
        if hist is not None and not hist.empty and "Close" in hist.columns:
            closes = hist["Close"].dropna()
            if not closes.empty:
                return float(closes.iloc[-1])
    except Exception:
        pass

    return 0.0


def _current_account_total_value() -> float:
    if state.get("broker") is None:
        try:
            return float(MockPortfolioGenerator().generate_account_snapshot().get("total_value", 100000.0) or 100000.0)
        except Exception:
            return 100000.0

    try:
        account = run_async(state["broker"].get_account_snapshot())
        return float(getattr(account, "total_value", 0.0) or 0.0) or 100000.0
    except Exception:
        return 100000.0


def _decorate_watchlist(row: dict[str, Any]) -> dict[str, Any]:
    symbols = sorted({ _normalize_symbol_text(symbol) for symbol in row.get("symbols", []) if _normalize_symbol_text(symbol) })
    decorated = dict(row)
    decorated["symbols"] = symbols
    decorated["symbol_count"] = len(symbols)
    decorated["updated_at"] = decorated.get("updated_at") or decorated.get("created_at")
    return decorated


def _decorate_portfolio(row: dict[str, Any]) -> dict[str, Any]:
    portfolio = dict(row)
    holdings = []
    invested = 0.0
    market_value = 0.0
    unrealized = 0.0

    for holding in portfolio.get("holdings", []) or []:
        symbol = _normalize_symbol_text(holding.get("symbol"))
        shares = float(holding.get("shares", 0) or 0)
        buy_price = float(holding.get("buy_price", 0) or 0)
        current_price = float(holding.get("current_price", 0) or 0)
        if current_price <= 0:
            current_price = _get_latest_market_price(symbol)

        cost_basis = shares * buy_price
        current_value = shares * current_price
        pnl = current_value - cost_basis
        pnl_pct = (pnl / cost_basis * 100.0) if cost_basis else 0.0

        holdings.append(
            {
                **holding,
                "symbol": symbol,
                "shares": shares,
                "buy_price": round(buy_price, 2),
                "current_price": round(current_price, 4),
                "cost_basis": round(cost_basis, 2),
                "market_value": round(current_value, 2),
                "unrealized_pnl": round(pnl, 2),
                "unrealized_pnl_pct": round(pnl_pct, 2),
            }
        )
        invested += cost_basis
        market_value += current_value
        unrealized += pnl

    cash = float(portfolio.get("cash", 0) or 0)
    total_value = cash + market_value

    portfolio["holdings"] = holdings
    portfolio["holdings_count"] = len(holdings)
    portfolio["invested_value"] = round(invested, 2)
    portfolio["market_value"] = round(market_value, 2)
    portfolio["total_value"] = round(total_value, 2)
    portfolio["unrealized_pnl"] = round(unrealized, 2)
    portfolio["unrealized_pnl_pct"] = round((unrealized / invested * 100.0) if invested else 0.0, 2)
    portfolio["cash"] = round(cash, 2)
    portfolio["updated_at"] = portfolio.get("updated_at") or portfolio.get("created_at")
    return portfolio


# ============================================================================
# Trade Logging & Metrics
# ============================================================================

def _log_trade(
    symbol: str,
    entry_price: float,
    exit_price: float,
    quantity: int,
    strategy: str = "unknown",
    entry_reason: str = "",
    mode: str = "simulated",
    broker: str = "demo",
) -> dict[str, Any]:
    """
    Log a completed trade to the persistent trade history.
    Returns the trade record.
    """
    now = datetime.now()
    pnl = (exit_price - entry_price) * quantity
    pnl_pct = ((exit_price - entry_price) / entry_price * 100.0) if entry_price > 0 else 0.0
    
    trade_record = {
        "id": str(uuid.uuid4()),
        "symbol": _normalize_symbol_text(symbol),
        "entry_price": round(entry_price, 4),
        "exit_price": round(exit_price, 4),
        "quantity": quantity,
        "entry_reason": str(entry_reason),
        "strategy": str(strategy),
        "pnl": round(pnl, 2),
        "pnl_pct": round(pnl_pct, 2),
        "mode": mode,
        "broker": broker,
        "timestamp": now.isoformat(),
        "date": now.strftime("%Y-%m-%d"),
    }
    
    _append_persisted_trade_logs([trade_record])
    logger.info(f"Trade logged: {symbol} {quantity}@${entry_price} -> ${exit_price} = {pnl_pct:+.1f}%")
    
    return trade_record


def _get_trade_metrics(trades: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """
    Calculate trading metrics from trade history.
    Returns: win_rate, avg_win, avg_loss, total_pnl, sharpe_ratio, and more.
    """
    if trades is None:
        trades = _load_persisted_trade_logs()
    
    if not trades:
        return {
            "win_rate": 0.0,
            "total_trades": 0,
            "winning_trades": 0,
            "losing_trades": 0,
            "avg_win": 0.0,
            "avg_loss": 0.0,
            "total_pnl": 0.0,
            "avg_pnl_pct": 0.0,
            "largest_win": 0.0,
            "largest_loss": 0.0,
            "sharpe_ratio": 0.0,
            "profit_factor": 0.0,
        }
    
    total_trades = len(trades)
    pnls = [float(t.get("pnl", 0)) for t in trades]
    pnl_pcts = [float(t.get("pnl_pct", 0)) for t in trades]
    
    winning = [p for p in pnls if p > 0]
    losing = [p for p in pnls if p < 0]
    
    total_pnl = sum(pnls)
    total_wins = sum(winning)
    total_losses = sum(losing)
    
    win_count = len(winning)
    loss_count = len(losing)
    win_rate = (win_count / total_trades * 100.0) if total_trades > 0 else 0.0
    avg_win = (total_wins / win_count) if win_count > 0 else 0.0
    avg_loss = (total_losses / loss_count) if loss_count > 0 else 0.0
    avg_pnl_pct = (sum(pnl_pcts) / total_trades) if total_trades > 0 else 0.0
    
    largest_win = max(pnls) if pnls else 0.0
    largest_loss = min(pnls) if pnls else 0.0
    
    # Sharpe Ratio = mean_return / std_dev * sqrt(252)
    if len(pnl_pcts) > 1:
        import statistics
        try:
            std_dev = statistics.stdev(pnl_pcts)
            sharpe = (avg_pnl_pct / std_dev * (252 ** 0.5)) if std_dev > 0 else 0.0
        except:
            sharpe = 0.0
    else:
        sharpe = 0.0
    
    profit_factor = abs(total_wins / abs(total_losses)) if total_losses != 0 else (1.0 if total_wins > 0 else 0.0)
    
    return {
        "win_rate": round(win_rate, 2),
        "total_trades": total_trades,
        "winning_trades": win_count,
        "losing_trades": loss_count,
        "avg_win": round(avg_win, 2),
        "avg_loss": round(avg_loss, 2),
        "total_pnl": round(total_pnl, 2),
        "avg_pnl_pct": round(avg_pnl_pct, 2),
        "largest_win": round(largest_win, 2),
        "largest_loss": round(largest_loss, 2),
        "sharpe_ratio": round(sharpe, 2),
        "profit_factor": round(profit_factor, 2),
    }


def _get_performance_by_strategy(trades: list[dict[str, Any]] | None = None) -> dict[str, dict[str, Any]]:
    """
    Group trades by strategy and calculate metrics for each.
    Returns: {strategy_name: {metrics}, ...}
    """
    if trades is None:
        trades = _load_persisted_trade_logs()
    
    by_strategy: dict[str, list] = {}
    for trade in trades:
        strat = trade.get("strategy", "unknown")
        if strat not in by_strategy:
            by_strategy[strat] = []
        by_strategy[strat].append(trade)
    
    result = {}
    for strategy, strat_trades in by_strategy.items():
        result[strategy] = _get_trade_metrics(strat_trades)
    
    return result


def _get_daily_pnl(trades: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    """
    Aggregate trades by day and calculate daily P&L.
    Returns list of {date, trades_count, pnl, pnl_pct}
    """
    if trades is None:
        trades = _load_persisted_trade_logs()
    
    daily: dict[str, list] = {}
    for trade in trades:
        date = trade.get("date", "unknown")
        if date not in daily:
            daily[date] = []
        daily[date].append(trade)
    
    result = []
    for date in sorted(daily.keys(), reverse=True):
        day_trades = daily[date]
        day_pnl = sum(float(t.get("pnl", 0)) for t in day_trades)
        day_pnl_pct = sum(float(t.get("pnl_pct", 0)) for t in day_trades) / len(day_trades) if day_trades else 0.0
        
        result.append({
            "date": date,
            "trades_count": len(day_trades),
            "pnl": round(day_pnl, 2),
            "pnl_pct": round(day_pnl_pct, 2),
        })
    
    return result


# ============================================================================
# Backtesting & Overnight Summary
# ============================================================================

def _backtest_strategy(
    symbol: str,
    strategy: str,
    days_lookback: int = 60,
    initial_capital: float = 10000.0,
) -> dict[str, Any]:
    """
    Backtest a strategy on historical data.
    Returns: {symbol, strategy, backtest_results...}
    """
    try:
        # Fetch historical data
        ticker = yf.Ticker(symbol)
        hist = ticker.history(period=f"{max(30, min(days_lookback, 365))}d")
        
        if hist.empty or len(hist) < 20:
            return {"error": f"Insufficient data for {symbol}", "symbol": symbol, "strategy": strategy}
        
        prices = hist['Close'].values
        rsi_values = []
        
        # Calculate RSI for momentum/mean reversion strategies
        for i in range(len(prices)):
            if i < 14:
                rsi_values.append(None)
            else:
                price_list = prices[max(0, i-13):i+1].tolist()
                deltas = [price_list[j] - price_list[j-1] for j in range(1, len(price_list))]
                gains = [d if d > 0 else 0 for d in deltas]
                losses = [-d if d < 0 else 0 for d in deltas]
                avg_gain = sum(gains) / 14
                avg_loss = sum(losses) / 14
                rs = avg_gain / avg_loss if avg_loss > 0 else 1.0
                rsi = 100 - (100 / (1 + rs))
                rsi_values.append(rsi)
        
        # Simulate trades based on strategy
        trades = []
        position = None
        cash = initial_capital
        
        for i in range(20, len(prices)):
            price = prices[i]
            rsi = rsi_values[i]
            
            # Entry logic based on strategy
            entry_price = None
            
            if strategy == "momentum" and not position:
                if rsi and 50 <= rsi <= 70:
                    shares = int(cash / price * 0.5)  # Use 50% of cash
                    if shares > 0:
                        position = {"entry": price, "shares": shares, "rsi": rsi}
                        cash -= shares * price
            
            elif strategy == "swing" and not position:
                if rsi and rsi < 30:
                    shares = int(cash / price * 0.5)
                    if shares > 0:
                        position = {"entry": price, "shares": shares, "rsi": rsi}
                        cash -= shares * price
            
            elif strategy == "mean_reversion" and not position:
                if rsi and rsi < 30:
                    shares = int(cash / price * 0.3)
                    if shares > 0:
                        position = {"entry": price, "shares": shares, "signal": "buy"}
                        cash -= shares * price
            
            # Exit logic
            if position:
                pnl_pct = (price - position["entry"]) / position["entry"] * 100
                
                should_exit = False
                if strategy == "momentum" and pnl_pct >= 6:
                    should_exit = True
                elif strategy == "momentum" and pnl_pct <= -3:
                    should_exit = True
                elif strategy == "swing" and pnl_pct >= 5:
                    should_exit = True
                elif strategy == "swing" and pnl_pct <= -2.5:
                    should_exit = True
                elif strategy == "mean_reversion" and pnl_pct >= 3:
                    should_exit = True
                elif strategy == "mean_reversion" and pnl_pct <= -1.5:
                    should_exit = True
                
                if should_exit:
                    pnl_dollars = (price - position["entry"]) * position["shares"]
                    cash += position["shares"] * price
                    trades.append({
                        "entry": round(position["entry"], 4),
                        "exit": round(price, 4),
                        "shares": position["shares"],
                        "pnl": round(pnl_dollars, 2),
                        "pnl_pct": round(pnl_pct, 2),
                    })
                    position = None
        
        # Close any remaining position at last price
        final_price = prices[-1]
        if position:
            pnl_dollars = (final_price - position["entry"]) * position["shares"]
            cash += position["shares"] * final_price
            trades.append({
                "entry": round(position["entry"], 4),
                "exit": round(final_price, 4),
                "shares": position["shares"],
                "pnl": round(pnl_dollars, 2),
                "pnl_pct": round((final_price - position["entry"]) / position["entry"] * 100, 2),
            })
        
        # Calculate metrics
        if trades:
            total_pnl = sum(t["pnl"] for t in trades)
            wins = [t for t in trades if t["pnl"] > 0]
            losses = [t for t in trades if t["pnl"] < 0]
            win_rate = len(wins) / len(trades) * 100 if trades else 0
            
            return {
                "symbol": symbol,
                "strategy": strategy,
                "backtest_complete": True,
                "trades": trades,
                "total_trades": len(trades),
                "winning_trades": len(wins),
                "losing_trades": len(losses),
                "win_rate": round(win_rate, 1),
                "total_pnl": round(total_pnl, 2),
                "total_pnl_pct": round((cash - initial_capital) / initial_capital * 100, 2),
                "final_capital": round(cash, 2),
                "avg_win": round(sum(t["pnl"] for t in wins) / len(wins), 2) if wins else 0,
                "avg_loss": round(sum(t["pnl"] for t in losses) / len(losses), 2) if losses else 0,
            }
        else:
            return {
                "symbol": symbol,
                "strategy": strategy,
                "backtest_complete": True,
                "trades": [],
                "total_trades": 0,
                "winning_trades": 0,
                "losing_trades": 0,
                "win_rate": 0,
                "total_pnl": 0,
                "total_pnl_pct": 0,
                "final_capital": round(cash, 2),
                "message": "No trades generated during backtest period",
            }
    
    except Exception as e:
        logger.error(f"Backtest error for {symbol}: {e}")
        return {"error": str(e), "symbol": symbol, "strategy": strategy}


def _get_overnight_summary() -> dict[str, Any]:
    """
    Get summary of what bot did since yesterday (overnight trading).
    Returns: trades, P&L, performance by strategy, alerts
    """
    now = datetime.now()
    today_str = now.strftime("%Y-%m-%d")
    
    # Get trades from today
    all_trades = _load_persisted_trade_logs()
    today_trades = [t for t in all_trades if t.get("date") == today_str]
    
    # Group by strategy
    by_strategy: dict[str, list] = {}
    for trade in today_trades:
        strat = trade.get("strategy", "unknown")
        if strat not in by_strategy:
            by_strategy[strat] = []
        by_strategy[strat].append(trade)
    
    # Calculate stats
    total_pnl = sum(float(t.get("pnl", 0)) for t in today_trades)
    total_pnl_pct = sum(float(t.get("pnl_pct", 0)) for t in today_trades) / len(today_trades) if today_trades else 0
    winning_trades = len([t for t in today_trades if t.get("pnl", 0) > 0])
    losing_trades = len([t for t in today_trades if t.get("pnl", 0) < 0])
    
    # Get yesterday's P&L for comparison
    yesterday = (now - timedelta(days=1)).strftime("%Y-%m-%d")
    yesterday_trades = [t for t in all_trades if t.get("date") == yesterday]
    yesterday_pnl = sum(float(t.get("pnl", 0)) for t in yesterday_trades)
    
    return {
        "date": today_str,
        "trades_count": len(today_trades),
        "winning_trades": winning_trades,
        "losing_trades": losing_trades,
        "total_pnl": round(total_pnl, 2),
        "total_pnl_pct": round(total_pnl_pct, 2),
        "win_rate": round(winning_trades / len(today_trades) * 100, 1) if today_trades else 0,
        "by_strategy": {
            strat: {
                "trades": len(trades),
                "pnl": round(sum(float(t.get("pnl", 0)) for t in trades), 2),
                "wins": len([t for t in trades if t.get("pnl", 0) > 0]),
            }
            for strat, trades in by_strategy.items()
        },
        "recent_trades": today_trades[-5:],  # Last 5 trades
        "comparison": {
            "yesterday_pnl": round(yesterday_pnl, 2),
            "improvement": round(total_pnl - yesterday_pnl, 2),
        },
        "alerts": _generate_overnight_alerts(today_trades, state.get("daily_pnl_limit", 1000)),
    }


def _generate_overnight_alerts(trades: list[dict[str, Any]], daily_limit: float) -> list[str]:
    """Generate alerts based on overnight trading activity."""
    alerts = []
    
    if not trades:
        alerts.append("No trades executed overnight")
        return alerts
    
    total_loss = sum(float(t.get("pnl", 0)) for t in trades if t.get("pnl", 0) < 0)
    
    if abs(total_loss) > daily_limit:
        alerts.append(f"⚠️ Daily loss limit exceeded: ${abs(total_loss):.2f} > ${daily_limit:.2f}")
    
    win_rate = len([t for t in trades if t.get("pnl", 0) > 0]) / len(trades) * 100
    if win_rate < 30 and len(trades) > 5:
        alerts.append(f"⚠️ Low win rate: {win_rate:.0f}% (consider adjusting stop losses)")
    
    largest_loss = min([t.get("pnl", 0) for t in trades], default=0)
    if largest_loss < -500:
        alerts.append(f"🔴 Large loss detected: ${largest_loss:.2f}")
    
    if len(trades) > 20:
        alerts.append(f"✓ High activity: {len(trades)} trades executed")
    
    return alerts




def _find_row_by_id(rows: list[dict[str, Any]], row_id: str) -> dict[str, Any] | None:
    for row in rows:
        if str(row.get("id")) == str(row_id):
            return row
    return None


def _load_watchlists() -> list[dict[str, Any]]:
    return [_decorate_watchlist(row) for row in _load_json_list(WATCHLISTS_FILE)]


def _save_watchlists(rows: list[dict[str, Any]]) -> None:
    _save_json_list(WATCHLISTS_FILE, rows)


def _load_simulated_portfolios() -> list[dict[str, Any]]:
    return [_decorate_portfolio(row) for row in _load_json_list(SIM_PORTFOLIOS_FILE)]


def _save_simulated_portfolios(rows: list[dict[str, Any]]) -> None:
    _save_json_list(SIM_PORTFOLIOS_FILE, rows)


state["watchlists"] = _load_watchlists()
state["simulated_portfolios"] = _load_simulated_portfolios()


state["simulated_trade_logs"] = deque(_load_persisted_trade_logs(), maxlen=500)


def append_bot_log(event: str, level: str = "info", details: dict[str, Any] | None = None):
    """Append one bot event to an in-memory rolling log buffer."""
    state["bot_log_seq"] = int(state.get("bot_log_seq", 0)) + 1
    state["bot_logs"].append(
        {
            "id": state["bot_log_seq"],
            "timestamp": datetime.now().isoformat(),
            "level": level,
            "event": event,
            "details": details or {},
        }
    )


def _generate_try_buy_sell_logs(rounds: int = 6, quantity: int = 2000) -> list[dict[str, Any]]:
    """Generate small simulated forex round-trip trades for dashboard testing."""
    now = datetime.now()
    pairs = ["EURUSD=X", "GBPUSD=X", "AUDUSD=X", "NZDUSD=X"]
    rows: list[dict[str, Any]] = []

    safe_rounds = max(2, min(rounds, 20))
    safe_qty = max(500, min(quantity, 10000))

    for idx in range(safe_rounds):
        pair_ticker = pairs[idx % len(pairs)]
        pair = pair_ticker.replace("=X", "")

        try:
            hist = yf.Ticker(pair_ticker).history(period="1d", interval="1m")
            market_price = float(hist["Close"].iloc[-1]) if not hist.empty else None
        except Exception:
            market_price = None

        if market_price is None:
            market_price = {
                "EURUSD": 1.08,
                "GBPUSD": 1.27,
                "AUDUSD": 0.66,
                "NZDUSD": 0.60,
            }.get(pair, 1.0)

        side = "buy" if idx % 2 == 0 else "sell"

        # Keep movement tight so generated records remain near break-even.
        drift_pct = random.uniform(-0.00015, 0.00015)
        entry_price = round(market_price, 5)
        exit_price = round(entry_price * (1 + drift_pct), 5)
        fees = round(0.35 + safe_qty * 0.00002, 2)

        if side == "buy":
            gross_pnl = (exit_price - entry_price) * safe_qty
        else:
            gross_pnl = (entry_price - exit_price) * safe_qty
        gross_pnl = round(gross_pnl, 2)
        net_pnl = round(gross_pnl - fees, 2)

        timestamp = (now - timedelta(seconds=(safe_rounds - idx) * 7)).isoformat()
        rows.append(
            {
                "trade_id": f"TRYFX-{now.strftime('%Y%m%d%H%M%S')}-{idx + 1:02d}",
                "timestamp": timestamp,
                "strategy": "try_buy_sell",
                "asset_type": "forex",
                "symbol": pair,
                "underlying": pair,
                "side": side,
                "quantity": safe_qty,
                "entry_price": entry_price,
                "exit_price": exit_price,
                "fees": fees,
                "gross_pnl": gross_pnl,
                "net_pnl": net_pnl,
                "status": "closed",
                "execution_origin": "simulated",
                "is_simulated": True,
                "notes": "Simulated quick round-trip trade for dashboard testing",
            }
        )

    return rows


class BotRunner:
    """Simple background runner for automatic mode."""

    def __init__(self):
        self._thread = None
        self._stop_event = threading.Event()

    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self, interval_seconds: int = 60) -> bool:
        if self.is_running():
            return False

        self._stop_event.clear()
        full_cycle_seconds = max(10, int(interval_seconds or 60))
        state["bot_interval_seconds"] = full_cycle_seconds

        def _loop():
            logger.info("Automatic bot runner started")
            state["bot_running"] = True
            next_full_cycle = time.time()
            next_forex_tick = time.time()
            append_bot_log(
                "Bot runner started",
                details={
                    "execution_mode": state.get("execution_mode"),
                    "dry_run": state.get("bot_dry_run"),
                    "interval_seconds": full_cycle_seconds,
                },
            )
            while not self._stop_event.is_set():
                now = time.time()
                try:
                    cfg = (state["config_manager"] or ConfigManager()).load_user_config()
                    forex_cfg = cfg.get("forex", {}) if isinstance(cfg, dict) else {}
                    forex_tick_seconds = max(1, min(int(forex_cfg.get("tick_seconds", 1) or 1), 5))
                    state["forex_tick_seconds"] = forex_tick_seconds

                    if now >= next_forex_tick:
                        self._run_forex_tick(cfg=cfg)
                        next_forex_tick = now + forex_tick_seconds

                    if now >= next_full_cycle:
                        state["bot_heartbeat"] = datetime.now().isoformat()
                        self._run_cycle(cfg_override=cfg, include_forex=False)
                        next_full_cycle = now + full_cycle_seconds

                    state["bot_last_error"] = None
                except Exception as e:
                    state["bot_last_error"] = str(e)
                    logger.error(f"Bot cycle error: {e}")
                    append_bot_log("Bot cycle failed", level="error", details={"error": str(e)})

                sleep_until = min(next_forex_tick, next_full_cycle)
                sleep_for = max(0.2, min(1.0, sleep_until - time.time()))
                self._stop_event.wait(timeout=sleep_for)

            state["bot_running"] = False
            logger.info("Automatic bot runner stopped")
            append_bot_log("Bot runner stopped")

        self._thread = threading.Thread(target=_loop, daemon=True)
        self._thread.start()
        return True

    def stop(self) -> bool:
        if not self.is_running():
            state["bot_running"] = False
            return False

        self._stop_event.set()
        self._thread.join(timeout=3)
        state["bot_running"] = False
        return True

    def _run_cycle(self, cfg_override: dict[str, Any] | None = None, include_forex: bool = True):
        """Run one automated scan cycle and generate actions."""
        cfg = cfg_override if isinstance(cfg_override, dict) else (state["config_manager"] or ConfigManager()).load_user_config()

        # In manual mode we only provide data; no bot loop should operate.
        if state["execution_mode"] != "automatic":
            return

        append_bot_log(
            "Scanning market for opportunities",
            details={
                "broker": state.get("broker_name", "demo"),
                "dry_run": state.get("bot_dry_run", True),
            },
        )

        fundamental_cfg = cfg.get("fundamental_screener", {}) if isinstance(cfg, dict) else {}
        option_cfg = cfg.get("option_screener", {}) if isinstance(cfg, dict) else {}

        # Real screening path: fundamentals via yfinance, options via broker when available.
        stock_screener = FundamentalScreener(config=fundamental_cfg)
        stocks = run_async(stock_screener.screen()) or []

        broker = state.get("broker")
        positions = run_async(broker.get_positions()) if broker is not None else []
        shares_by_symbol = {
            p.symbol: int(float(getattr(p, "quantity", 0)))
            for p in positions
            if getattr(p, "asset_type", "").lower() == "stock"
        }
        eligible_cc_symbols = sorted(
            {
                p.symbol
                for p in positions
                if getattr(p, "asset_type", "").lower() == "stock" and float(getattr(p, "quantity", 0)) >= 100
            }
        )

        option_config = dict(option_cfg)
        if eligible_cc_symbols:
            option_config["symbols"] = eligible_cc_symbols
        option_screener = OptionScreener(config=option_config)
        calls = run_async(option_screener.screen_for_opportunities(broker if broker is not None else None)) or []

        forex = []

        state["scan_results"] = {
            "timestamp": datetime.now().isoformat(),
            "source": "live" if broker is not None else "demo",
            "stocks": stocks,
            "covered_calls": calls,
            "forex": forex,
        }
        append_bot_log(
            "Scan completed",
            details={
                "stock_candidates": len(stocks),
                "covered_call_candidates": len(calls),
                "forex_candidates": len(forex),
            },
        )

        # Blowup-stock sleeve: scan and optionally place one entry order per cycle.
        actions = []
        blowup_best = stocks[0] if stocks else None
        blowup_symbol = str((blowup_best or {}).get("symbol") or "").upper().strip()
        existing_stock_symbols = set(shares_by_symbol.keys())
        blowup_allocation = cfg.get("allocation", {}) if isinstance(cfg, dict) else {}
        blowup_allocation_pct = float(blowup_allocation.get("blowup_stocks_pct", 0.0) or 0.0)

        blowup_execution = "idle"
        blowup_message = "No blowup candidate found"
        blowup_order_id = None
        blowup_qty = 0

        if blowup_best and blowup_symbol:
            blowup_price = float(blowup_best.get("price", 0.0) or 0.0)
            if blowup_symbol in existing_stock_symbols:
                blowup_execution = "skipped"
                blowup_message = f"Already holding {blowup_symbol}; not adding duplicate position"
            elif blowup_price <= 0:
                blowup_execution = "skipped"
                blowup_message = f"Invalid price for {blowup_symbol}"
            else:
                account_total = 100000.0
                try:
                    if broker is not None:
                        snap = run_async(broker.get_account_snapshot())
                        account_total = float(getattr(snap, "total_value", 0.0) or 0.0) or account_total
                except Exception:
                    account_total = 100000.0

                sleeve_capital = account_total * (blowup_allocation_pct / 100.0)
                ticket_capital = max(2000.0, sleeve_capital * 0.20)
                blowup_qty = max(1, int(ticket_capital / blowup_price))

                if state.get("bot_dry_run", True):
                    blowup_execution = "simulated"
                    blowup_message = f"Simulated buy {blowup_qty} shares of {blowup_symbol}"
                else:
                    if broker is None:
                        blowup_execution = "skipped"
                        blowup_message = "No live broker connected"
                    elif not hasattr(broker, "place_order"):
                        blowup_execution = "skipped"
                        blowup_message = "Broker does not support stock order placement"
                    else:
                        placed = run_async(broker.place_order(blowup_symbol, "buy", blowup_qty))
                        if placed and getattr(placed, "status", "") != "failed":
                            blowup_execution = "submitted"
                            blowup_order_id = getattr(placed, "order_id", None)
                            blowup_message = f"Submitted buy {blowup_qty} shares of {blowup_symbol}"
                        else:
                            blowup_execution = "failed"
                            blowup_message = f"Broker rejected blowup-stock order for {blowup_symbol}"

            actions.append(
                {
                    "type": "blowup_stock",
                    "symbol": blowup_symbol,
                    "action": "buy",
                    "price": blowup_best.get("price"),
                    "score": blowup_best.get("score"),
                    "reason": blowup_best.get("reason", "top blowup candidate"),
                    "quantity": blowup_qty,
                    "execution": blowup_execution,
                    "order_id": blowup_order_id,
                    "message": blowup_message,
                    "dry_run": state.get("bot_dry_run", True),
                }
            )

            append_bot_log(
                "Blowup stock candidate evaluated",
                level="warning" if blowup_execution in {"failed", "skipped"} else "info",
                details={
                    "symbol": blowup_symbol,
                    "score": blowup_best.get("score"),
                    "execution": blowup_execution,
                    "quantity": blowup_qty,
                    "message": blowup_message,
                    "order_id": blowup_order_id,
                },
            )
        else:
            actions.append(
                {
                    "type": "blowup_stock",
                    "action": "idle",
                    "execution": "idle",
                    "message": "No blowup candidate found this cycle",
                    "dry_run": state.get("bot_dry_run", True),
                }
            )

        state["strategy_audit"]["blowup"] = {
            "last_scan": datetime.now().isoformat(),
            "candidates": len(stocks),
            "top_symbol": blowup_symbol or None,
            "top_score": (blowup_best or {}).get("score") if blowup_best else None,
            "execution": blowup_execution,
            "message": blowup_message,
            "order_id": blowup_order_id,
        }

        # Covered-call-first behavior: never auto-buy shares to top up under-covered positions.
        top_call_symbol = calls[0].get("symbol") if calls else None
        if calls:
            best = calls[0]
            symbol = best.get("symbol")
            expiry = best.get("expiry")
            strike = float(best.get("call_strike", 0) or 0)
            premium = best.get("call_premium")

            execution = "simulated"
            order_id = None
            error = None

            if not state["bot_dry_run"]:
                if broker is None:
                    execution = "skipped"
                    error = "No live broker connected"
                elif state.get("broker_name") != "ibkr":
                    execution = "skipped"
                    error = "Live covered-call execution currently supported for IBKR only"
                elif not hasattr(broker, "sell_covered_call"):
                    execution = "skipped"
                    error = "Broker does not implement covered-call order API"
                else:
                    available_shares = int(shares_by_symbol.get(symbol, 0))
                    available_contracts = available_shares // 100

                    # Prevent duplicate submissions for the same contract selection.
                    cc_signature = f"{symbol}:{expiry}:{strike:.2f}"
                    last_signature = state.get("portfolio_data", {}).get("last_submitted_covered_call")

                    if available_contracts <= 0:
                        execution = "skipped"
                        error = f"Insufficient shares for covered call on {symbol} (need >=100)"
                    elif last_signature == cc_signature:
                        execution = "skipped"
                        error = "Duplicate covered-call candidate skipped"
                    else:
                        contracts_to_sell = 1
                        placed = run_async(
                            broker.sell_covered_call(
                                symbol=symbol,
                                expiry=expiry,
                                strike=strike,
                                contracts=contracts_to_sell,
                                limit_price=float(premium) if premium is not None else None,
                            )
                        )

                        if placed and placed.status != "failed":
                            execution = "submitted"
                            order_id = placed.order_id
                            state["portfolio_data"]["last_submitted_covered_call"] = cc_signature
                        else:
                            execution = "failed"
                            error = "Broker rejected covered-call order"

            actions.append(
                {
                    "type": "option",
                    "symbol": symbol,
                    "action": "sell_call",
                    "strike": strike,
                    "expiry": expiry,
                    "premium": premium,
                    "reason": best.get("reason", "best premium"),
                    "dry_run": state["bot_dry_run"],
                    "execution": execution,
                    "order_id": order_id,
                    "error": error,
                }
            )

            details = {
                "symbol": symbol,
                "strike": strike,
                "expiry": expiry,
                "execution": execution,
                "dry_run": state.get("bot_dry_run", True),
            }
            if order_id:
                details["order_id"] = order_id
            if error:
                details["error"] = error
            append_bot_log(
                "Covered call opportunity evaluated",
                level="warning" if execution in {"failed", "skipped"} else "info",
                details=details,
            )
            state["strategy_audit"]["covered_call"] = {
                "last_scan": datetime.now().isoformat(),
                "candidates": len(calls),
                "top_symbol": symbol,
                "execution": execution,
                "message": error or f"Covered call candidate evaluated for {symbol}",
                "order_id": order_id,
            }
        else:
            target = top_call_symbol or (eligible_cc_symbols[0] if eligible_cc_symbols else "SPY")
            actions.append(
                {
                    "type": "diagnostic",
                    "action": "idle",
                    "target_symbol": target,
                    "reason": (
                        f"No covered-call setup for target {target}. "
                        "Need >=100 owned shares in an eligible symbol; bot will not auto-buy shares."
                    ),
                    "eligible_covered_call_symbols": eligible_cc_symbols,
                }
            )
            append_bot_log(
                "No executable covered-call opportunity this cycle",
                level="warning",
                details={"target_symbol": target, "eligible_symbols": eligible_cc_symbols},
            )
            state["strategy_audit"]["covered_call"] = {
                "last_scan": datetime.now().isoformat(),
                "candidates": len(calls),
                "top_symbol": target,
                "execution": "idle",
                "message": f"No executable covered-call setup for {target}",
                "order_id": None,
            }

        # Keep forex strategy continuously active using grid trading,
        # with capital sized by the current mode's forex allocation.
        mode_name = str(cfg.get("mode", "")).lower().strip()
        allocation = cfg.get("allocation", {}) if isinstance(cfg, dict) else {}
        forex_alloc_pct = float(allocation.get("forex_pct", 0.0) or 0.0)

        if include_forex and forex_alloc_pct > 0:
            forex_summary, forex_trade_rows = self._run_forex_grid_cycle(
                cfg=cfg,
                broker=broker,
                allocation_pct=forex_alloc_pct,
                dry_run=bool(state.get("bot_dry_run", True)),
            )
            actions.append(
                {
                    "type": "forex_grid",
                    "action": "grid_cycle",
                    "allocation_pct": round(forex_alloc_pct, 2),
                    "summary": forex_summary,
                    "dry_run": state.get("bot_dry_run", True),
                }
            )

            if forex_trade_rows:
                for row in forex_trade_rows:
                    state["simulated_trade_logs"].append(row)
                _append_persisted_trade_logs(forex_trade_rows)

            append_bot_log(
                "24/7 grid cycle completed",
                details={
                    "mode": mode_name,
                    "allocation_pct": round(forex_alloc_pct, 2),
                    "pairs": forex_summary.get("pairs_processed", 0),
                    "crypto_symbols": forex_summary.get("crypto_symbols_processed", 0),
                    "opened": forex_summary.get("opened", 0),
                    "closed": forex_summary.get("closed", 0),
                    "realized_pnl": forex_summary.get("realized_pnl", 0.0),
                    "execution": "simulated" if state.get("bot_dry_run", True) else "live_paper",
                },
            )
            state["strategy_audit"]["forex_grid"] = {
                "last_tick": datetime.now().isoformat(),
                "execution": "simulated" if state.get("bot_dry_run", True) else "live_paper",
                "message": f"Opened {forex_summary.get('opened', 0)}, closed {forex_summary.get('closed', 0)}",
                "opened": forex_summary.get("opened", 0),
                "closed": forex_summary.get("closed", 0),
                "realized_pnl": forex_summary.get("realized_pnl", 0.0),
            }

        state["portfolio_data"]["last_actions"] = actions
        state["bot_heartbeat"] = datetime.now().isoformat()
        state["bot_last_run"] = datetime.now().isoformat()
        state["bot_cycle_count"] += 1

    def _run_forex_tick(self, cfg: dict[str, Any] | None = None):
        """Run high-frequency forex grid tick independent of slower full scan cycle."""
        if state["execution_mode"] != "automatic":
            return

        cfg = cfg if isinstance(cfg, dict) else (state["config_manager"] or ConfigManager()).load_user_config()
        allocation = cfg.get("allocation", {}) if isinstance(cfg, dict) else {}
        forex_alloc_pct = float(allocation.get("forex_pct", 0.0) or 0.0)

        if forex_alloc_pct <= 0:
            return

        broker = state.get("broker")
        forex_summary, forex_trade_rows = self._run_forex_grid_cycle(
            cfg=cfg,
            broker=broker,
            allocation_pct=forex_alloc_pct,
            dry_run=bool(state.get("bot_dry_run", True)),
        )

        if forex_trade_rows:
            for row in forex_trade_rows:
                state["simulated_trade_logs"].append(row)
            _append_persisted_trade_logs(forex_trade_rows)

        state["forex_last_tick"] = datetime.now().isoformat()
        state["bot_last_run"] = state["forex_last_tick"]
        state["bot_heartbeat"] = state["forex_last_tick"]
        state["portfolio_data"]["last_forex_summary"] = {
            "allocation_pct": round(forex_alloc_pct, 2),
            "summary": forex_summary,
            "tick_seconds": state.get("forex_tick_seconds", 1),
        }

        if forex_summary.get("opened", 0) > 0 or forex_summary.get("closed", 0) > 0:
            append_bot_log(
                "Forex grid tick executed",
                details={
                    "allocation_pct": round(forex_alloc_pct, 2),
                    "opened": forex_summary.get("opened", 0),
                    "closed": forex_summary.get("closed", 0),
                    "realized_pnl": forex_summary.get("realized_pnl", 0.0),
                },
            )

        state["strategy_audit"]["forex_grid"] = {
            "last_tick": state["forex_last_tick"],
            "execution": "simulated" if state.get("bot_dry_run", True) else "live_paper",
            "message": f"Opened {forex_summary.get('opened', 0)}, closed {forex_summary.get('closed', 0)}",
            "opened": forex_summary.get("opened", 0),
            "closed": forex_summary.get("closed", 0),
            "realized_pnl": forex_summary.get("realized_pnl", 0.0),
        }

    def _run_forex_grid_cycle(
        self,
        cfg: Dict[str, Any],
        broker,
        allocation_pct: float,
        dry_run: bool,
    ) -> tuple[Dict[str, Any], List[Dict[str, Any]]]:
        """Run one 24/7 grid cycle for forex and optional crypto symbols."""
        forex_cfg = cfg.get("forex", {}) if isinstance(cfg, dict) else {}
        pairs = list(forex_cfg.get("pairs") or ["EURUSD", "GBPUSD", "USDJPY"])
        grid_step_pct = float(forex_cfg.get("grid_step_pct", 0.0015) or 0.0015)
        max_legs = max(1, min(int(forex_cfg.get("grid_max_legs_per_pair", 3) or 3), 8))
        take_profit_steps = max(1, min(int(forex_cfg.get("grid_take_profit_steps", 1) or 1), 3))

        crypto_cfg = cfg.get("crypto", {}) if isinstance(cfg, dict) else {}
        crypto_enabled = bool(crypto_cfg.get("enabled", False))
        crypto_advanced = bool(crypto_cfg.get("advanced_user_confirmed", False))
        crypto_ack = bool(crypto_cfg.get("risk_acknowledged", False))
        crypto_symbols = [
            str(sym or "").upper().strip()
            for sym in (crypto_cfg.get("symbols") or ["BTC-USD", "ETH-USD"])
            if str(sym or "").strip()
        ]
        crypto_max_position_pct = float(crypto_cfg.get("max_position_size_pct", 2.5) or 2.5)
        crypto_symbol_exposure_pct = float(
            crypto_cfg.get("max_symbol_exposure_pct", crypto_max_position_pct) or crypto_max_position_pct
        )
        crypto_min_notional = float(crypto_cfg.get("min_notional_usd", 50.0) or 50.0)
        crypto_daily_loss_limit = max(
            50.0,
            float(crypto_cfg.get("daily_loss_limit_usd", state.get("crypto_daily_loss_limit", 750.0)) or 750.0),
        )
        crypto_grid_step_pct = float(crypto_cfg.get("grid_step_pct", grid_step_pct * 2.0) or (grid_step_pct * 2.0))
        crypto_max_legs = max(1, min(int(crypto_cfg.get("grid_max_legs_per_symbol", max_legs) or max_legs), 6))
        crypto_take_profit_steps = max(
            1,
            min(int(crypto_cfg.get("grid_take_profit_steps", take_profit_steps) or take_profit_steps), 3),
        )

        if not (crypto_enabled and crypto_ack and crypto_advanced):
            crypto_symbols = []

        today_key = datetime.now().strftime("%Y-%m-%d")
        if state.get("crypto_daily_loss_date") != today_key:
            state["crypto_daily_loss_date"] = today_key
            state["crypto_daily_loss_current"] = 0.0
            state["crypto_daily_loss_halted"] = False

        state["crypto_daily_loss_limit"] = round(float(crypto_daily_loss_limit), 2)
        if float(state.get("crypto_daily_loss_current", 0.0) or 0.0) <= -float(crypto_daily_loss_limit):
            state["crypto_daily_loss_halted"] = True

        account_total = 100000.0
        try:
            if broker is not None:
                snapshot = run_async(broker.get_account_snapshot())
                account_total = float(getattr(snapshot, "total_value", 0.0) or 0.0) or account_total
        except Exception:
            account_total = 100000.0

        grid_capital = max(5000.0, account_total * (allocation_pct / 100.0))
        forex_budget = grid_capital * (0.7 if crypto_symbols else 1.0)
        crypto_budget = max(0.0, grid_capital - forex_budget)

        pair_budget = forex_budget / max(1, len(pairs))
        per_leg_budget = pair_budget / max(1, max_legs * 2)

        crypto_symbol_budget = crypto_budget / max(1, len(crypto_symbols))
        crypto_per_leg_budget = crypto_symbol_budget / max(1, crypto_max_legs * 2)

        grid_state = state.setdefault("forex_grid_state", {"pairs": {}, "last_cycle": None})
        pair_states = grid_state.setdefault("pairs", {})

        opened = 0
        closed = 0
        realized_total = 0.0
        crypto_realized_cycle = 0.0
        crypto_open_blocked = 0
        crypto_halted_before = bool(state.get("crypto_daily_loss_halted", False))
        trade_rows: List[Dict[str, Any]] = []

        def _symbol_notional_exposure(symbol_state: Dict[str, Any], mark_price: float) -> float:
            longs = sum(max(0.0, float(leg.get("quantity", 0.0) or 0.0)) for leg in (symbol_state.get("open_longs") or []))
            shorts = sum(max(0.0, float(leg.get("quantity", 0.0) or 0.0)) for leg in (symbol_state.get("open_shorts") or []))
            return round((longs + shorts) * max(mark_price, 0.0), 2)

        for pair in pairs:
            price = self._get_grid_spot_price("forex", pair)
            if price <= 0:
                continue

            qty = max(1000, min(int(per_leg_budget), 50000))
            pair_state = pair_states.setdefault(
                pair,
                {
                    "anchor": price,
                    "open_longs": [],
                    "open_shorts": [],
                    "realized_pnl": 0.0,
                    "asset_type": "forex",
                },
            )

            anchor = float(pair_state.get("anchor", price) or price)
            pair_state["last_price"] = round(float(price), 5)
            pair_state["last_updated"] = datetime.now().isoformat()
            pair_state["asset_type"] = "forex"

            # Keep grid continuously active: seed a starter leg when pair has no exposure.
            if not pair_state["open_longs"] and not pair_state["open_shorts"]:
                starter_side = "buy" if (int(datetime.now().timestamp() // 60) + len(pair)) % 2 == 0 else "sell"
                starter_submitted = self._submit_grid_order(
                    broker=broker,
                    symbol=pair,
                    side=starter_side,
                    quantity=qty,
                    dry_run=dry_run,
                    asset_type="forex",
                )
                if starter_submitted:
                    leg = {"entry_price": price, "quantity": qty, "opened_at": datetime.now().isoformat()}
                    if starter_side == "buy":
                        pair_state["open_longs"].append(leg)
                    else:
                        pair_state["open_shorts"].append(leg)
                    opened += 1

            long_trigger = anchor * (1.0 - grid_step_pct * (len(pair_state["open_longs"]) + 1))
            pair_state["next_long_trigger"] = round(float(long_trigger), 5)
            if price <= long_trigger and len(pair_state["open_longs"]) < max_legs:
                submitted = self._submit_grid_order(
                    broker=broker,
                    symbol=pair,
                    side="buy",
                    quantity=qty,
                    dry_run=dry_run,
                    asset_type="forex",
                )
                if submitted:
                    pair_state["open_longs"].append({"entry_price": price, "quantity": qty, "opened_at": datetime.now().isoformat()})
                    opened += 1

            short_trigger = anchor * (1.0 + grid_step_pct * (len(pair_state["open_shorts"]) + 1))
            pair_state["next_short_trigger"] = round(float(short_trigger), 5)
            if price >= short_trigger and len(pair_state["open_shorts"]) < max_legs:
                submitted = self._submit_grid_order(
                    broker=broker,
                    symbol=pair,
                    side="sell",
                    quantity=qty,
                    dry_run=dry_run,
                    asset_type="forex",
                )
                if submitted:
                    pair_state["open_shorts"].append({"entry_price": price, "quantity": qty, "opened_at": datetime.now().isoformat()})
                    opened += 1

            tp_pct = grid_step_pct * take_profit_steps

            remaining_longs = []
            for leg in pair_state["open_longs"]:
                entry = float(leg.get("entry_price", price) or price)
                leg_qty = int(leg.get("quantity", qty) or qty)
                if price >= entry * (1.0 + tp_pct):
                    submitted = self._submit_grid_order(
                        broker=broker,
                        symbol=pair,
                        side="sell",
                        quantity=leg_qty,
                        dry_run=dry_run,
                        asset_type="forex",
                    )
                    if submitted:
                        pnl = (price - entry) * leg_qty
                        fees = max(0.5, leg_qty * 0.00002)
                        net = round(float(pnl - fees), 2)
                        realized_total += net
                        pair_state["realized_pnl"] = round(float(pair_state.get("realized_pnl", 0.0) or 0.0) + net, 2)
                        closed += 1
                        trade_rows.append(
                            self._build_grid_trade_row(
                                symbol=pair,
                                entry_side="buy",
                                quantity=leg_qty,
                                entry_price=entry,
                                exit_price=price,
                                net_pnl=net,
                                dry_run=dry_run,
                                asset_type="forex",
                            )
                        )
                        continue
                remaining_longs.append(leg)
            pair_state["open_longs"] = remaining_longs

            remaining_shorts = []
            for leg in pair_state["open_shorts"]:
                entry = float(leg.get("entry_price", price) or price)
                leg_qty = int(leg.get("quantity", qty) or qty)
                if price <= entry * (1.0 - tp_pct):
                    submitted = self._submit_grid_order(
                        broker=broker,
                        symbol=pair,
                        side="buy",
                        quantity=leg_qty,
                        dry_run=dry_run,
                        asset_type="forex",
                    )
                    if submitted:
                        pnl = (entry - price) * leg_qty
                        fees = max(0.5, leg_qty * 0.00002)
                        net = round(float(pnl - fees), 2)
                        realized_total += net
                        pair_state["realized_pnl"] = round(float(pair_state.get("realized_pnl", 0.0) or 0.0) + net, 2)
                        closed += 1
                        trade_rows.append(
                            self._build_grid_trade_row(
                                symbol=pair,
                                entry_side="sell",
                                quantity=leg_qty,
                                entry_price=entry,
                                exit_price=price,
                                net_pnl=net,
                                dry_run=dry_run,
                                asset_type="forex",
                            )
                        )
                        continue
                remaining_shorts.append(leg)
            pair_state["open_shorts"] = remaining_shorts

            if not pair_state["open_longs"] and not pair_state["open_shorts"]:
                pair_state["anchor"] = price

        for symbol in crypto_symbols:
            price = self._get_grid_spot_price("crypto", symbol)
            if price <= 0:
                continue

            max_symbol_budget = account_total * (max(0.1, crypto_max_position_pct) / 100.0)
            symbol_exposure_cap = account_total * (max(0.1, crypto_symbol_exposure_pct) / 100.0)
            effective_leg_budget = min(max(crypto_per_leg_budget, crypto_min_notional), max_symbol_budget)
            qty = round(max(0.0001, effective_leg_budget / max(price, 1e-9)), 6)
            qty = min(qty, 3.0)
            if qty <= 0:
                continue

            pair_state = pair_states.setdefault(
                symbol,
                {
                    "anchor": price,
                    "open_longs": [],
                    "open_shorts": [],
                    "realized_pnl": 0.0,
                    "asset_type": "crypto",
                },
            )

            anchor = float(pair_state.get("anchor", price) or price)
            pair_state["last_price"] = round(float(price), 4)
            pair_state["last_updated"] = datetime.now().isoformat()
            pair_state["asset_type"] = "crypto"
            pair_state["exposure_cap"] = round(float(symbol_exposure_cap), 2)
            current_exposure = _symbol_notional_exposure(pair_state, price)
            pair_state["exposure_notional"] = current_exposure
            pair_state["risk_blocked"] = None

            if state.get("crypto_daily_loss_halted", False):
                pair_state["risk_blocked"] = "daily_loss_limit"

            if not pair_state["open_longs"] and not pair_state["open_shorts"] and not state.get("crypto_daily_loss_halted", False):
                projected_exposure = current_exposure + (qty * price)
                if projected_exposure > symbol_exposure_cap + 1e-9:
                    crypto_open_blocked += 1
                    pair_state["risk_blocked"] = "exposure_cap"
                else:
                    starter_submitted = self._submit_grid_order(
                        broker=broker,
                        symbol=symbol,
                        side="buy",
                        quantity=qty,
                        dry_run=dry_run,
                        asset_type="crypto",
                    )
                    if starter_submitted:
                        pair_state["open_longs"].append({"entry_price": price, "quantity": qty, "opened_at": datetime.now().isoformat()})
                        opened += 1
                        current_exposure = _symbol_notional_exposure(pair_state, price)
                        pair_state["exposure_notional"] = current_exposure

            long_trigger = anchor * (1.0 - crypto_grid_step_pct * (len(pair_state["open_longs"]) + 1))
            pair_state["next_long_trigger"] = round(float(long_trigger), 4)
            if price <= long_trigger and len(pair_state["open_longs"]) < crypto_max_legs and not state.get("crypto_daily_loss_halted", False):
                projected_exposure = current_exposure + (qty * price)
                if projected_exposure > symbol_exposure_cap + 1e-9:
                    crypto_open_blocked += 1
                    pair_state["risk_blocked"] = "exposure_cap"
                else:
                    submitted = self._submit_grid_order(
                        broker=broker,
                        symbol=symbol,
                        side="buy",
                        quantity=qty,
                        dry_run=dry_run,
                        asset_type="crypto",
                    )
                    if submitted:
                        pair_state["open_longs"].append({"entry_price": price, "quantity": qty, "opened_at": datetime.now().isoformat()})
                        opened += 1
                        current_exposure = _symbol_notional_exposure(pair_state, price)
                        pair_state["exposure_notional"] = current_exposure

            short_trigger = anchor * (1.0 + crypto_grid_step_pct * (len(pair_state["open_shorts"]) + 1))
            pair_state["next_short_trigger"] = round(float(short_trigger), 4)
            if price >= short_trigger and len(pair_state["open_shorts"]) < crypto_max_legs and not state.get("crypto_daily_loss_halted", False):
                projected_exposure = current_exposure + (qty * price)
                if projected_exposure > symbol_exposure_cap + 1e-9:
                    crypto_open_blocked += 1
                    pair_state["risk_blocked"] = "exposure_cap"
                else:
                    submitted = self._submit_grid_order(
                        broker=broker,
                        symbol=symbol,
                        side="sell",
                        quantity=qty,
                        dry_run=dry_run,
                        asset_type="crypto",
                    )
                    if submitted:
                        pair_state["open_shorts"].append({"entry_price": price, "quantity": qty, "opened_at": datetime.now().isoformat()})
                        opened += 1
                        current_exposure = _symbol_notional_exposure(pair_state, price)
                        pair_state["exposure_notional"] = current_exposure

            tp_pct = crypto_grid_step_pct * crypto_take_profit_steps

            remaining_longs = []
            for leg in pair_state["open_longs"]:
                entry = float(leg.get("entry_price", price) or price)
                leg_qty = float(leg.get("quantity", qty) or qty)
                if price >= entry * (1.0 + tp_pct):
                    submitted = self._submit_grid_order(
                        broker=broker,
                        symbol=symbol,
                        side="sell",
                        quantity=leg_qty,
                        dry_run=dry_run,
                        asset_type="crypto",
                    )
                    if submitted:
                        pnl = (price - entry) * leg_qty
                        fees = max(0.25, (entry + price) * 0.5 * leg_qty * 0.001)
                        net = round(float(pnl - fees), 2)
                        realized_total += net
                        crypto_realized_cycle += net
                        state["crypto_daily_loss_current"] = round(
                            float(state.get("crypto_daily_loss_current", 0.0) or 0.0) + net,
                            2,
                        )
                        pair_state["realized_pnl"] = round(float(pair_state.get("realized_pnl", 0.0) or 0.0) + net, 2)
                        closed += 1
                        trade_rows.append(
                            self._build_grid_trade_row(
                                symbol=symbol,
                                entry_side="buy",
                                quantity=leg_qty,
                                entry_price=entry,
                                exit_price=price,
                                net_pnl=net,
                                dry_run=dry_run,
                                asset_type="crypto",
                            )
                        )
                        continue
                remaining_longs.append(leg)
            pair_state["open_longs"] = remaining_longs

            remaining_shorts = []
            for leg in pair_state["open_shorts"]:
                entry = float(leg.get("entry_price", price) or price)
                leg_qty = float(leg.get("quantity", qty) or qty)
                if price <= entry * (1.0 - tp_pct):
                    submitted = self._submit_grid_order(
                        broker=broker,
                        symbol=symbol,
                        side="buy",
                        quantity=leg_qty,
                        dry_run=dry_run,
                        asset_type="crypto",
                    )
                    if submitted:
                        pnl = (entry - price) * leg_qty
                        fees = max(0.25, (entry + price) * 0.5 * leg_qty * 0.001)
                        net = round(float(pnl - fees), 2)
                        realized_total += net
                        crypto_realized_cycle += net
                        state["crypto_daily_loss_current"] = round(
                            float(state.get("crypto_daily_loss_current", 0.0) or 0.0) + net,
                            2,
                        )
                        pair_state["realized_pnl"] = round(float(pair_state.get("realized_pnl", 0.0) or 0.0) + net, 2)
                        closed += 1
                        trade_rows.append(
                            self._build_grid_trade_row(
                                symbol=symbol,
                                entry_side="sell",
                                quantity=leg_qty,
                                entry_price=entry,
                                exit_price=price,
                                net_pnl=net,
                                dry_run=dry_run,
                                asset_type="crypto",
                            )
                        )
                        continue
                remaining_shorts.append(leg)
            pair_state["open_shorts"] = remaining_shorts
            pair_state["exposure_notional"] = _symbol_notional_exposure(pair_state, price)

            if not pair_state["open_longs"] and not pair_state["open_shorts"]:
                pair_state["anchor"] = price

        grid_state["last_cycle"] = datetime.now().isoformat()

        if float(state.get("crypto_daily_loss_current", 0.0) or 0.0) <= -float(crypto_daily_loss_limit):
            state["crypto_daily_loss_halted"] = True

        if state.get("crypto_daily_loss_halted", False) and not crypto_halted_before:
            append_bot_log(
                "Crypto entry circuit breaker triggered",
                level="warning",
                details={
                    "daily_loss_current": state.get("crypto_daily_loss_current", 0.0),
                    "daily_loss_limit": round(float(crypto_daily_loss_limit), 2),
                },
            )

        summary = {
            "pairs_processed": len(pairs),
            "crypto_symbols_processed": len(crypto_symbols),
            "opened": opened,
            "closed": closed,
            "realized_pnl": round(realized_total, 2),
            "crypto_realized_pnl": round(float(crypto_realized_cycle), 2),
            "grid_step_pct": round(grid_step_pct * 100, 3),
            "max_legs_per_pair": max_legs,
            "grid_capital": round(grid_capital, 2),
            "crypto_enabled": bool(crypto_symbols),
            "crypto_open_blocked": int(crypto_open_blocked),
            "crypto_daily_loss_current": round(float(state.get("crypto_daily_loss_current", 0.0) or 0.0), 2),
            "crypto_daily_loss_limit": round(float(crypto_daily_loss_limit), 2),
            "crypto_daily_loss_halted": bool(state.get("crypto_daily_loss_halted", False)),
        }
        return summary, trade_rows

    def _submit_grid_order(
        self,
        broker,
        symbol: str,
        side: str,
        quantity: float,
        dry_run: bool,
        asset_type: str,
    ) -> bool:
        if dry_run:
            return True
        if broker is None:
            return False
        if state.get("broker_name") != "ibkr":
            return False

        method_name = "place_forex_order" if asset_type == "forex" else "place_crypto_order"
        if not hasattr(broker, method_name):
            return False

        try:
            if asset_type == "forex":
                order = run_async(broker.place_forex_order(pair=symbol, side=side, quantity=int(quantity)))
            else:
                order = run_async(broker.place_crypto_order(symbol=symbol, side=side, quantity=float(quantity)))
            return bool(order and getattr(order, "status", "") != "failed")
        except Exception:
            return False

    def _build_grid_trade_row(
        self,
        symbol: str,
        entry_side: str,
        quantity: float,
        entry_price: float,
        exit_price: float,
        net_pnl: float,
        dry_run: bool,
        asset_type: str,
    ) -> Dict[str, Any]:
        quantity_value: Any = int(quantity) if asset_type == "forex" else round(float(quantity), 6)
        fee_estimate = max(0.5, float(quantity) * 0.00002)
        if asset_type == "crypto":
            fee_estimate = max(0.25, ((float(entry_price) + float(exit_price)) * 0.5 * float(quantity) * 0.001))

        return {
            "trade_id": f"GRID-{datetime.now().strftime('%Y%m%d%H%M%S%f')}",
            "timestamp": datetime.now().isoformat(),
            "strategy": "forex_grid" if asset_type == "forex" else "crypto_grid",
            "asset_type": asset_type,
            "symbol": symbol,
            "underlying": symbol,
            "side": entry_side,
            "quantity": quantity_value,
            "entry_price": round(float(entry_price), 5),
            "exit_price": round(float(exit_price), 5),
            "fees": round(float(fee_estimate), 2),
            "gross_pnl": round(float(net_pnl), 2),
            "net_pnl": round(float(net_pnl), 2),
            "status": "closed",
            "order_submitted": not dry_run,
            "execution_origin": "simulated" if dry_run else "live_paper",
            "is_simulated": bool(dry_run),
            "notes": "Forex grid leg close" if asset_type == "forex" else "Crypto grid leg close",
        }

    def _get_grid_spot_price(self, asset_type: str, symbol: str) -> float:
        normalized = str(symbol or "").upper().strip()
        if not normalized:
            return 0.0

        ticker = f"{normalized}=X" if asset_type == "forex" else normalized
        try:
            hist = yf.Ticker(ticker).history(period="5d", interval="5m")
            if hist is not None and not hist.empty and "Close" in hist.columns:
                closes = hist["Close"].dropna()
                if not closes.empty:
                    return float(closes.iloc[-1])
        except Exception:
            pass

        if asset_type == "crypto":
            crypto_fallback = {
                "BTC-USD": 65000.0,
                "ETH-USD": 3200.0,
                "SOL-USD": 145.0,
                "BNB-USD": 540.0,
            }
            return float(crypto_fallback.get(normalized, 100.0))

        forex_fallback = {
            "EURUSD": 1.08,
            "GBPUSD": 1.27,
            "USDJPY": 149.5,
            "AUDUSD": 0.66,
            "NZDUSD": 0.60,
        }
        return float(forex_fallback.get(normalized, 1.0))


bot_runner = BotRunner()


def run_async(coro):
    """Run async broker methods from sync Flask handlers."""
    future = asyncio.run_coroutine_threadsafe(coro, _ASYNC_LOOP)
    return future.result()


def load_broker_from_env():
    """Create and connect a broker from environment variables."""
    broker_type = os.getenv("BROKER_TYPE", "ibkr").lower().strip()

    if broker_type in {"", "demo", "mock"}:
        return None, "demo", {"mode": "demo"}

    return build_and_connect_broker(broker_type)


def _tcp_port_open(host: str, port: int, timeout: float = 0.35) -> bool:
    """Fast local TCP probe for broker API ports."""
    try:
        with socket.create_connection((host, int(port)), timeout=timeout):
            return True
    except Exception:
        return False


def _candidate_ib_ports(overrides: dict) -> list[int]:
    """Build ordered list of IB ports to try."""
    explicit = overrides.get("port")
    if explicit is not None:
        return [int(explicit)]

    ordered = []
    env_port = os.getenv("IB_PORT")
    if env_port:
        ordered.append(int(env_port))

    # Prefer Gateway paper first, then TWS paper, then live defaults.
    ordered.extend([4002, 7497, 4001, 7496])

    # Preserve order while removing duplicates.
    unique = []
    seen = set()
    for p in ordered:
        if p not in seen:
            seen.add(p)
            unique.append(int(p))
    return unique


def _candidate_ib_client_ids(overrides: dict) -> list[int]:
    """Build ordered list of IB client IDs to try."""
    explicit = overrides.get("client_id")
    if explicit is not None:
        return [int(explicit)]

    ordered: list[int] = []

    # Strongly prefer IDs we've already used successfully in this process.
    runtime_cfg = state.get("broker_runtime_config") or {}
    runtime_client = runtime_cfg.get("client_id")
    if runtime_client is not None:
        ordered.append(int(runtime_client))

    last_client = state.get("last_ib_client_id")
    if last_client is not None:
        ordered.append(int(last_client))

    env_client = os.getenv("IB_CLIENT_ID")
    if env_client is not None:
        ordered.append(int(env_client))
    else:
        ordered.append(100)

    # Keep fallback scan small to avoid creating many extra API client sessions.
    anchor = ordered[0] if ordered else 100
    ordered.extend([anchor + 1, anchor + 2, anchor + 3])

    unique: list[int] = []
    seen = set()
    for cid in ordered:
        if cid in seen:
            continue
        seen.add(cid)
        unique.append(int(cid))
    return unique


def _normalize_market(value: str | None) -> str:
    market = str(value or "us").strip().lower()
    return market if market in {"us", "hk", "jp", "kr"} else "us"


def _ticker_with_market(symbol: str, market: str) -> str:
    raw = str(symbol or "").strip().upper()
    if not raw:
        return raw
    if "." in raw:
        return raw

    mkt = _normalize_market(market)
    if mkt == "hk":
        # Yahoo HK format uses 4-digit code, e.g. 0700.HK
        if raw.isdigit() and len(raw) <= 4:
            raw = raw.zfill(4)
        return f"{raw}.HK"
    if mkt == "jp":
        return f"{raw}.T"
    if mkt == "kr":
        # Yahoo KR commonly uses 6-digit code + .KS for KOSPI
        if raw.isdigit() and len(raw) <= 6:
            raw = raw.zfill(6)
        return f"{raw}.KS"
    return raw


def _safe_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        out = float(value)
        return out if out == out else None
    except Exception:
        return None


def _first_non_empty(*values: Any) -> Any:
    for value in values:
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        return value
    return None


def _fast_info_value(fast_info: Any, *keys: str) -> Any:
    if fast_info is None:
        return None

    getter = getattr(fast_info, "get", None)
    for key in keys:
        try:
            value = getter(key) if callable(getter) else getattr(fast_info, key, None)
        except Exception:
            value = None
        if value is not None:
            return value
    return None


def _estimate_dcf(info: dict, current_price: float) -> dict[str, Any]:
    """Estimate a simple 5-year DCF fair value per share from Yahoo fundamentals."""
    fcf = _safe_float(info.get("freeCashflow"))
    shares = _safe_float(info.get("sharesOutstanding"))

    if not fcf or not shares or fcf <= 0 or shares <= 0:
        return {
            "available": False,
            "reason": "Missing or non-positive free cash flow / shares outstanding",
        }

    revenue_growth = _safe_float(info.get("revenueGrowth"))
    growth_rate = 0.08
    if revenue_growth is not None:
        growth_rate = max(0.02, min(0.18, float(revenue_growth)))

    discount_rate = 0.10
    terminal_growth = 0.025

    projected_fcfs = []
    running_fcf = fcf
    pv_sum = 0.0

    for year in range(1, 6):
        running_fcf *= (1.0 + growth_rate)
        projected_fcfs.append(running_fcf)
        pv_sum += running_fcf / ((1.0 + discount_rate) ** year)

    terminal_fcf = projected_fcfs[-1] * (1.0 + terminal_growth)
    terminal_value = terminal_fcf / max(1e-9, (discount_rate - terminal_growth))
    terminal_pv = terminal_value / ((1.0 + discount_rate) ** 5)

    enterprise_value = pv_sum + terminal_pv
    fair_value_per_share = enterprise_value / shares
    upside_pct = ((fair_value_per_share / max(1e-9, current_price)) - 1.0) * 100.0 if current_price > 0 else None

    return {
        "available": True,
        "fair_value": round(fair_value_per_share, 4),
        "current_price": round(current_price, 4),
        "upside_pct": round(upside_pct, 2) if upside_pct is not None else None,
        "assumptions": {
            "growth_rate": round(growth_rate, 4),
            "discount_rate": round(discount_rate, 4),
            "terminal_growth": round(terminal_growth, 4),
            "base_fcf": round(fcf, 2),
            "shares_outstanding": int(shares),
        },
    }


def build_and_connect_broker(broker_type: str, overrides: dict = None):
    """Build and connect to requested broker type."""
    overrides = overrides or {}
    broker_type = broker_type.lower().strip()

    if broker_type == "alpaca":
        key_id = overrides.get("api_key") or os.getenv("ALPACA_API_KEY") or os.getenv("APCA_API_KEY_ID")
        secret_key = overrides.get("api_secret") or os.getenv("ALPACA_API_SECRET") or os.getenv("APCA_API_SECRET_KEY")
        base_url = overrides.get("base_url") or os.getenv("ALPACA_BASE_URL", "https://paper-api.alpaca.markets")
        if not key_id or not secret_key:
            raise ValueError("Missing Alpaca API credentials (ALPACA_API_KEY/APCA_API_KEY_ID and ALPACA_API_SECRET/APCA_API_SECRET_KEY)")

        broker = BrokerFactory.create_broker(
            "alpaca",
            api_key=key_id,
            api_secret=secret_key,
            base_url=base_url,
            paper_trading=True,
        )
        connected = run_async(broker.connect())
        if not connected:
            raise RuntimeError("Failed to connect to Alpaca")
        return broker, "alpaca", {
            "base_url": base_url,
            "paper_trading": True,
        }

    if broker_type == "ibkr":
        host = overrides.get("host") or os.getenv("IB_HOST", "127.0.0.1")
        ports = _candidate_ib_ports(overrides)
        client_ids = _candidate_ib_client_ids(overrides)

        errors = []
        for port in ports:
            if not _tcp_port_open(host, int(port)):
                errors.append(f"{host}:{port} unreachable")
                continue

            for client_id in client_ids:
                broker = BrokerFactory.create_broker(
                    "ibkr",
                    host=host,
                    port=int(port),
                    client_id=int(client_id),
                    paper_trading=True,
                )
                connected = run_async(broker.connect())
                if connected:
                    state["last_ib_client_id"] = int(client_id)
                    return broker, "ibkr", {
                        "host": host,
                        "port": int(port),
                        "client_id": int(client_id),
                        "paper_trading": True,
                        "auto_detected": overrides.get("port") is None or overrides.get("client_id") is None,
                    }
                errors.append(f"connect failed at {host}:{port} client_id={client_id}")

        raise RuntimeError("Failed to connect to IBKR. Tried: " + "; ".join(errors[:8]))

    raise ValueError(f"Unsupported BROKER_TYPE: {broker_type}")


def switch_broker(broker_type: str, config: dict = None):
    """Disconnect existing broker and switch to requested one."""
    broker_type = (broker_type or "").lower().strip()
    config = config or {}
    current = state.get("broker")

    # Reuse existing IBKR connection when caller requests IBKR with compatible config.
    if broker_type == "ibkr" and isinstance(current, IBKRBroker):
        desired_host = str(config.get("host") or os.getenv("IB_HOST", "127.0.0.1"))
        desired_port = int(config.get("port") or state.get("broker_runtime_config", {}).get("port") or os.getenv("IB_PORT", "7497"))
        desired_client = int(
            config.get("client_id")
            or state.get("broker_runtime_config", {}).get("client_id")
            or state.get("last_ib_client_id")
            or os.getenv("IB_CLIENT_ID", "100")
        )

        if (
            getattr(current, "connected", False)
            and str(getattr(current, "host", "")) == desired_host
            and int(getattr(current, "port", 0) or 0) == desired_port
            and int(getattr(current, "client_id", -1) or -1) == desired_client
        ):
            return "ibkr", state.get("broker_runtime_config", {})

    if current is not None:
        try:
            run_async(current.disconnect())
        except Exception as e:
            logger.warning(f"Failed to disconnect current broker cleanly: {e}")

    broker, name, runtime_cfg = build_and_connect_broker(broker_type, config)
    state["broker"] = broker
    state["broker_name"] = name
    state["broker_runtime_config"] = runtime_cfg or {}
    return name, runtime_cfg


def get_positions_for_recommendation():
    """Get current positions for recommendation scoring."""
    if state["broker"] is None:
        return MockPortfolioGenerator().generate_positions()

    broker_positions = run_async(state["broker"].get_positions()) or []
    return [asdict(p) for p in broker_positions]


def _parse_bar_date(ts: Any):
    """Best-effort parse for broker bar timestamp/date values."""
    if isinstance(ts, datetime):
        return ts.date()
    if ts is None:
        return None
    text = str(ts).strip()
    if not text:
        return None
    text = text.replace("Z", "+00:00")
    for fmt in (
        "%Y-%m-%d",
        "%Y%m%d",
        "%Y-%m-%d %H:%M:%S",
        "%Y%m%d %H:%M:%S",
    ):
        try:
            return datetime.strptime(text[:19], fmt).date()
        except Exception:
            continue
    try:
        return datetime.fromisoformat(text).date()
    except Exception:
        return None


def build_live_portfolio_history(days: int):
    """Build daily pnl history from live broker snapshots/historical bars."""
    broker = state.get("broker")
    if broker is None:
        return None

    try:
        days = max(2, int(days))
        end_date = datetime.now().date()
        date_list = [end_date - timedelta(days=i) for i in range(days - 1, -1, -1)]

        account = run_async(broker.get_account_snapshot())
        cash = float(getattr(account, "cash", 0.0) or 0.0)
        positions = run_async(broker.get_positions()) or []

        # Start with constant cash line, then add mark-to-market from each position's history.
        daily_value = {d: cash for d in date_list}

        bar_size = "1 day" if state.get("broker_name") == "ibkr" else "1Day"
        for pos in positions:
            if str(getattr(pos, "asset_type", "")).lower() != "stock":
                continue

            symbol = getattr(pos, "symbol", "")
            qty = float(getattr(pos, "quantity", 0.0) or 0.0)
            if not symbol or qty == 0:
                continue

            bars = run_async(broker.get_historical_data(symbol, bar_size=bar_size, lookback_days=days + 7)) or []
            if not bars:
                continue

            closes = {}
            for bar in bars:
                d = _parse_bar_date(bar.get("timestamp"))
                c = bar.get("close")
                if d is None or c is None:
                    continue
                try:
                    closes[d] = float(c)
                except Exception:
                    continue

            if not closes:
                continue

            running_price = float(getattr(pos, "current_price", 0.0) or 0.0)
            for d in date_list:
                if d in closes:
                    running_price = closes[d]
                daily_value[d] += qty * running_price

        values = [daily_value[d] for d in date_list]
        if not values:
            return []

        baseline = values[0]
        prev = baseline
        out = []
        for d, value in zip(date_list, values):
            daily_pnl = value - prev
            cumulative = value - baseline
            daily_pct = (daily_pnl / prev * 100.0) if prev else 0.0
            out.append(
                {
                    "date": d.isoformat(),
                    "daily_pnl": round(daily_pnl, 2),
                    "daily_pnl_pct": round(daily_pct, 2),
                    "cumulative_pnl": round(cumulative, 2),
                }
            )
            prev = value

        return out
    except Exception as e:
        logger.error(f"Error building live portfolio history: {e}")
        return None


@app.before_request
def initialize():
    """Initialize broker and config on first request."""
    if state["broker"] is None and not state.get("broker_init_attempted", False):
        state["broker_init_attempted"] = True
        try:
            state["config_manager"] = ConfigManager()
            state["broker"], state["broker_name"], state["broker_runtime_config"] = load_broker_from_env()
            logger.info(f"Broker initialized: {state['broker_name']}")
        except Exception as e:
            logger.error(f"Broker initialization failed: {e}")
            # Fall back to mock data
            state["broker"] = None
            state["broker_name"] = "demo"
            state["broker_runtime_config"] = {}
            state["broker_init_error"] = str(e)

    # Auto-start bot runner so forex grid can run continuously once backend is up.
    if state.get("broker_init_attempted", False) and not state.get("bot_auto_started", False):
        state["bot_auto_started"] = True
        try:
            auto_start_enabled = os.getenv("AUTO_START_BOT", "true").strip().lower() not in {"0", "false", "no"}
            if auto_start_enabled and state.get("broker") is not None and not bot_runner.is_running():
                interval = int(os.getenv("BOT_INTERVAL_SECONDS", "60"))
                state["execution_mode"] = "automatic"
                # Run live-paper by default when auto-starting with connected broker.
                state["bot_dry_run"] = False
                bot_runner.start(interval_seconds=max(10, interval))
                append_bot_log(
                    "Bot auto-started",
                    level="warning",
                    details={
                        "execution_mode": state.get("execution_mode"),
                        "dry_run": state.get("bot_dry_run"),
                        "interval_seconds": max(10, interval),
                    },
                )
        except Exception as e:
            logger.error(f"Auto-start bot initialization failed: {e}")
    "SNPS", "SQ", "RBLX", "DDOG", "ZS", "TTD", "WDAY",


def normalize_execution_mode(mode: str) -> str:
    mode = (mode or "manual").strip().lower()
    if mode not in {"manual", "automatic"}:
        raise ValueError("execution mode must be 'manual' or 'automatic'")
    return mode


def _today_local_trade_net_pnl() -> float:
    """Sum net P&L for locally tracked trade records created today."""
    rows = list(state.get("simulated_trade_logs", []))
    if not rows:
        return 0.0

    today = datetime.now().date()
    total = 0.0

    for row in rows:
        timestamp_raw = row.get("timestamp")
        if not timestamp_raw:
            continue
        try:
            ts = datetime.fromisoformat(str(timestamp_raw).replace("Z", "+00:00"))
            ts_date = ts.date()
        except Exception:
            continue

        if ts_date != today:
            continue

        total += float(row.get("net_pnl", 0) or 0)

    return round(total, 2)


# ============ Portfolio & Account Endpoints ============

@app.route("/api/account", methods=["GET"])
def get_account():
    """Get current account snapshot."""
    try:
        if state["broker"] is None:
            # Return mock data
            mock_gen = MockPortfolioGenerator()
            payload = mock_gen.generate_account_snapshot()
            local_today = _today_local_trade_net_pnl()
            payload["daily_pnl"] = round(float(payload.get("daily_pnl", 0) or 0) + local_today, 2)
            base = float(payload.get("total_value", 0) or 0) - float(payload.get("total_pnl", 0) or 0)
            payload["daily_pnl_pct"] = round((payload["daily_pnl"] / base * 100.0) if base else 0.0, 2)
            return jsonify(payload), 200
        
        account = run_async(state["broker"].get_account_snapshot())
        payload = asdict(account)

        # IB snapshots may report 0 daily P&L in paper mode right after tiny test trades.
        # Fall back to today's locally tracked trade records so the navbar reflects reality.
        local_today = _today_local_trade_net_pnl()
        reported_daily = float(payload.get("daily_pnl", 0) or 0)
        if abs(reported_daily) < 1e-9 and abs(local_today) > 1e-9:
            payload["daily_pnl"] = round(local_today, 2)
            base = float(payload.get("total_value", 0) or 0) - float(payload.get("total_pnl", 0) or 0)
            payload["daily_pnl_pct"] = round((local_today / base * 100.0) if base else 0.0, 2)

        return jsonify(payload), 200
    except Exception as e:
        logger.error(f"Error getting account: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/positions", methods=["GET"])
def get_positions():
    """Get list of open positions."""
    try:
        if state["broker"] is None:
            mock_gen = MockPortfolioGenerator()
            positions = mock_gen.generate_positions()
            return jsonify({"positions": positions}), 200
        
        positions = run_async(state["broker"].get_positions())
        return jsonify({"positions": [asdict(p) for p in positions]}), 200
    except Exception as e:
        logger.error(f"Error getting positions: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/portfolio-history", methods=["GET"])
def get_portfolio_history():
    """Get daily P&L history for charting."""
    try:
        days = request.args.get("days", 30, type=int)

        history = build_live_portfolio_history(days)
        if not history:
            mock_gen = MockPortfolioGenerator()
            history = mock_gen.generate_daily_pnl_history(days=days)
        return jsonify({"history": history}), 200
    except Exception as e:
        logger.error(f"Error getting portfolio history: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/watchlists", methods=["GET"])
def get_watchlists():
    """Get all watchlists grouped by category."""
    try:
        rows = [_decorate_watchlist(row) for row in list(state.get("watchlists", []))]
        categories = sorted({str(row.get("category", "General") or "General") for row in rows})
        return jsonify({"watchlists": rows, "categories": categories}), 200
    except Exception as e:
        logger.error(f"Error getting watchlists: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/watchlists", methods=["POST"])
def create_watchlist():
    """Create a new watchlist."""
    try:
        data = request.json or {}
        name = str(data.get("name") or "").strip()
        if not name:
            return jsonify({"error": "Watchlist name is required"}), 400

        category = str(data.get("category") or "General").strip() or "General"
        symbols = data.get("symbols") or []
        if isinstance(symbols, str):
            symbols = [s.strip() for s in symbols.split(",")]
        watchlist = {
            "id": str(uuid.uuid4()),
            "name": name,
            "category": category,
            "symbols": sorted({sym for sym in (_normalize_symbol_text(s) for s in symbols) if sym}),
            "notes": str(data.get("notes") or "").strip(),
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
        }

        with WATCHLISTS_LOCK:
            rows = list(state.get("watchlists", []))
            rows.append(watchlist)
            state["watchlists"] = rows
            _save_watchlists(rows)

        return jsonify({"watchlist": _decorate_watchlist(watchlist)}), 201
    except Exception as e:
        logger.error(f"Error creating watchlist: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/watchlists/<watchlist_id>", methods=["PUT"])
def update_watchlist(watchlist_id: str):
    """Update an existing watchlist."""
    try:
        data = request.json or {}
        with WATCHLISTS_LOCK:
            rows = list(state.get("watchlists", []))
            watchlist = _find_row_by_id(rows, watchlist_id)
            if watchlist is None:
                return jsonify({"error": "Watchlist not found"}), 404

            if "name" in data:
                watchlist["name"] = str(data.get("name") or "").strip() or watchlist.get("name", "Watchlist")
            if "category" in data:
                watchlist["category"] = str(data.get("category") or "General").strip() or "General"
            if "notes" in data:
                watchlist["notes"] = str(data.get("notes") or "").strip()
            if "symbols" in data:
                symbols = data.get("symbols") or []
                if isinstance(symbols, str):
                    symbols = [s.strip() for s in symbols.split(",")]
                watchlist["symbols"] = sorted({sym for sym in (_normalize_symbol_text(s) for s in symbols) if sym})

            watchlist["updated_at"] = _now_iso()
            state["watchlists"] = rows
            _save_watchlists(rows)

        return jsonify({"watchlist": _decorate_watchlist(watchlist)}), 200
    except Exception as e:
        logger.error(f"Error updating watchlist: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/watchlists/<watchlist_id>", methods=["DELETE"])
def delete_watchlist(watchlist_id: str):
    """Delete a watchlist."""
    try:
        with WATCHLISTS_LOCK:
            rows = list(state.get("watchlists", []))
            next_rows = [row for row in rows if str(row.get("id")) != str(watchlist_id)]
            if len(next_rows) == len(rows):
                return jsonify({"error": "Watchlist not found"}), 404
            state["watchlists"] = next_rows
            _save_watchlists(next_rows)

        return jsonify({"status": "success"}), 200
    except Exception as e:
        logger.error(f"Error deleting watchlist: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/sim-portfolios", methods=["GET"])
def get_sim_portfolios():
    """Get simulated portfolios with live mark-to-market values."""
    try:
        rows = [_decorate_portfolio(row) for row in list(state.get("simulated_portfolios", []))]
        return jsonify({"portfolios": rows, "account_total_value": round(_current_account_total_value(), 2)}), 200
    except Exception as e:
        logger.error(f"Error getting simulated portfolios: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/sim-portfolios", methods=["POST"])
def create_sim_portfolio():
    """Create a new simulated portfolio seeded with current account value by default."""
    try:
        data = request.json or {}
        name = str(data.get("name") or "").strip() or f"Sandbox {len(state.get('simulated_portfolios', [])) + 1}"
        clone_current = bool(data.get("clone_current_account", True))
        initial_cash_raw = data.get("initial_cash")
        initial_cash = float(initial_cash_raw) if initial_cash_raw not in (None, "") else 0.0

        if initial_cash <= 0 and clone_current:
            initial_cash = _current_account_total_value()
        if initial_cash <= 0:
            initial_cash = 100000.0

        portfolio = {
            "id": str(uuid.uuid4()),
            "name": name,
            "cash": round(initial_cash, 2),
            "starting_cash": round(initial_cash, 2),
            "holdings": [],
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
        }

        with SIM_PORTFOLIOS_LOCK:
            rows = list(state.get("simulated_portfolios", []))
            rows.append(portfolio)
            state["simulated_portfolios"] = rows
            _save_simulated_portfolios(rows)

        return jsonify({"portfolio": _decorate_portfolio(portfolio)}), 201
    except Exception as e:
        logger.error(f"Error creating simulated portfolio: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/sim-portfolios/<portfolio_id>", methods=["DELETE"])
def delete_sim_portfolio(portfolio_id: str):
    """Delete a simulated portfolio."""
    try:
        with SIM_PORTFOLIOS_LOCK:
            rows = list(state.get("simulated_portfolios", []))
            next_rows = [row for row in rows if str(row.get("id")) != str(portfolio_id)]
            if len(next_rows) == len(rows):
                return jsonify({"error": "Portfolio not found"}), 404
            state["simulated_portfolios"] = next_rows
            _save_simulated_portfolios(next_rows)

        return jsonify({"status": "success"}), 200
    except Exception as e:
        logger.error(f"Error deleting simulated portfolio: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/sim-portfolios/<portfolio_id>/holdings", methods=["POST"])
def add_sim_portfolio_holding(portfolio_id: str):
    """Add a holding lot to a simulated portfolio."""
    try:
        data = request.json or {}
        symbol = _normalize_symbol_text(data.get("symbol"))
        if not symbol:
            return jsonify({"error": "Symbol is required"}), 400

        shares_raw = data.get("shares", 0)
        shares = float(shares_raw or 0)
        if shares <= 0:
            return jsonify({"error": "Shares must be greater than zero"}), 400

        buy_date = _parse_iso_date(data.get("buy_date"))
        buy_price_raw = data.get("buy_price")
        price_source = "user_input"
        if buy_price_raw in (None, ""):
            buy_price = _get_latest_market_price(symbol)
            price_source = "current_market"
        else:
            buy_price = float(buy_price_raw)

        if buy_price <= 0:
            return jsonify({"error": f"Unable to resolve a valid price for {symbol}"}), 400

        with SIM_PORTFOLIOS_LOCK:
            rows = list(state.get("simulated_portfolios", []))
            portfolio = _find_row_by_id(rows, portfolio_id)
            if portfolio is None:
                return jsonify({"error": "Portfolio not found"}), 404

            cost = round(shares * buy_price, 2)
            cash = float(portfolio.get("cash", 0) or 0)
            if cost > cash + 1e-9:
                return jsonify({"error": f"Insufficient cash for {symbol}. Need {cost:.2f}, have {cash:.2f}"}), 400

            holding = {
                "id": str(uuid.uuid4()),
                "symbol": symbol,
                "shares": shares,
                "buy_price": round(buy_price, 2),
                "buy_date": buy_date,
                "created_at": _now_iso(),
                "price_source": price_source,
            }
            portfolio.setdefault("holdings", []).append(holding)
            portfolio["cash"] = round(cash - cost, 2)
            portfolio["updated_at"] = _now_iso()
            state["simulated_portfolios"] = rows
            _save_simulated_portfolios(rows)

        return jsonify({"portfolio": _decorate_portfolio(portfolio), "holding": holding}), 201
    except Exception as e:
        logger.error(f"Error adding simulated holding: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/sim-portfolios/<portfolio_id>/holdings/<holding_id>", methods=["DELETE"])
def remove_sim_portfolio_holding(portfolio_id: str, holding_id: str):
    """Sell/remove a holding lot from a simulated portfolio at the current market price."""
    try:
        with SIM_PORTFOLIOS_LOCK:
            rows = list(state.get("simulated_portfolios", []))
            portfolio = _find_row_by_id(rows, portfolio_id)
            if portfolio is None:
                return jsonify({"error": "Portfolio not found"}), 404

            holdings = list(portfolio.get("holdings", []) or [])
            holding = _find_row_by_id(holdings, holding_id)
            if holding is None:
                return jsonify({"error": "Holding not found"}), 404

            symbol = _normalize_symbol_text(holding.get("symbol"))
            shares = float(holding.get("shares", 0) or 0)
            buy_price = float(holding.get("buy_price", 0) or 0)
            current_price = _get_latest_market_price(symbol)
            if current_price <= 0:
                current_price = buy_price

            sale_value = round(shares * current_price, 2)
            cost_basis = round(shares * buy_price, 2)
            realized_pnl = round(sale_value - cost_basis, 2)

            portfolio["cash"] = round(float(portfolio.get("cash", 0) or 0) + sale_value, 2)
            portfolio["holdings"] = [row for row in holdings if str(row.get("id")) != str(holding_id)]
            portfolio["updated_at"] = _now_iso()
            state["simulated_portfolios"] = rows
            _save_simulated_portfolios(rows)

        return jsonify(
            {
                "portfolio": _decorate_portfolio(portfolio),
                "sold": {
                    "holding_id": holding_id,
                    "symbol": symbol,
                    "shares": shares,
                    "sale_price": round(current_price, 4),
                    "realized_pnl": realized_pnl,
                },
            }
        ), 200
    except Exception as e:
        logger.error(f"Error removing simulated holding: {e}")
        return jsonify({"error": str(e)}), 500


# ============ Configuration Endpoints ============

@app.route("/api/config/current", methods=["GET"])
def get_current_config():
    """Get current trading configuration."""
    try:
        config_manager = state["config_manager"] or ConfigManager()
        current_config = config_manager.load_user_config()
        return jsonify(current_config), 200
    except Exception as e:
        logger.error(f"Error getting config: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/config/presets", methods=["GET"])
def get_config_presets():
    """Get available trading mode presets."""
    try:
        config_manager = ConfigManager()
        presets = {}
        for mode in TradingMode:
            if mode != TradingMode.CUSTOM:
                presets[mode.value] = config_manager.get_default_config(mode)
        return jsonify({"presets": presets}), 200
    except Exception as e:
        logger.error(f"Error getting presets: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/config/update", methods=["POST"])
def update_config():
    """Update user configuration."""
    try:
        config_manager = state["config_manager"] or ConfigManager()
        new_config = request.json
        config_manager.save_user_config(new_config)
        return jsonify({"status": "success", "config": new_config}), 200
    except Exception as e:
        logger.error(f"Error updating config: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/mode/set", methods=["POST"])
def set_trading_mode():
    """Set trading mode/strategy allocation."""
    try:
        data = request.json
        mode = data.get("mode", TradingMode.BALANCED.value)
        
        config_manager = state["config_manager"] or ConfigManager()
        config = config_manager.get_default_config(TradingMode(mode))
        config_manager.save_user_config(config)
        
        state["current_mode"] = TradingMode(mode)
        return jsonify({"status": "success", "mode": mode}), 200
    except Exception as e:
        logger.error(f"Error setting mode: {e}")
        return jsonify({"error": str(e)}), 500


# ============ Screening & Analysis Endpoints ============

def _load_screening_configs():
    cfg = (state["config_manager"] or ConfigManager()).load_user_config()
    if not isinstance(cfg, dict):
        return {}, {}, {}
    return (
        dict(cfg.get("fundamental_screener", {}) or {}),
        dict(cfg.get("option_screener", {}) or {}),
        dict(cfg.get("forex", {}) or {}),
    )


def _screen_covered_calls_yfinance(option_cfg: dict):
    symbols = option_cfg.get("symbols") or OptionScreener.DEFAULT_SYMBOLS
    min_premium_pct = float(option_cfg.get("min_premium_pct", 0.5))
    target_delta = float(option_cfg.get("target_delta", 0.25))
    rows = []

    for symbol in symbols:
        try:
            ticker = yf.Ticker(symbol)
            hist = ticker.history(period="5d", interval="1d")
            if hist.empty:
                continue
            spot = float(hist["Close"].iloc[-1])
            if spot <= 0:
                continue

            expiries = list(getattr(ticker, "options", []) or [])
            if not expiries:
                continue
            expiry = expiries[0]
            calls = ticker.option_chain(expiry).calls
            if calls is None or calls.empty:
                continue

            best = None
            best_score = -1e9
            for _, c in calls.iterrows():
                strike = float(c.get("strike") or 0)
                if strike <= spot:
                    continue

                bid = float(c.get("bid") or 0)
                ask = float(c.get("ask") or 0)
                last = float(c.get("lastPrice") or 0)
                premium = (bid + ask) / 2.0 if bid > 0 and ask > 0 else last
                if premium <= 0:
                    continue

                premium_pct = (premium / spot) * 100.0
                if premium_pct < min_premium_pct:
                    continue

                # Coarse delta proxy from moneyness distance.
                delta = max(0.05, min(0.45, 0.5 - ((strike - spot) / spot) * 4.0))
                score = premium_pct * 10.0 - abs(delta - target_delta) * 20.0

                if score > best_score:
                    best_score = score
                    best = {
                        "symbol": symbol,
                        "stock_price": round(spot, 2),
                        "call_strike": round(strike, 2),
                        "call_premium": round(premium, 3),
                        "premium_pct": round(premium_pct, 2),
                        "delta": round(delta, 2),
                        "expiry": expiry.replace("-", ""),
                        "dte": 0,
                        "score": round(score, 2),
                        "reason": f"Nearest-expiry {symbol} OTM call at {strike:.2f} with {premium_pct:.2f}% premium",
                    }

            if best:
                rows.append(best)
        except Exception as e:
            logger.debug(f"Yahoo covered-call screening failed for {symbol}: {e}")

    rows.sort(key=lambda x: x.get("score", 0), reverse=True)
    return rows[:10]


def _screen_forex_yfinance(forex_cfg: dict):
    pairs = forex_cfg.get("pairs") or ["EURUSD", "GBPUSD", "USDJPY"]
    rows = []

    for pair in pairs:
        try:
            ticker = yf.Ticker(f"{pair}=X")
            hist = ticker.history(period="30d", interval="1d")
            if hist.empty or len(hist) < 12:
                continue

            close = hist["Close"].astype(float)
            price = float(close.iloc[-1])
            prev = float(close.iloc[-2]) if len(close) >= 2 else price
            ma5 = float(close.tail(5).mean())
            ma10 = float(close.tail(10).mean())
            ret1d = ((price - prev) / prev * 100.0) if prev else 0.0

            if ma5 > ma10 and ret1d >= 0:
                signal = "buy"
            elif ma5 < ma10 and ret1d <= 0:
                signal = "sell"
            else:
                signal = "neutral"

            momentum = abs(ma5 - ma10) / max(price, 1e-9) * 10000.0
            score = max(0.0, min(100.0, momentum + abs(ret1d) * 8.0))

            if signal == "neutral" and score < 20:
                continue

            rows.append(
                {
                    "symbol": pair,
                    "price": round(price, 5),
                    "signal": signal,
                    "score": round(score, 2),
                    "reason": f"MA5 {'>' if ma5 > ma10 else '<' if ma5 < ma10 else '='} MA10, 1D change {ret1d:.2f}%",
                }
            )
        except Exception as e:
            logger.debug(f"Yahoo forex screening failed for {pair}: {e}")

    rows.sort(key=lambda x: x.get("score", 0), reverse=True)
    return rows

@app.route("/api/screen/blowup-stocks", methods=["GET"])
def screen_blowup_stocks():
    """Get blowup stock opportunities."""
    try:
        fundamental_cfg, _, _ = _load_screening_configs()

        # Finviz-like runtime overrides from query params.
        float_keys = [
            "relative_volume_threshold",
            "pe_ratio_max",
            "forward_pe_ratio_max",
            "price_min",
            "price_max",
            "market_cap_min_millions",
        ]
        for key in float_keys:
            value = request.args.get(key, None, type=float)
            if value is not None:
                fundamental_cfg[key] = float(value)

        market = _normalize_market(request.args.get("market", "us", type=str))

        top_n = request.args.get("top_n", 10, type=int)
        fundamental_cfg["top_n"] = max(5, min(int(top_n or 10), 50))

        screener = FundamentalScreener(config=fundamental_cfg)
        symbols = screener.get_universe(market)
        candidates = run_async(screener.screen(symbols=symbols)) or []

        config_manager = state.get("config_manager") or ConfigManager()
        strategy_cfg = config_manager.load_strategy_config("blowup_stocks") or {}
        exit_rules = strategy_cfg.get("exit_rules") or {}
        risk_controls = strategy_cfg.get("risk_controls") or {}

        target_pct = float(
            exit_rules.get("profit_target_pct", risk_controls.get("take_profit_pct", 5.0)) or 5.0
        )
        stop_pct = float(
            exit_rules.get("stop_loss_pct", risk_controls.get("stop_loss_pct", 2.0)) or 2.0
        )
        hold_days = int(
            exit_rules.get("max_holding_days", risk_controls.get("max_holding_days", 30)) or 30
        )

        enriched = []
        for candidate in candidates:
            row = dict(candidate)
            price = _safe_float(row.get("price"))
            if price and price > 0:
                row["recommended_action"] = "buy"
                row["recommended_entry_price"] = round(price, 2)
                row["recommended_exit_price"] = round(price * (1 + (target_pct / 100.0)), 2)
                row["recommended_stop_loss_price"] = round(price * (1 - (stop_pct / 100.0)), 2)
                row["recommended_holding_days"] = hold_days
                row["recommended_exit_condition"] = (
                    f"Take profit at +{target_pct:.1f}% or stop loss at -{stop_pct:.1f}%, whichever comes first"
                )
            enriched.append(row)
        candidates = enriched

        if top_n is not None and top_n > 0:
            candidates = candidates[:top_n]
        source = "yfinance_live"
        return jsonify({
            "candidates": candidates,
            "meta": {
                "source": source,
                "filters": fundamental_cfg,
                "market": market,
                "top_n": top_n,
            },
        }), 200
    except Exception as e:
        logger.error(f"Error screening stocks: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/screen/covered-calls", methods=["GET"])
def screen_covered_calls():
    """Get covered call opportunities."""
    try:
        _, option_cfg, _ = _load_screening_configs()

        opportunities = []
        source = "yfinance_options"

        broker = state.get("broker")
        if broker is not None:
            positions = run_async(broker.get_positions()) or []
            eligible_symbols = sorted(
                {
                    p.symbol
                    for p in positions
                    if str(getattr(p, "asset_type", "")).lower() == "stock" and float(getattr(p, "quantity", 0)) >= 100
                }
            )
            broker_cfg = dict(option_cfg)
            if eligible_symbols:
                broker_cfg["symbols"] = eligible_symbols
            opportunities = run_async(OptionScreener(config=broker_cfg).screen_for_opportunities(broker)) or []
            source = f"{state.get('broker_name', 'broker')}_options"

        if not opportunities:
            opportunities = _screen_covered_calls_yfinance(option_cfg)
            source = "yfinance_options"

        if not opportunities:
            mock_gen = MockPortfolioGenerator()
            opportunities = mock_gen.generate_covered_call_opportunities()
            source = "demo_fallback"

        return jsonify({"opportunities": opportunities, "meta": {"source": source}}), 200
    except Exception as e:
        logger.error(f"Error screening calls: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/screen/forex", methods=["GET"])
def screen_forex():
    """Get forex trading opportunities."""
    try:
        _, _, forex_cfg = _load_screening_configs()
        opportunities = _screen_forex_yfinance(forex_cfg)
        source = "yfinance_fx"
        if not opportunities:
            mock_gen = MockPortfolioGenerator()
            opportunities = mock_gen.generate_forex_opportunities()
            source = "demo_fallback"
        return jsonify({"opportunities": opportunities, "meta": {"source": source}}), 200
    except Exception as e:
        logger.error(f"Error screening forex: {e}")
        return jsonify({"error": str(e)}), 500


# ============ Trading Endpoints ============

@app.route("/api/trade/place-order", methods=["POST"])
def place_order():
    """Place a new trade order."""
    try:
        data = request.json or {}
        symbol = str(data.get("symbol", "")).upper().strip()
        side = str(data.get("side", "")).lower().strip()  # buy/sell
        quantity_raw = data.get("quantity")
        confirm_live = bool(data.get("confirm_live", False))

        if not symbol:
            return jsonify({"error": "symbol is required"}), 400
        if side not in {"buy", "sell"}:
            return jsonify({"error": "side must be 'buy' or 'sell'"}), 400

        try:
            quantity = float(quantity_raw)
        except Exception:
            return jsonify({"error": "quantity must be a number"}), 400

        if quantity <= 0:
            return jsonify({"error": "quantity must be greater than 0"}), 400
        
        if state["broker"] is None:
            return jsonify({
                "status": "success",
                "order_id": "DEMO-12345",
                "symbol": symbol,
                "side": side,
                "quantity": quantity,
            }), 200

        if not confirm_live:
            return jsonify({"error": "confirm_live=true is required for broker-backed orders"}), 400

        if state.get("broker_name") not in {"ibkr", "alpaca"}:
            return jsonify({"error": "Live order placement is only supported for IBKR or Alpaca"}), 400

        order = run_async(state["broker"].place_order(symbol, side, quantity))
        if order is None or getattr(order, "status", None) == "failed":
            return jsonify({"error": "Order placement failed"}), 500
        payload = asdict(order)
        if payload.get("timestamp") is not None:
            payload["timestamp"] = payload["timestamp"].isoformat()
        payload["order_status"] = payload.pop("status", None)
        return jsonify({"status": "success", **payload}), 200
    except Exception as e:
        logger.error(f"Error placing order: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/trade/cancel-order/<order_id>", methods=["POST"])
def cancel_order(order_id):
    """Cancel an open order."""
    try:
        if state["broker"] is None:
            return jsonify({
                "status": "success",
                "order_id": order_id,
                "action": "cancelled",
            }), 200

        cancelled = run_async(state["broker"].cancel_order(order_id))
        if not cancelled:
            return jsonify({"error": "Cancel request failed"}), 500
        return jsonify({"status": "success", "order_id": order_id, "action": "cancelled"}), 200
    except Exception as e:
        logger.error(f"Error canceling order: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/trade/logs", methods=["GET"])
def get_trade_logs():
    """Get trading log records for spreadsheet-style review."""
    try:
        days = request.args.get("days", 30, type=int)
        asset_type = request.args.get("asset_type", "all", type=str).lower()
        status = request.args.get("status", "all", type=str).lower()

        source = "bot_ledger"
        broker = state.get("broker")
        logs = []

        if broker is not None and hasattr(broker, "get_trade_logs"):
            logs = run_async(broker.get_trade_logs(days=days, asset_type=asset_type, status=status)) or []
            source = state.get("broker_name", "live")

        # Fallback to local bot ledger when broker logs are unavailable or empty.
        if not logs:
            logs = _load_persisted_trade_logs()
            source = "bot_ledger"

        # Remove testing utilities from production ledger view.
        logs = [
            row for row in logs
            if str(row.get("strategy", "")).lower() not in {"try_buy_sell", "try_buy_sell_live"}
        ]

        if asset_type != "all":
            logs = [row for row in logs if str(row.get("asset_type", "")).lower() == asset_type]

        if status != "all":
            logs = [row for row in logs if str(row.get("status", "")).lower() == status]

        # Newest first
        logs.sort(key=lambda x: x.get("timestamp", ""), reverse=True)

        return jsonify({
            "logs": logs,
            "meta": {
                "days": days,
                "count": len(logs),
                "asset_type": asset_type,
                "status": status,
                "source": source,
            },
        }), 200
    except Exception as e:
        logger.error(f"Error getting trade logs: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/trade/try-buy-sell", methods=["POST"])
def try_buy_sell_forex():
    """Run quick forex try buy/sell in simulated or tiny live-paper mode."""
    try:
        data = request.json or {}
        mode = str(data.get("mode", "simulated")).lower().strip()
        rounds = int(data.get("rounds", 6))
        quantity = int(data.get("quantity", 2000))
        confirm_live = bool(data.get("confirm_live", False))

        if mode not in {"simulated", "live_paper"}:
            return jsonify({"error": "mode must be one of: simulated, live_paper"}), 400

        if mode == "live_paper":
            if not confirm_live:
                return jsonify({"error": "confirm_live=true is required for live_paper mode"}), 400

            broker = state.get("broker")
            if broker is None:
                return jsonify({"error": "No broker connected. Switch to IBKR paper first."}), 400
            if state.get("broker_name") != "ibkr":
                return jsonify({"error": "live_paper mode currently supports IBKR paper only."}), 400
            if not bool(getattr(broker, "paper_trading", False)):
                return jsonify({"error": "Connected IBKR session is not paper-trading safe."}), 400
            if not hasattr(broker, "quick_forex_round_trips"):
                return jsonify({"error": "Broker does not support quick forex round trips."}), 400

            quantity = max(1000, min(quantity, 5000))
            new_rows = run_async(broker.quick_forex_round_trips(rounds=rounds, quantity=quantity)) or []
            mode_message = "tiny live-paper"
            mode_strategy = "try_buy_sell_live"
        else:
            new_rows = _generate_try_buy_sell_logs(rounds=rounds, quantity=quantity)
            mode_message = "simulated"
            mode_strategy = "try_buy_sell"

        if not new_rows:
            return jsonify({"error": "No trades were created. Check broker connectivity and try again."}), 500

        for row in new_rows:
            state["simulated_trade_logs"].append(row)

        _append_persisted_trade_logs(new_rows)

        total_net = round(sum(float(r.get("net_pnl", 0) or 0) for r in new_rows), 2)
        attempts = len(new_rows)
        submitted = sum(1 for r in new_rows if bool(r.get("order_submitted", True)))
        failed = max(0, attempts - submitted)
        append_bot_log(
            "Try Buy/Sell trades created",
            details={
                "records": len(new_rows),
                "total_net_pnl": total_net,
                "mode": mode,
                "attempts": attempts,
                "submitted": submitted,
                "failed": failed,
            },
        )

        return jsonify(
            {
                "status": "success",
                "mode": mode,
                "strategy": mode_strategy,
                "message": f"Created {len(new_rows)} {mode_message} forex trade records",
                "created": len(new_rows),
                "attempts": attempts,
                "submitted": submitted,
                "failed": failed,
                "total_net_pnl": total_net,
                "records": new_rows,
            }
        ), 200
    except Exception as e:
        logger.error(f"Error generating try buy/sell trades: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/bot/status", methods=["GET"])
def get_bot_status():
    """Get current execution mode and bot lifecycle state."""
    running = bot_runner.is_running()
    state["bot_running"] = running

    grid_state = state.get("forex_grid_state") or {}
    pairs = grid_state.get("pairs") or {}
    forex_open_longs = 0
    forex_open_shorts = 0
    forex_realized_pnl = 0.0
    forex_pair_details = []

    crypto_open_longs = 0
    crypto_open_shorts = 0
    crypto_realized_pnl = 0.0
    crypto_symbol_details = []

    for pair_symbol, pair_state in sorted(pairs.items()):
        asset_type = str(pair_state.get("asset_type", "forex") or "forex").lower()
        open_longs_count = len(pair_state.get("open_longs", []) or [])
        open_shorts_count = len(pair_state.get("open_shorts", []) or [])
        realized_value = round(float(pair_state.get("realized_pnl", 0.0) or 0.0), 2)

        base_row = {
            "pair": pair_symbol,
            "symbol": pair_symbol,
            "asset_type": asset_type,
            "anchor": pair_state.get("anchor"),
            "last_price": pair_state.get("last_price"),
            "open_longs": open_longs_count,
            "open_shorts": open_shorts_count,
            "realized_pnl": realized_value,
            "next_long_trigger": pair_state.get("next_long_trigger"),
            "next_short_trigger": pair_state.get("next_short_trigger"),
            "last_updated": pair_state.get("last_updated"),
            "exposure_notional": pair_state.get("exposure_notional"),
            "exposure_cap": pair_state.get("exposure_cap"),
            "risk_blocked": pair_state.get("risk_blocked"),
        }

        if asset_type == "crypto":
            crypto_open_longs += open_longs_count
            crypto_open_shorts += open_shorts_count
            crypto_realized_pnl += realized_value
            crypto_symbol_details.append(base_row)
        else:
            forex_open_longs += open_longs_count
            forex_open_shorts += open_shorts_count
            forex_realized_pnl += realized_value
            forex_pair_details.append(base_row)

    return jsonify({
        "execution_mode": state["execution_mode"],
        "bot_running": running,
        "bot_heartbeat": state["bot_heartbeat"],
        "bot_last_run": state["bot_last_run"],
        "bot_last_error": state["bot_last_error"],
        "bot_cycle_count": state["bot_cycle_count"],
        "dry_run": state["bot_dry_run"],
        "backend_time": datetime.now().isoformat(),
        "last_actions": state.get("portfolio_data", {}).get("last_actions", []),
        "strategy_audit": state.get("strategy_audit", {}),
        "forex_grid": {
            "pairs_configured": len(forex_pair_details),
            "open_longs": forex_open_longs,
            "open_shorts": forex_open_shorts,
            "open_total": forex_open_longs + forex_open_shorts,
            "realized_pnl": round(forex_realized_pnl, 2),
            "last_cycle": grid_state.get("last_cycle"),
            "last_tick": state.get("forex_last_tick"),
            "tick_seconds": int(state.get("forex_tick_seconds", 1) or 1),
            "full_cycle_seconds": int(state.get("bot_interval_seconds", 60) or 60),
            "pairs": forex_pair_details,
        },
        "crypto_grid": {
            "symbols_configured": len(crypto_symbol_details),
            "open_longs": crypto_open_longs,
            "open_shorts": crypto_open_shorts,
            "open_total": crypto_open_longs + crypto_open_shorts,
            "realized_pnl": round(crypto_realized_pnl, 2),
            "last_cycle": grid_state.get("last_cycle"),
            "last_tick": state.get("forex_last_tick"),
            "daily_loss_current": round(float(state.get("crypto_daily_loss_current", 0.0) or 0.0), 2),
            "daily_loss_limit": round(float(state.get("crypto_daily_loss_limit", 750.0) or 750.0), 2),
            "daily_loss_halted": bool(state.get("crypto_daily_loss_halted", False)),
            "symbols": crypto_symbol_details,
        },
    }), 200


@app.route("/api/bot/execution", methods=["POST"])
def set_bot_execution_safety():
    """Set bot execution safety mode.

    dry_run=true  -> simulate actions only
    dry_run=false -> allow live order submission where implemented
    """
    try:
        data = request.json or {}
        if "dry_run" not in data:
            return jsonify({"error": "'dry_run' is required"}), 400

        state["bot_dry_run"] = bool(data.get("dry_run"))
        append_bot_log(
            "Execution safety mode changed",
            level="warning" if not state["bot_dry_run"] else "info",
            details={"dry_run": state["bot_dry_run"]},
        )
        return jsonify(
            {
                "status": "success",
                "dry_run": state["bot_dry_run"],
                "message": "Dry-run enabled" if state["bot_dry_run"] else "Live execution enabled",
            }
        ), 200
    except Exception as e:
        logger.error(f"Error setting bot execution safety: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/bot/mode", methods=["POST"])
def set_execution_mode():
    """Set execution mode: manual (data only) or automatic (bot runner)."""
    try:
        data = request.json or {}
        mode = normalize_execution_mode(data.get("mode", "manual"))
        auto_start = bool(data.get("auto_start", False))
        interval = int(data.get("interval_seconds", 60))

        state["execution_mode"] = mode
        append_bot_log("Execution mode changed", details={"execution_mode": mode, "auto_start": auto_start})

        if mode == "manual":
            bot_runner.stop()
            return jsonify({"status": "success", "execution_mode": mode, "bot_running": False}), 200

        # automatic mode
        if auto_start:
            state["bot_dry_run"] = False
            append_bot_log(
                "Automatic mode set to live execution",
                level="warning",
                details={"dry_run": state["bot_dry_run"]},
            )
            bot_runner.start(interval_seconds=interval)

        return jsonify({
            "status": "success",
            "execution_mode": mode,
            "bot_running": bot_runner.is_running(),
            "dry_run": state["bot_dry_run"],
        }), 200
    except Exception as e:
        logger.error(f"Error setting execution mode: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/bot/start", methods=["POST"])
def start_bot_runner():
    """Start automatic bot runner (requires automatic mode)."""
    try:
        if state["execution_mode"] != "automatic":
            return jsonify({"error": "Set execution mode to 'automatic' before starting bot"}), 400

        data = request.json or {}
        interval = int(data.get("interval_seconds", 60))
        state["bot_dry_run"] = False
        append_bot_log(
            "Bot start forcing live execution",
            level="warning",
            details={"dry_run": state["bot_dry_run"], "interval_seconds": interval},
        )
        started = bot_runner.start(interval_seconds=interval)
        append_bot_log(
            "Bot start requested",
            details={"started": started, "interval_seconds": interval, "execution_mode": state.get("execution_mode")},
        )
        return jsonify({
            "status": "success",
            "started": started,
            "bot_running": bot_runner.is_running(),
            "dry_run": state["bot_dry_run"],
        }), 200
    except Exception as e:
        logger.error(f"Error starting bot runner: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/bot/stop", methods=["POST"])
def stop_bot_runner():
    """Stop automatic bot runner."""
    try:
        stopped = bot_runner.stop()
        append_bot_log("Bot stop requested", details={"stopped": stopped})
        return jsonify({"status": "success", "stopped": stopped, "bot_running": False}), 200
    except Exception as e:
        logger.error(f"Error stopping bot runner: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/bot/logs", methods=["GET"])
def get_bot_logs():
    """Get recent bot lifecycle and scanning logs."""
    try:
        limit = request.args.get("limit", 120, type=int)
        limit = max(10, min(limit, 300))
        logs = list(state.get("bot_logs", []))
        return jsonify(
            {
                "logs": logs[-limit:],
                "meta": {
                    "count": min(limit, len(logs)),
                    "total": len(logs),
                    "bot_running": bot_runner.is_running(),
                    "execution_mode": state.get("execution_mode", "manual"),
                    "dry_run": state.get("bot_dry_run", True),
                },
            }
        ), 200
    except Exception as e:
        logger.error(f"Error getting bot logs: {e}")
        return jsonify({"error": str(e)}), 500


# ============ Status Endpoints ============

@app.route("/api/status/broker", methods=["GET"])
def get_broker_status():
    """Get broker connection status."""
    try:
        connected = state["broker"] is not None
        return jsonify({
            "connected": connected,
            "broker": state["broker_name"].upper() if connected else "Demo",
            "account_type": "paper" if connected else "mock",
            "runtime_config": state.get("broker_runtime_config", {}),
        }), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def _build_broker_capabilities() -> dict[str, Any]:
    broker = state.get("broker")
    broker_name = str(state.get("broker_name", "demo") or "demo")
    connected = bool(broker is not None)
    paper_trading = bool(getattr(broker, "paper_trading", False)) if broker is not None else True

    supports_equities = bool(connected and hasattr(broker, "place_order"))
    supports_forex = bool(connected and hasattr(broker, "place_forex_order"))
    supports_crypto = bool(connected and hasattr(broker, "place_crypto_order"))
    supports_options = bool(connected and hasattr(broker, "sell_covered_call"))

    if not connected:
        crypto_reason = "No live broker connected"
    elif broker_name != "ibkr":
        crypto_reason = f"{broker_name.upper()} broker adapter has no crypto order path yet"
    elif supports_crypto:
        crypto_reason = "IBKR crypto routing available (PAXOS), subject to account permissions"
    else:
        crypto_reason = "Connected broker does not expose crypto order API"

    return {
        "broker": broker_name,
        "connected": connected,
        "paper_trading": paper_trading,
        "supports": {
            "equities": supports_equities,
            "forex": supports_forex,
            "crypto": supports_crypto,
            "covered_calls": supports_options,
        },
        "crypto": {
            "supported": supports_crypto,
            "reason": crypto_reason,
        },
    }


@app.route("/api/broker/capabilities", methods=["GET"])
def get_broker_capabilities():
    """Get capability flags for current broker and execution adapter."""
    try:
        return jsonify(_build_broker_capabilities()), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/broker/options", methods=["GET"])
def get_broker_options():
    """Get current broker and supported broker types."""
    try:
        return jsonify({
            "current": state["broker_name"],
            "connected": state["broker"] is not None,
            "active_config": state.get("broker_runtime_config", {}),
            "capabilities": _build_broker_capabilities(),
            "available": ["ibkr", "alpaca", "demo"],
            "defaults": {
                "ibkr": {
                    "host": os.getenv("IB_HOST", "127.0.0.1"),
                    "port": int(os.getenv("IB_PORT", "7497")),
                    "client_id": int(os.getenv("IB_CLIENT_ID", "100")),
                },
                "alpaca": {
                    "base_url": os.getenv("ALPACA_BASE_URL", "https://paper-api.alpaca.markets"),
                },
            },
        }), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/broker/switch", methods=["POST"])
def post_switch_broker():
    """Switch active broker at runtime."""
    try:
        data = request.json or {}
        broker_type = str(data.get("broker", "")).lower().strip()
        config = data.get("config", {})

        if state.get("bot_running"):
            return jsonify({"error": "Stop the bot before switching brokers."}), 400

        if broker_type == "demo":
            state["broker"] = None
            state["broker_name"] = "demo"
            state["broker_runtime_config"] = {}
            return jsonify({"status": "success", "broker": "demo", "connected": False, "config": {}}), 200

        if broker_type not in {"ibkr", "alpaca"}:
            return jsonify({"error": "broker must be one of: ibkr, alpaca, demo"}), 400

        active, runtime_cfg = switch_broker(broker_type, config)
        return jsonify({"status": "success", "broker": active, "connected": True, "config": runtime_cfg or {}}), 200
    except Exception as e:
        logger.error(f"Broker switch failed: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/ticker/research", methods=["GET"])
def ticker_research():
    """Search ticker and return quote, fundamentals, analyst sentiment, and recommendation."""
    symbol = request.args.get("symbol", "").upper().strip()
    market = _normalize_market(request.args.get("market", "us", type=str))
    chart_period = str(request.args.get("period", "1y", type=str) or "1y").lower().strip()
    chart_interval = str(request.args.get("interval", "1d", type=str) or "1d").lower().strip()
    if not symbol:
        return jsonify({"error": "Query param 'symbol' is required"}), 400

    period_map = {
        "1m": "1mo",
        "3m": "3mo",
        "6m": "6mo",
        "1y": "1y",
        "2y": "2y",
        "5y": "5y",
    }
    if chart_period not in period_map:
        chart_period = "1y"

    interval_map = {"1d", "1h", "30m", "15m", "5m", "1wk"}
    if chart_interval not in interval_map:
        chart_interval = "1d"

    try:
        resolved_symbol = _ticker_with_market(symbol, market)
        ticker = yf.Ticker(resolved_symbol)
        info = ticker.info or {}
        fast_info = getattr(ticker, "fast_info", None)
        hist = ticker.history(period=period_map[chart_period], interval=chart_interval)
        if hist.empty:
            hist = ticker.history(period="1d", interval="5m")

        valid_hist = hist.dropna(subset=["Close"]) if not hist.empty and "Close" in hist.columns else hist

        chart_rows = []
        for ts, row in valid_hist.tail(260).iterrows():
            close_value = row.get("Close", 0)
            if close_value is None or close_value != close_value:
                continue
            chart_rows.append({
                "date": ts.isoformat() if hasattr(ts, "isoformat") else str(ts),
                "open": round(float(row.get("Open", 0) or 0), 4),
                "high": round(float(row.get("High", 0) or 0), 4),
                "low": round(float(row.get("Low", 0) or 0), 4),
                "close": round(float(close_value or 0), 4),
                "volume": int(float(row.get("Volume", 0) or 0)),
            })

        last_close = None
        previous_close_from_history = None
        if not valid_hist.empty and "Close" in valid_hist.columns:
            closes = valid_hist["Close"].dropna()
            if not closes.empty:
                last_close = float(closes.iloc[-1])
            if len(closes) >= 2:
                previous_close_from_history = float(closes.iloc[-2])

        price = _safe_float(_first_non_empty(
            last_close,
            info.get("currentPrice"),
            _fast_info_value(fast_info, "lastPrice", "regularMarketPrice"),
        )) or 0.0
        prev_close = _safe_float(_first_non_empty(
            info.get("previousClose"),
            previous_close_from_history,
            _fast_info_value(fast_info, "previousClose", "regularMarketPreviousClose"),
            price,
        )) or 0.0
        change = price - prev_close
        change_pct = (change / prev_close * 100.0) if prev_close else 0.0

        positions = get_positions_for_recommendation()
        account_total = float(request.args.get("account_total", 0) or 0)
        if account_total <= 0:
            account_total = sum(float(p.get("current_price", 0)) * float(p.get("quantity", 0)) for p in positions)
            account_total = account_total or 100000.0

        existing_position_value = 0.0
        for p in positions:
            if p.get("symbol", "").upper() in {symbol, resolved_symbol}:
                existing_position_value += float(p.get("current_price", 0)) * float(p.get("quantity", 0))
        concentration_pct = (existing_position_value / account_total) * 100.0 if account_total else 0.0

        recommendation_mean = _first_non_empty(info.get("recommendationMean"), _fast_info_value(fast_info, "recommendationMean"))
        analyst_count = int(_first_non_empty(info.get("numberOfAnalystOpinions"), _fast_info_value(fast_info, "numberOfAnalystOpinions")) or 0)
        trailing_pe = _first_non_empty(info.get("trailingPE"), _fast_info_value(fast_info, "trailingPE"))
        forward_pe = _first_non_empty(info.get("forwardPE"), _fast_info_value(fast_info, "forwardPE"))
        market_cap = _safe_float(_first_non_empty(info.get("marketCap"), _fast_info_value(fast_info, "marketCap")))
        dcf = _estimate_dcf(info, current_price=price)

        dividend_yield = _safe_float(_first_non_empty(info.get("dividendYield"), _fast_info_value(fast_info, "dividendYield")))
        payout_ratio = _safe_float(_first_non_empty(info.get("payoutRatio"), _fast_info_value(fast_info, "payoutRatio")))
        beta = _safe_float(_first_non_empty(info.get("beta"), _fast_info_value(fast_info, "beta")))
        trailing_eps = _safe_float(_first_non_empty(info.get("trailingEps"), _fast_info_value(fast_info, "trailingEps")))
        forward_eps = _safe_float(_first_non_empty(info.get("forwardEps"), _fast_info_value(fast_info, "forwardEps")))
        earnings_date = None
        try:
            earnings_data = info.get("earningsDate")
            if isinstance(earnings_data, (list, tuple)) and earnings_data:
                earnings_date = str(earnings_data[0])
            elif earnings_data is not None:
                earnings_date = str(earnings_data)
        except Exception:
            earnings_date = None

        dividends_rows = []
        try:
            dividends = ticker.dividends
            if dividends is not None and not dividends.empty:
                for ts, value in dividends.tail(8).items():
                    dividends_rows.append({
                        "date": ts.isoformat() if hasattr(ts, "isoformat") else str(ts),
                        "amount": round(float(value or 0), 4),
                    })
        except Exception:
            dividends_rows = []

        news_rows = []
        try:
            for item in (ticker.news or [])[:5]:
                title = str(item.get("title") or "")
                if not title:
                    continue
                news_rows.append({
                    "title": title,
                    "publisher": str(item.get("publisher") or ""),
                    "link": str(item.get("link") or ""),
                    "published_at": datetime.fromtimestamp(int(item.get("providerPublishTime") or 0)).isoformat()
                    if item.get("providerPublishTime")
                    else None,
                    "type": str(item.get("type") or ""),
                })
        except Exception:
            news_rows = []

        score = 50.0

        recommendation_mean_value = _safe_float(recommendation_mean)
        if recommendation_mean_value is not None:
            # Yahoo scale: 1=strong buy ... 5=sell
            score += max(-20.0, min(20.0, (3.0 - recommendation_mean_value) * 15.0))
        if analyst_count >= 20:
            score += 5.0
        elif analyst_count < 5:
            score -= 5.0

        if forward_pe is not None and forward_pe > 0:
            if forward_pe <= 20:
                score += 10.0
            elif forward_pe <= 35:
                score += 4.0
            else:
                score -= 8.0
        elif trailing_pe is not None and trailing_pe > 0:
            if trailing_pe <= 20:
                score += 8.0
            elif trailing_pe > 40:
                score -= 8.0

        if concentration_pct > 25.0:
            score -= 15.0
        elif concentration_pct > 15.0:
            score -= 8.0

        if change_pct > 4.0:
            score -= 4.0  # avoid chasing sudden spikes

        if dcf.get("available"):
            upside = _safe_float(dcf.get("upside_pct")) or 0.0
            if upside >= 25:
                score += 12.0
            elif upside >= 10:
                score += 6.0
            elif upside <= -20:
                score -= 12.0
            elif upside <= -10:
                score -= 6.0

        score = max(0.0, min(100.0, score))

        if score >= 65:
            action = "buy"
        elif score >= 45:
            action = "watch"
        else:
            action = "avoid"

        reasons = []
        if recommendation_mean_value is not None:
            reasons.append(f"Analyst recommendation mean: {recommendation_mean_value:.2f} (1=strong buy, 5=sell)")
        if _safe_float(forward_pe) is not None:
            reasons.append(f"Forward P/E: {_safe_float(forward_pe):.2f}")
        elif _safe_float(trailing_pe) is not None:
            reasons.append(f"Trailing P/E: {_safe_float(trailing_pe):.2f}")
        reasons.append(f"Portfolio concentration in {resolved_symbol}: {concentration_pct:.2f}%")
        if dcf.get("available"):
            fair_value = _safe_float(dcf.get("fair_value"))
            upside_pct = _safe_float(dcf.get("upside_pct"))
            if fair_value is not None and upside_pct is not None:
                reasons.append(
                    f"DCF fair value: {fair_value:.2f} vs price {price:.2f} ({upside_pct:+.2f}% upside)"
                )
            else:
                reasons.append("DCF calculated, but formatting data was incomplete")
        else:
            reasons.append("DCF unavailable due to insufficient cash-flow/share data")

        return jsonify({
            "symbol": resolved_symbol,
            "input_symbol": symbol,
            "market": market,
            "company_name": _first_non_empty(info.get("longName"), info.get("shortName"), _fast_info_value(fast_info, "longName", "shortName")) or resolved_symbol,
            "summary": _first_non_empty(info.get("longBusinessSummary"), info.get("longBusinessSummaryText"), _fast_info_value(fast_info, "longBusinessSummary")) or "",
            "sector": _first_non_empty(info.get("sector"), _fast_info_value(fast_info, "sector")),
            "industry": _first_non_empty(info.get("industry"), _fast_info_value(fast_info, "industry")),
            "price": round(price, 4),
            "previous_close": round(prev_close, 4),
            "change": round(change, 4),
            "change_pct": round(change_pct, 4),
            "market_cap": market_cap,
            "beta": beta,
            "dividend_yield": dividend_yield,
            "payout_ratio": payout_ratio,
            "trailing_eps": trailing_eps,
            "forward_eps": forward_eps,
            "earnings_date": earnings_date,
            "chart": {
                "period": chart_period,
                "interval": chart_interval,
                "points": chart_rows,
            },
            "dividends": dividends_rows,
            "news": news_rows,
            "trailing_pe": trailing_pe,
            "forward_pe": forward_pe,
            "analyst_recommendation_mean": recommendation_mean,
            "analyst_opinions_count": analyst_count,
            "dcf": dcf,
            "recommendation": {
                "action": action,
                "score": round(score, 2),
                "reasons": reasons,
            },
            "data_source": "yfinance_fast_info" if not info else "yfinance_live",
        }), 200
    except Exception as e:
        logger.error(f"Error researching ticker {symbol}: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/status/health", methods=["GET"])
def health_check():
    """Health check endpoint."""
    return jsonify({"status": "healthy", "timestamp": datetime.now().isoformat()}), 200


# ============ Error Handlers ============

# ============ Enhanced Features: Strategy Customization, Risk Management, Backtesting ============

@app.route("/api/strategy/config/<strategy_name>", methods=["GET"])
def get_strategy_config(strategy_name):
    """Get strategy configuration with entry/exit rules and risk controls."""
    try:
        config_manager = state["config_manager"] or ConfigManager()
        strategy_cfg = config_manager.load_strategy_config(strategy_name)
        return jsonify({"strategy": strategy_name, "config": strategy_cfg}), 200
    except Exception as e:
        logger.error(f"Error getting strategy config: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/strategy/config/<strategy_name>", methods=["POST"])
def update_strategy_config(strategy_name):
    """Update strategy configuration."""
    try:
        config_manager = state["config_manager"] or ConfigManager()
        config = request.json or {}
        config_manager.save_strategy_config(strategy_name, config)
        append_bot_log(
            f"Strategy config updated: {strategy_name}",
            details={"strategy": strategy_name, "config_keys": list(config.keys())},
        )
        return jsonify({"status": "success", "strategy": strategy_name, "config": config}), 200
    except Exception as e:
        logger.error(f"Error updating strategy config: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/strategy/defaults", methods=["GET"])
def get_strategy_defaults():
    """Get default strategy configurations."""
    try:
        config_manager = ConfigManager()
        defaults = config_manager.get_strategy_defaults()
        return jsonify({"defaults": defaults}), 200
    except Exception as e:
        logger.error(f"Error getting strategy defaults: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/signal/metadata", methods=["POST"])
def create_signal_with_metadata():
    """Create a trading signal with confidence, data sources, and recommendation horizon."""
    try:
        from models import SignalMetadata, ConfidenceLevel, RiskControls, MarketRegime
        
        data = request.json or {}
        
        metadata = {
            "symbol": data.get("symbol"),
            "signal_type": data.get("signal_type", "buy"),  # buy, sell, hold
            "confidence": ConfidenceLevel(data.get("confidence", "medium")).value,
            "data_sources": data.get("data_sources", ["yfinance"]),
            "reason": data.get("reason", ""),
            "historical_win_rate": float(data.get("historical_win_rate", 50.0)),
            "expected_return": float(data.get("expected_return", 5.0)),
            "max_drawdown_risk": float(data.get("max_drawdown_risk", 2.0)),
            "recommended_entry_price": float(data.get("recommended_entry_price", 0)),
            "recommended_exit_price": float(data.get("recommended_exit_price", 0)),
            "recommended_holding_days": int(data.get("recommended_holding_days", 30)),
            "regime": data.get("regime", "bull"),
        }
        
        return jsonify({
            "status": "success",
            "signal": metadata,
            "created_at": datetime.now().isoformat(),
        }), 200
    except Exception as e:
        logger.error(f"Error creating signal metadata: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/market-regime", methods=["GET"])
def get_market_regime():
    """Detect current market regime (bull/bear/range-bound/high-volatility)."""
    try:
        from backtest import calculate_regime
        import yfinance as yf
        
        # Get SPY as market proxy  
        ticker = yf.Ticker("SPY")
        hist = ticker.history(period="90d", interval="1d")
        
        if hist.empty:
            return jsonify({"regime": "bull", "indicator": "SPY data unavailable"}), 200
        
        closes = hist["Close"].values
        vix_ticker = yf.Ticker("^VIX")
        vix_hist = vix_ticker.history(period="1d", interval="1d")
        vix = float(vix_hist["Close"].iloc[-1]) if not vix_hist.empty else 20.0
        
        regime = calculate_regime(closes, vix)
        
        return jsonify({
            "regime": regime.value,
            "vix": round(float(vix), 2),
            "market_indicator": "SPY",
            "description": {
                "bull": "Trending up, low VIX - favor growth strategies",
                "bear": "Trending down, high VIX - reduce exposure, tighter stops",
                "range_bound": "Consolidating - mean-revert strategies work well",
                "high_volatility": "Choppy markets - wider stops, smaller positions",
            }.get(regime.value, "Unknown"),
        }), 200
    except Exception as e:
        logger.error(f"Error detecting market regime: {e}")
        return jsonify({
            "regime": "bull",
            "vix": None,
            "error": str(e),
        }), 200


@app.route("/api/market/indices", methods=["GET"])
def get_market_indices():
    """Get major index snapshots with intraday chart points for homepage overview."""
    try:
        now = datetime.now()
        index_specs = [
            {"symbol": "^GSPC", "name": "S&P 500", "region": "US"},
            {"symbol": "^IXIC", "name": "NASDAQ", "region": "US"},
            {"symbol": "^DJI", "name": "Dow Jones", "region": "US"},
            {"symbol": "^HSI", "name": "Hang Seng", "region": "HK"},
            {"symbol": "^N225", "name": "Nikkei 225", "region": "JP"},
        ]

        def _to_float(v: Any, default: float = 0.0) -> float:
            try:
                out = float(v)
                return out if out == out else default
            except Exception:
                return default

        rows = []
        for spec in index_specs:
            ticker = yf.Ticker(spec["symbol"])
            intraday = ticker.history(period="1d", interval="5m")

            use_hist = intraday
            if use_hist is None or use_hist.empty or "Close" not in use_hist.columns:
                # Fallback for weekends/holidays or unavailable intraday endpoints.
                use_hist = ticker.history(period="5d", interval="1d")

            points = []
            closes = []
            if use_hist is not None and not use_hist.empty and "Close" in use_hist.columns:
                for idx, price in use_hist["Close"].dropna().items():
                    px = _to_float(price, 0.0)
                    if px <= 0:
                        continue
                    closes.append(px)
                    try:
                        ts = idx.to_pydatetime().isoformat() if hasattr(idx, "to_pydatetime") else str(idx)
                    except Exception:
                        ts = str(idx)
                    points.append({"time": ts, "price": round(px, 4)})

            if not closes:
                continue

            latest = closes[-1]
            previous_close = closes[-2] if len(closes) > 1 else closes[-1]

            try:
                fast_info = getattr(ticker, "fast_info", None)
                if fast_info is not None:
                    prev_candidate = fast_info.get("previousClose") if hasattr(fast_info, "get") else None
                    if prev_candidate is not None:
                        previous_close = _to_float(prev_candidate, previous_close)
            except Exception:
                pass

            delta = latest - previous_close
            delta_pct = (delta / previous_close * 100.0) if previous_close else 0.0

            rows.append(
                {
                    "symbol": spec["symbol"],
                    "name": spec["name"],
                    "region": spec["region"],
                    "price": round(latest, 4),
                    "previous_close": round(previous_close, 4),
                    "change": round(delta, 4),
                    "change_pct": round(delta_pct, 3),
                    "trend": "up" if delta >= 0 else "down",
                    "points": points,
                    "point_count": len(points),
                }
            )

        return jsonify({"indices": rows, "as_of": now.isoformat()}), 200
    except Exception as e:
        logger.error(f"Error getting market indices: {e}")
        return jsonify({"indices": [], "as_of": datetime.now().isoformat(), "error": str(e)}), 200


@app.route("/api/positions/risks", methods=["GET"])
def get_position_risks():
    """Get risk metrics for all open positions."""
    try:
        broker = state.get("broker")
        account_snapshot = None
        
        if broker is None:
            mock_gen = MockPortfolioGenerator()
            account_snapshot = mock_gen.generate_account_snapshot()
            positions = mock_gen.generate_positions()
        else:
            account_snapshot = asdict(run_async(broker.get_account_snapshot()))
            pos_obj = run_async(broker.get_positions()) or []
            positions = [asdict(p) for p in pos_obj]

        portfolio_value = float((account_snapshot or {}).get("total_value") or 0.0)
        cash_balance = float((account_snapshot or {}).get("cash") or 0.0)
        buying_power = float((account_snapshot or {}).get("buying_power") or 0.0)

        # Add risk metrics to each position
        risk_positions = []
        total_market_value = 0.0
        total_unrealized = 0.0
        critical_positions = 0
        high_positions = 0
        expiring_positions = 0
        largest_position_pct = 0.0

        def _parse_days_held(pos: dict[str, Any]) -> int:
            for key in ("entry_date", "entry_time", "opened_at"):
                raw = pos.get(key)
                if not raw:
                    continue
                try:
                    opened_at = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
                    delta = datetime.now(opened_at.tzinfo) - opened_at if opened_at.tzinfo else datetime.now() - opened_at
                    return max(0, int(delta.days))
                except Exception:
                    continue
            return int(pos.get("days_held", 0) or 0)

        for pos in positions:
            quantity = abs(float(pos.get("quantity", 0) or 0))
            avg_price = float(pos.get("avg_price", 0) or 0)
            current_price = float(pos.get("current_price", avg_price) or avg_price)
            market_value = quantity * current_price
            pnl = float(pos.get("pnl", (current_price - avg_price) * quantity) or 0)
            pnl_pct = float(pos.get("pnl_pct", (((current_price - avg_price) / avg_price) * 100 if avg_price else 0.0)) or 0)
            max_loss_pct = float(pos.get("max_loss_pct", 2.0) or 2.0)
            target_profit_pct = float(pos.get("target_profit_pct", 5.0) or 5.0)
            max_holding_days = int(pos.get("max_holding_days", 30) or 30)
            days_held = _parse_days_held(pos)
            concentration_pct = (market_value / portfolio_value * 100.0) if portfolio_value > 0 else 0.0

            if pnl_pct <= -max_loss_pct:
                risk_level = "critical"
                critical_positions += 1
            elif pnl_pct <= -(max_loss_pct * 0.5) or concentration_pct >= 20.0:
                risk_level = "high"
                high_positions += 1
            elif days_held >= max_holding_days * 0.8:
                risk_level = "expiring"
                expiring_positions += 1
            else:
                risk_level = "normal"

            total_market_value += market_value
            total_unrealized += pnl
            largest_position_pct = max(largest_position_pct, concentration_pct)

            risk_positions.append({
                **pos,
                "market_value": round(market_value, 2),
                "concentration_pct": round(concentration_pct, 2),
                "max_loss_pct": max_loss_pct,
                "target_profit_pct": target_profit_pct,
                "max_holding_days": max_holding_days,
                "days_held": days_held,
                "risk_level": risk_level,
            })

        unrealized_pct = (total_unrealized / total_market_value * 100.0) if total_market_value > 0 else 0.0
        concentration_penalty = max(0.0, largest_position_pct - 25.0) * 1.6
        drawdown_penalty = max(0.0, -unrealized_pct) * 1.4
        risk_penalty = critical_positions * 18.0 + high_positions * 9.0 + expiring_positions * 4.0
        risk_score = max(0.0, min(100.0, 100.0 - concentration_penalty - drawdown_penalty - risk_penalty))

        if risk_score >= 80:
            risk_level = "low"
        elif risk_score >= 60:
            risk_level = "moderate"
        elif risk_score >= 35:
            risk_level = "high"
        else:
            risk_level = "critical"

        headline = {
            "low": "Portfolio risk looks controlled.",
            "moderate": "Portfolio risk is manageable but worth watching.",
            "high": "Portfolio risk is elevated. Reduce concentration or tighten stops.",
            "critical": "Portfolio risk is high. Review positions before adding exposure.",
        }[risk_level]
        
        return jsonify({
            "positions": risk_positions,
            "aggregate": {
                "total_positions": len(positions),
                "portfolio_value": round(portfolio_value, 2),
                "cash": round(cash_balance, 2),
                "buying_power": round(buying_power, 2),
                "total_market_value": round(total_market_value, 2),
                "unrealized_pnl": round(total_unrealized, 2),
                "unrealized_pnl_pct": round(unrealized_pct, 2),
                "largest_position_pct": round(largest_position_pct, 2),
                "critical_positions": critical_positions,
                "high_positions": high_positions,
                "expiring_positions": expiring_positions,
                "risk_score": round(risk_score, 1),
                "risk_level": risk_level,
                "headline": headline,
            },
        }), 200
    except Exception as e:
        logger.error(f"Error getting position risks: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/performance/by-regime", methods=["GET"])
def get_performance_by_regime():
    """Get strategy performance segmented by market regime."""
    try:
        strategy = request.args.get("strategy", "blowup_stocks", type=str)
        
        # Example performance data by regime
        performance = {
            "bull": {
                "win_rate": 72,
                "avg_return": 4.5,
                "sharpe_ratio": 1.8,
                "trades": 25,
            },
            "bear": {
                "win_rate": 45,
                "avg_return": -1.2,
                "sharpe_ratio": -0.5,
                "trades": 8,
            },
            "range_bound": {
                "win_rate": 58,
                "avg_return": 2.1,
                "sharpe_ratio": 0.9,
                "trades": 15,
            },
            "high_volatility": {
                "win_rate": 48,
                "avg_return": 0.5,
                "sharpe_ratio": 0.2,
                "trades": 12,
            },
        }
        
        return jsonify({
            "strategy": strategy,
            "by_regime": performance,
            "recommendation": "Bull market regime shows best risk-adjusted returns",
        }), 200
    except Exception as e:
        logger.error(f"Error getting regime performance: {e}")
        return jsonify({"error": str(e)}), 500


# ============================================================================
# Trade History & Performance Endpoints
# ============================================================================

@app.route("/api/trades/history", methods=["GET"])
def get_trades_history():
    """Get complete trade history with optional filtering."""
    try:
        limit = request.args.get("limit", 100, type=int)
        strategy = request.args.get("strategy", None, type=str)
        symbol = request.args.get("symbol", None, type=str)
        
        trades = _load_persisted_trade_logs()
        
        # Filter by strategy
        if strategy and strategy != "all":
            trades = [t for t in trades if t.get("strategy", "").lower() == strategy.lower()]
        
        # Filter by symbol
        if symbol and symbol != "all":
            trades = [t for t in trades if _normalize_symbol_text(t.get("symbol", "")) == _normalize_symbol_text(symbol)]
        
        # Sort by timestamp descending (newest first)
        trades.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
        
        # Limit results
        trades = trades[:limit]
        
        return jsonify({
            "trades": trades,
            "count": len(trades),
            "total_available": len(_load_persisted_trade_logs()),
        }), 200
    except Exception as e:
        logger.error(f"Error getting trade history: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/trades/log", methods=["POST"])
def log_new_trade():
    """Log a new trade execution."""
    try:
        data = request.json or {}
        
        symbol = data.get("symbol", "")
        entry_price = float(data.get("entry_price", 0))
        exit_price = float(data.get("exit_price", 0))
        quantity = int(data.get("quantity", 0))
        strategy = data.get("strategy", "unknown")
        entry_reason = data.get("entry_reason", "")
        mode = data.get("mode", "simulated")
        
        if not symbol or entry_price <= 0 or exit_price <= 0 or quantity <= 0:
            return jsonify({"error": "Invalid trade data"}), 400
        
        trade = _log_trade(
            symbol=symbol,
            entry_price=entry_price,
            exit_price=exit_price,
            quantity=quantity,
            strategy=strategy,
            entry_reason=entry_reason,
            mode=mode,
            broker=state.get("broker_name", "demo"),
        )
        
        return jsonify({
            "success": True,
            "trade": trade,
        }), 201
    except Exception as e:
        logger.error(f"Error logging trade: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/trades/metrics", methods=["GET"])
def get_trades_metrics():
    """Get overall trading metrics (win rate, P&L, Sharpe ratio, etc.)."""
    try:
        trades = _load_persisted_trade_logs()
        metrics = _get_trade_metrics(trades)
        
        return jsonify({
            "metrics": metrics,
            "as_of": datetime.now().isoformat(),
        }), 200
    except Exception as e:
        logger.error(f"Error getting trade metrics: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/trades/metrics/by-strategy", methods=["GET"])
def get_trades_metrics_by_strategy():
    """Get trading metrics grouped by strategy."""
    try:
        trades = _load_persisted_trade_logs()
        by_strategy = _get_performance_by_strategy(trades)
        
        return jsonify({
            "strategies": by_strategy,
            "as_of": datetime.now().isoformat(),
        }), 200
    except Exception as e:
        logger.error(f"Error getting strategy metrics: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/trades/daily-pnl", methods=["GET"])
def get_daily_pnl():
    """Get daily P&L summary."""
    try:
        trades = _load_persisted_trade_logs()
        daily = _get_daily_pnl(trades)
        
        return jsonify({
            "daily": daily,
            "as_of": datetime.now().isoformat(),
        }), 200
    except Exception as e:
        logger.error(f"Error getting daily PNL: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/backtest", methods=["POST"])
def run_backtest():
    """Run backtesting on a strategy."""
    try:
        data = request.json or {}
        symbol = data.get("symbol", "AAPL").upper()
        strategy_raw = str(data.get("strategy", "momentum") or "momentum").lower().strip()
        strategy_aliases = {
            "blowup_stocks": "momentum",
            "covered_calls": "swing",
            "forex": "mean_reversion",
            "value": "mean_reversion",
        }
        strategy = strategy_aliases.get(strategy_raw, strategy_raw)
        days_lookback = int(data.get("days_lookback", 60))
        initial_capital = float(data.get("initial_capital", 10000))
        
        if strategy not in ["momentum", "swing", "mean_reversion"]:
            return jsonify({"error": "Unknown strategy"}), 400
        
        result = _backtest_strategy(
            symbol=symbol,
            strategy=strategy,
            days_lookback=days_lookback,
            initial_capital=initial_capital,
        )

        if isinstance(result, dict):
            result["requested_strategy"] = strategy_raw
            result["resolved_strategy"] = strategy
        
        return jsonify(result), 200
    except Exception as e:
        logger.error(f"Error running backtest: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/summary/overnight", methods=["GET"])
def get_overnight_summary():
    """Get summary of overnight trading (what bot did while user slept)."""
    try:
        summary = _get_overnight_summary()
        return jsonify(summary), 200
    except Exception as e:
        logger.error(f"Error getting overnight summary: {e}")
        return jsonify({"error": str(e)}), 500


@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(500)
def internal_error(error):
    return jsonify({"error": "Internal server error"}), 500


if __name__ == "__main__":
    app.run(debug=True, host="127.0.0.1", port=5000)
