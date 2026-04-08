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
    "bot_dry_run": os.getenv("AUTO_EXECUTE_TRADES", "true").lower() != "true",
    "broker_runtime_config": {},
    "bot_logs": deque(maxlen=300),
    "bot_log_seq": 0,
    "simulated_trade_logs": deque(maxlen=500),
    "forex_grid_state": {"pairs": {}, "last_cycle": None},
    "last_ib_client_id": None,
}

BACKEND_ROOT = Path(__file__).resolve().parent.parent
TRADE_HISTORY_FILE = BACKEND_ROOT / "data" / "trade_history.json"
TRADE_HISTORY_LOCK = threading.Lock()


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

        def _loop():
            logger.info("Automatic bot runner started")
            state["bot_running"] = True
            append_bot_log(
                "Bot runner started",
                details={
                    "execution_mode": state.get("execution_mode"),
                    "dry_run": state.get("bot_dry_run"),
                    "interval_seconds": max(10, interval_seconds),
                },
            )
            while not self._stop_event.is_set():
                try:
                    state["bot_heartbeat"] = datetime.now().isoformat()
                    self._run_cycle()
                    state["bot_last_error"] = None
                except Exception as e:
                    state["bot_last_error"] = str(e)
                    logger.error(f"Bot cycle error: {e}")
                    append_bot_log("Bot cycle failed", level="error", details={"error": str(e)})
                time.sleep(max(10, interval_seconds))

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

    def _run_cycle(self):
        """Run one automated scan cycle and generate actions."""
        cfg = (state["config_manager"] or ConfigManager()).load_user_config()

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

        # Covered-call-first behavior: never auto-buy shares to top up under-covered positions.
        actions = []
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

        # Keep forex strategy continuously active using grid trading,
        # with capital sized by the current mode's forex allocation.
        mode_name = str(cfg.get("mode", "")).lower().strip()
        allocation = cfg.get("allocation", {}) if isinstance(cfg, dict) else {}
        forex_alloc_pct = float(allocation.get("forex_pct", 0.0) or 0.0)

        if forex_alloc_pct > 0:
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
                "Forex grid cycle completed",
                details={
                    "mode": mode_name,
                    "allocation_pct": round(forex_alloc_pct, 2),
                    "pairs": forex_summary.get("pairs_processed", 0),
                    "opened": forex_summary.get("opened", 0),
                    "closed": forex_summary.get("closed", 0),
                    "realized_pnl": forex_summary.get("realized_pnl", 0.0),
                    "execution": "simulated" if state.get("bot_dry_run", True) else "live_paper",
                },
            )

        state["portfolio_data"]["last_actions"] = actions
        state["bot_heartbeat"] = datetime.now().isoformat()
        state["bot_last_run"] = datetime.now().isoformat()
        state["bot_cycle_count"] += 1

    def _run_forex_grid_cycle(
        self,
        cfg: Dict[str, Any],
        broker,
        allocation_pct: float,
        dry_run: bool,
    ) -> tuple[Dict[str, Any], List[Dict[str, Any]]]:
        """Run one forex grid cycle and return summary + closed-trade log rows."""
        forex_cfg = cfg.get("forex", {}) if isinstance(cfg, dict) else {}
        pairs = list(forex_cfg.get("pairs") or ["EURUSD", "GBPUSD", "USDJPY"])
        grid_step_pct = float(forex_cfg.get("grid_step_pct", 0.0015) or 0.0015)
        max_legs = max(1, min(int(forex_cfg.get("grid_max_legs_per_pair", 3) or 3), 8))
        take_profit_steps = max(1, min(int(forex_cfg.get("grid_take_profit_steps", 1) or 1), 3))

        account_total = 100000.0
        try:
            if broker is not None:
                snapshot = run_async(broker.get_account_snapshot())
                account_total = float(getattr(snapshot, "total_value", 0.0) or 0.0) or account_total
        except Exception:
            account_total = 100000.0

        grid_capital = max(5000.0, account_total * (allocation_pct / 100.0))
        pair_budget = grid_capital / max(1, len(pairs))
        per_leg_budget = pair_budget / max(1, max_legs * 2)

        grid_state = state.setdefault("forex_grid_state", {"pairs": {}, "last_cycle": None})
        pair_states = grid_state.setdefault("pairs", {})

        opened = 0
        closed = 0
        realized_total = 0.0
        trade_rows: List[Dict[str, Any]] = []

        for pair in pairs:
            price = self._get_fx_spot_price(pair)
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
                },
            )

            anchor = float(pair_state.get("anchor", price) or price)

            # Keep grid continuously active: seed a starter leg when pair has no exposure.
            if not pair_state["open_longs"] and not pair_state["open_shorts"]:
                starter_side = "buy" if (int(datetime.now().timestamp() // 60) + len(pair)) % 2 == 0 else "sell"
                starter_submitted = self._submit_forex_grid_order(broker, pair, starter_side, qty, dry_run)
                if starter_submitted:
                    leg = {"entry_price": price, "quantity": qty, "opened_at": datetime.now().isoformat()}
                    if starter_side == "buy":
                        pair_state["open_longs"].append(leg)
                    else:
                        pair_state["open_shorts"].append(leg)
                    opened += 1

            long_trigger = anchor * (1.0 - grid_step_pct * (len(pair_state["open_longs"]) + 1))
            if price <= long_trigger and len(pair_state["open_longs"]) < max_legs:
                submitted = self._submit_forex_grid_order(broker, pair, "buy", qty, dry_run)
                if submitted:
                    pair_state["open_longs"].append({"entry_price": price, "quantity": qty, "opened_at": datetime.now().isoformat()})
                    opened += 1

            short_trigger = anchor * (1.0 + grid_step_pct * (len(pair_state["open_shorts"]) + 1))
            if price >= short_trigger and len(pair_state["open_shorts"]) < max_legs:
                submitted = self._submit_forex_grid_order(broker, pair, "sell", qty, dry_run)
                if submitted:
                    pair_state["open_shorts"].append({"entry_price": price, "quantity": qty, "opened_at": datetime.now().isoformat()})
                    opened += 1

            tp_pct = grid_step_pct * take_profit_steps

            remaining_longs = []
            for leg in pair_state["open_longs"]:
                entry = float(leg.get("entry_price", price) or price)
                leg_qty = int(leg.get("quantity", qty) or qty)
                if price >= entry * (1.0 + tp_pct):
                    submitted = self._submit_forex_grid_order(broker, pair, "sell", leg_qty, dry_run)
                    if submitted:
                        pnl = (price - entry) * leg_qty
                        fees = max(0.5, leg_qty * 0.00002)
                        net = round(float(pnl - fees), 2)
                        realized_total += net
                        pair_state["realized_pnl"] = round(float(pair_state.get("realized_pnl", 0.0) or 0.0) + net, 2)
                        closed += 1
                        trade_rows.append(self._build_grid_trade_row(pair, "buy", leg_qty, entry, price, net, dry_run))
                        continue
                remaining_longs.append(leg)
            pair_state["open_longs"] = remaining_longs

            remaining_shorts = []
            for leg in pair_state["open_shorts"]:
                entry = float(leg.get("entry_price", price) or price)
                leg_qty = int(leg.get("quantity", qty) or qty)
                if price <= entry * (1.0 - tp_pct):
                    submitted = self._submit_forex_grid_order(broker, pair, "buy", leg_qty, dry_run)
                    if submitted:
                        pnl = (entry - price) * leg_qty
                        fees = max(0.5, leg_qty * 0.00002)
                        net = round(float(pnl - fees), 2)
                        realized_total += net
                        pair_state["realized_pnl"] = round(float(pair_state.get("realized_pnl", 0.0) or 0.0) + net, 2)
                        closed += 1
                        trade_rows.append(self._build_grid_trade_row(pair, "sell", leg_qty, entry, price, net, dry_run))
                        continue
                remaining_shorts.append(leg)
            pair_state["open_shorts"] = remaining_shorts

            if not pair_state["open_longs"] and not pair_state["open_shorts"]:
                pair_state["anchor"] = price

        grid_state["last_cycle"] = datetime.now().isoformat()

        summary = {
            "pairs_processed": len(pairs),
            "opened": opened,
            "closed": closed,
            "realized_pnl": round(realized_total, 2),
            "grid_step_pct": round(grid_step_pct * 100, 3),
            "max_legs_per_pair": max_legs,
            "grid_capital": round(grid_capital, 2),
        }
        return summary, trade_rows

    def _submit_forex_grid_order(self, broker, pair: str, side: str, quantity: int, dry_run: bool) -> bool:
        if dry_run:
            return True
        if broker is None:
            return False
        if state.get("broker_name") != "ibkr":
            return False
        if not hasattr(broker, "place_forex_order"):
            return False

        try:
            order = run_async(broker.place_forex_order(pair=pair, side=side, quantity=quantity))
            return bool(order and getattr(order, "status", "") != "failed")
        except Exception:
            return False

    def _build_grid_trade_row(
        self,
        pair: str,
        entry_side: str,
        quantity: int,
        entry_price: float,
        exit_price: float,
        net_pnl: float,
        dry_run: bool,
    ) -> Dict[str, Any]:
        return {
            "trade_id": f"GRID-{datetime.now().strftime('%Y%m%d%H%M%S%f')}",
            "timestamp": datetime.now().isoformat(),
            "strategy": "forex_grid",
            "asset_type": "forex",
            "symbol": pair,
            "underlying": pair,
            "side": entry_side,
            "quantity": quantity,
            "entry_price": round(float(entry_price), 5),
            "exit_price": round(float(exit_price), 5),
            "fees": round(max(0.5, quantity * 0.00002), 2),
            "gross_pnl": round(float(net_pnl), 2),
            "net_pnl": round(float(net_pnl), 2),
            "status": "closed",
            "order_submitted": not dry_run,
            "execution_origin": "simulated" if dry_run else "live_paper",
            "is_simulated": bool(dry_run),
            "notes": "Aggressive mode forex grid close",
        }

    def _get_fx_spot_price(self, pair: str) -> float:
        ticker = f"{pair}=X"
        try:
            hist = yf.Ticker(ticker).history(period="5d", interval="5m")
            if hist is not None and not hist.empty and "Close" in hist.columns:
                closes = hist["Close"].dropna()
                if not closes.empty:
                    return float(closes.iloc[-1])
        except Exception:
            pass
        fallback = {
            "EURUSD": 1.08,
            "GBPUSD": 1.27,
            "USDJPY": 149.5,
            "AUDUSD": 0.66,
            "NZDUSD": 0.60,
        }
        return float(fallback.get(pair, 1.0))


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

        source = "demo"
        broker = state.get("broker")
        logs = []
        simulated_logs = list(state.get("simulated_trade_logs", []))

        if broker is not None and hasattr(broker, "get_trade_logs"):
            logs = run_async(broker.get_trade_logs(days=days, asset_type=asset_type, status=status)) or []
            source = state.get("broker_name", "live")
        elif broker is None:
            mock_gen = MockPortfolioGenerator()
            logs = mock_gen.generate_trade_logs(days=days)
            source = "demo"

            if asset_type != "all":
                logs = [row for row in logs if str(row.get("asset_type", "")).lower() == asset_type]

            if status != "all":
                logs = [row for row in logs if str(row.get("status", "")).lower() == status]
        else:
            # Connected broker without trade-log support: return empty live set.
            logs = []
            source = f"{state.get('broker_name', 'live')}_unsupported"

        # Merge one-click simulated records for demo/testing visibility.
        if simulated_logs:
            logs.extend(simulated_logs)

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
    open_longs = 0
    open_shorts = 0
    realized_pnl = 0.0
    for _, pair_state in pairs.items():
        open_longs += len(pair_state.get("open_longs", []) or [])
        open_shorts += len(pair_state.get("open_shorts", []) or [])
        realized_pnl += float(pair_state.get("realized_pnl", 0.0) or 0.0)

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
        "forex_grid": {
            "pairs_configured": len(pairs),
            "open_longs": open_longs,
            "open_shorts": open_shorts,
            "open_total": open_longs + open_shorts,
            "realized_pnl": round(realized_pnl, 2),
            "last_cycle": grid_state.get("last_cycle"),
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


@app.route("/api/broker/options", methods=["GET"])
def get_broker_options():
    """Get current broker and supported broker types."""
    try:
        return jsonify({
            "current": state["broker_name"],
            "connected": state["broker"] is not None,
            "active_config": state.get("broker_runtime_config", {}),
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


@app.route("/api/backtest/<symbol>/<strategy>", methods=["GET"])
def run_backtest(symbol, strategy):
    """Run historical backtest on a symbol/strategy combo."""
    try:
        from backtest import BacktestEngine
        import numpy as np
        
        symbol = str(symbol).upper().strip()
        strategy = str(strategy).lower().strip()
        lookback_days = request.args.get("lookback_days", 252, type=int)
        
        engine = BacktestEngine(symbol, lookback_days=lookback_days)
        
        if strategy == "blowup_stocks":
            result = engine.backtest_blowup_stocks()
        elif strategy == "covered_calls":
            result = engine.backtest_covered_calls()
        else:
            return jsonify({"error": f"Unknown strategy: {strategy}"}), 400
        
        if not result:
            return jsonify({"error": f"Backtest failed for {symbol}"}), 500

        diagnostics = None
        if result.total_trades == 0:
            diagnostics = {
                "status": "no_trades",
                "message": f"No completed trades were generated for {symbol} under current {strategy} rules.",
                "suggestions": [
                    "Try a different symbol with more recent momentum shifts.",
                    "Increase lookback days to 400-600 to capture more setups.",
                    "For blowup stocks, consider names with frequent volume spikes.",
                ],
            }

            try:
                hist_data = engine.fetch_historical_data(
                    datetime.now() - timedelta(days=lookback_days),
                    datetime.now(),
                )
                closes = hist_data.get("closes") if hist_data else None
                volumes = hist_data.get("volumes") if hist_data else None
                if closes is not None and volumes is not None and len(closes) >= 30 and len(volumes) >= 30:
                    volume_ma_20 = np.convolve(volumes, np.ones(20) / 20, mode="valid")
                    strict_signals = 0
                    relaxed_signals = 0
                    for i in range(20, len(closes)):
                        ratio = volumes[i] / max(1e-9, volume_ma_20[i - 20])
                        up_day = closes[i] > closes[i - 1]
                        if ratio > 2.0 and up_day:
                            strict_signals += 1
                        if ratio > 1.5 and up_day:
                            relaxed_signals += 1

                    diagnostics["signal_scan"] = {
                        "strict_signals": int(strict_signals),
                        "relaxed_signals": int(relaxed_signals),
                        "bars_evaluated": int(len(closes)),
                    }
            except Exception:
                pass
        
        return jsonify({
            "symbol": symbol,
            "strategy": strategy,
            "result": {
                "total_trades": result.total_trades,
                "winning_trades": result.winning_trades,
                "losing_trades": result.losing_trades,
                "win_rate": result.win_rate,
                "avg_win": result.avg_win,
                "avg_loss": result.avg_loss,
                "sharpe_ratio": result.sharpe_ratio,
                "max_drawdown": result.max_drawdown,
                "total_return": result.total_return,
            },
            "diagnostics": diagnostics,
        }), 200
    except Exception as e:
        logger.error(f"Error running backtest: {e}")
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


@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(500)
def internal_error(error):
    return jsonify({"error": "Internal server error"}), 500


if __name__ == "__main__":
    app.run(debug=True, host="127.0.0.1", port=5000)
