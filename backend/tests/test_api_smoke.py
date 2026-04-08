import os
import sys
import unittest
from datetime import datetime
from unittest.mock import patch

import pandas as pd

os.environ.setdefault("BROKER_TYPE", "demo")
os.environ.setdefault("AUTO_EXECUTE_TRADES", "false")

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from api.app import app, state
from brokers.base_broker import Order


class FakeLiveBroker:
    paper_trading = True

    async def place_order(self, symbol, side, quantity, order_type="market", price=None):
        return Order(
            order_id="TEST-123",
            symbol=symbol,
            side=side,
            order_type=order_type,
            quantity=quantity,
            price=price,
            status="submitted",
            timestamp=datetime.now(),
        )

    async def cancel_order(self, order_id):
        return True


class FakeTicker:
    def __init__(self):
        self.info = {
            "longName": "Test Corp",
            "shortName": "Test",
            "recommendationMean": None,
            "numberOfAnalystOpinions": None,
            "trailingPE": None,
            "forwardPE": None,
            "marketCap": None,
            "freeCashflow": None,
            "sharesOutstanding": None,
            "dividendYield": None,
            "payoutRatio": None,
            "beta": None,
            "trailingEps": None,
            "forwardEps": None,
            "previousClose": 100.0,
        }
        self.fast_info = {
            "lastPrice": 100.0,
            "previousClose": 99.5,
            "marketCap": 1234567890,
            "shortName": "Test Fast",
        }
        self.dividends = pd.Series(dtype=float)
        self.news = []

    def history(self, period="1y", interval="1d"):
        index = pd.to_datetime(["2026-04-06", "2026-04-07"])
        return pd.DataFrame(
            {
                "Open": [100.0, float("nan")],
                "High": [101.0, float("nan")],
                "Low": [99.5, float("nan")],
                "Close": [100.0, float("nan")],
                "Volume": [1000000, 500000],
            },
            index=index,
        )


class ApiSmokeTests(unittest.TestCase):
    def setUp(self):
        app.config["TESTING"] = True
        self.client = app.test_client()
        self._state_snapshot = {
            "broker": state.get("broker"),
            "broker_name": state.get("broker_name"),
            "broker_runtime_config": state.get("broker_runtime_config"),
            "broker_init_attempted": state.get("broker_init_attempted"),
            "bot_running": state.get("bot_running"),
            "execution_mode": state.get("execution_mode"),
            "bot_dry_run": state.get("bot_dry_run"),
            "simulated_trade_logs": state.get("simulated_trade_logs"),
        }
        state["broker"] = None
        state["broker_name"] = "demo"
        state["broker_runtime_config"] = {}
        state["broker_init_attempted"] = True
        state["bot_running"] = False
        state["execution_mode"] = "manual"
        state["bot_dry_run"] = True
        state["simulated_trade_logs"].clear()

    def tearDown(self):
        if state.get("bot_running"):
            self.client.post("/api/bot/stop")
        for key, value in self._state_snapshot.items():
            state[key] = value

    def test_health_and_broker_status(self):
        health = self.client.get("/api/status/health")
        self.assertEqual(health.status_code, 200)
        self.assertEqual(health.get_json()["status"], "healthy")

        broker = self.client.get("/api/status/broker")
        payload = broker.get_json()
        self.assertEqual(broker.status_code, 200)
        self.assertFalse(payload["connected"])
        self.assertEqual(payload["broker"], "Demo")

    def test_live_order_requires_confirmation(self):
        state["broker"] = FakeLiveBroker()
        state["broker_name"] = "ibkr"
        state["broker_runtime_config"] = {"paper_trading": True}

        rejected = self.client.post(
            "/api/trade/place-order",
            json={"symbol": "AAPL", "side": "buy", "quantity": 1},
        )
        self.assertEqual(rejected.status_code, 400)
        self.assertIn("confirm_live", rejected.get_json()["error"])

        accepted = self.client.post(
            "/api/trade/place-order",
            json={"symbol": "AAPL", "side": "buy", "quantity": 1, "confirm_live": True},
        )
        payload = accepted.get_json()
        self.assertEqual(accepted.status_code, 200)
        self.assertEqual(payload["symbol"], "AAPL")
        self.assertEqual(payload["side"], "buy")
        self.assertEqual(payload["status"], "success")
        self.assertEqual(payload["order_status"], "submitted")

    def test_switch_broker_blocked_while_bot_running(self):
        state["bot_running"] = True
        response = self.client.post(
            "/api/broker/switch",
            json={"broker": "ibkr", "config": {}},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("Stop the bot", response.get_json()["error"])

    def test_invalid_broker_switch_is_rejected(self):
        response = self.client.post(
            "/api/broker/switch",
            json={"broker": "unsupported", "config": {}},
        )
        self.assertEqual(response.status_code, 400)

    def test_starting_bot_forces_live_execution(self):
        state["execution_mode"] = "automatic"
        state["bot_dry_run"] = True

        response = self.client.post(
            "/api/bot/start",
            json={"interval_seconds": 10},
        )
        payload = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertFalse(payload["dry_run"])
        self.assertFalse(state["bot_dry_run"])

        self.client.post("/api/bot/stop")

    def test_portfolio_risk_summary_is_returned(self):
        response = self.client.get("/api/positions/risks")
        payload = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertIn("aggregate", payload)
        self.assertIn("risk_score", payload["aggregate"])
        self.assertIn("risk_level", payload["aggregate"])
        self.assertIn("headline", payload["aggregate"])

    def test_account_daily_pnl_includes_today_local_trade_logs(self):
        baseline = self.client.get("/api/account").get_json()
        baseline_daily = float(baseline.get("daily_pnl", 0))

        now = datetime.now().isoformat()
        state["simulated_trade_logs"].append(
            {
                "timestamp": now,
                "net_pnl": -0.84,
                "strategy": "try_buy_sell_live",
            }
        )
        state["simulated_trade_logs"].append(
            {
                "timestamp": now,
                "net_pnl": -0.80,
                "strategy": "try_buy_sell_live",
            }
        )

        response = self.client.get("/api/account")
        payload = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertAlmostEqual(float(payload.get("daily_pnl", 0)) - baseline_daily, -1.64, places=2)

    def test_ticker_research_handles_missing_yahoo_fields(self):
        with patch("api.app.yf.Ticker", return_value=FakeTicker()):
            response = self.client.get("/api/ticker/research?symbol=TEST&market=us&period=1y&interval=1d")

        payload = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["symbol"], "TEST")
        self.assertEqual(payload["price"], 100.0)
        self.assertEqual(payload["market_cap"], 1234567890.0)
        self.assertEqual(payload["previous_close"], 100.0)
        self.assertEqual(payload["chart"]["points"][-1]["close"], 100.0)
        self.assertIn("recommendation", payload)
        self.assertGreaterEqual(payload["recommendation"]["score"], 0)


if __name__ == "__main__":
    unittest.main()