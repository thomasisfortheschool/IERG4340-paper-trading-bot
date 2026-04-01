"""
Flask API server for the trading dashboard.
Provides REST endpoints for strategy control, configuration, and portfolio monitoring.
"""
import logging
import os
import asyncio
import sys
from dataclasses import asdict
from flask import Flask, jsonify, request
from flask_cors import CORS
from datetime import datetime
import yfinance as yf

# Support running this file directly (python api/app.py) by adding backend root to sys.path.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

try:
    asyncio.get_event_loop()
except RuntimeError:
    asyncio.set_event_loop(asyncio.new_event_loop())

from config import ConfigManager, TradingMode
from brokers.base_broker import BrokerFactory
from brokers.ibkr_broker import IBKRBroker  # Register in BrokerFactory
from brokers.alpaca_broker import AlpacaBroker  # Register in BrokerFactory
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
    "portfolio_data": {},
    "scan_results": {},
    "current_mode": TradingMode.BALANCED,
}


def run_async(coro):
    """Run async broker methods from sync Flask handlers."""
    try:
        return asyncio.run(coro)
    except RuntimeError:
        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(coro)
        finally:
            loop.close()


def load_broker_from_env():
    """Create and connect a broker from environment variables."""
    broker_type = os.getenv("BROKER_TYPE", "ibkr").lower().strip()

    return build_and_connect_broker(broker_type)


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
        return broker, "alpaca"

    if broker_type == "ibkr":
        broker = BrokerFactory.create_broker(
            "ibkr",
            host=overrides.get("host") or os.getenv("IB_HOST", "127.0.0.1"),
            port=int(overrides.get("port") or os.getenv("IB_PORT", "7497")),
            client_id=int(overrides.get("client_id") or os.getenv("IB_CLIENT_ID", "100")),
            paper_trading=True,
        )
        connected = run_async(broker.connect())
        if not connected:
            raise RuntimeError("Failed to connect to IBKR")
        return broker, "ibkr"

    raise ValueError(f"Unsupported BROKER_TYPE: {broker_type}")


def switch_broker(broker_type: str, config: dict = None):
    """Disconnect existing broker and switch to requested one."""
    current = state.get("broker")
    if current is not None:
        try:
            run_async(current.disconnect())
        except Exception as e:
            logger.warning(f"Failed to disconnect current broker cleanly: {e}")

    broker, name = build_and_connect_broker(broker_type, config or {})
    state["broker"] = broker
    state["broker_name"] = name
    return name


def get_positions_for_recommendation():
    """Get current positions for recommendation scoring."""
    if state["broker"] is None:
        return MockPortfolioGenerator().generate_positions()

    broker_positions = run_async(state["broker"].get_positions()) or []
    return [asdict(p) for p in broker_positions]


@app.before_request
def initialize():
    """Initialize broker and config on first request."""
    if state["broker"] is None:
        try:
            state["config_manager"] = ConfigManager()
            state["broker"], state["broker_name"] = load_broker_from_env()
            logger.info(f"Broker initialized: {state['broker_name']}")
        except Exception as e:
            logger.error(f"Broker initialization failed: {e}")
            # Fall back to mock data
            state["broker"] = None
            state["broker_name"] = "demo"


# ============ Portfolio & Account Endpoints ============

@app.route("/api/account", methods=["GET"])
def get_account():
    """Get current account snapshot."""
    try:
        if state["broker"] is None:
            # Return mock data
            mock_gen = MockPortfolioGenerator()
            return jsonify(mock_gen.generate_account_snapshot()), 200
        
        account = run_async(state["broker"].get_account_snapshot())
        return jsonify(asdict(account)), 200
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

@app.route("/api/screen/blowup-stocks", methods=["GET"])
def screen_blowup_stocks():
    """Get blowup stock opportunities."""
    try:
        # In production, this would run async scans
        mock_gen = MockPortfolioGenerator()
        candidates = mock_gen.generate_blowup_stock_candidates()
        return jsonify({"candidates": candidates}), 200
    except Exception as e:
        logger.error(f"Error screening stocks: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/screen/covered-calls", methods=["GET"])
def screen_covered_calls():
    """Get covered call opportunities."""
    try:
        mock_gen = MockPortfolioGenerator()
        opportunities = mock_gen.generate_covered_call_opportunities()
        return jsonify({"opportunities": opportunities}), 200
    except Exception as e:
        logger.error(f"Error screening calls: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/screen/forex", methods=["GET"])
def screen_forex():
    """Get forex trading opportunities."""
    try:
        mock_gen = MockPortfolioGenerator()
        opportunities = mock_gen.generate_forex_opportunities()
        return jsonify({"opportunities": opportunities}), 200
    except Exception as e:
        logger.error(f"Error screening forex: {e}")
        return jsonify({"error": str(e)}), 500


# ============ Trading Endpoints ============

@app.route("/api/trade/place-order", methods=["POST"])
def place_order():
    """Place a new trade order."""
    try:
        data = request.json
        symbol = data.get("symbol")
        side = data.get("side")  # buy/sell
        quantity = data.get("quantity")
        
        if state["broker"] is None:
            return jsonify({
                "status": "success",
                "order_id": "DEMO-12345",
                "symbol": symbol,
                "side": side,
                "quantity": quantity,
            }), 200

        order = run_async(state["broker"].place_order(symbol, side, quantity))
        if order.status == "failed":
            return jsonify({"error": "Order placement failed"}), 500
        payload = asdict(order)
        if payload.get("timestamp") is not None:
            payload["timestamp"] = payload["timestamp"].isoformat()
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

        if broker_type == "demo":
            state["broker"] = None
            state["broker_name"] = "demo"
            return jsonify({"status": "success", "broker": "demo", "connected": False}), 200

        if broker_type not in {"ibkr", "alpaca"}:
            return jsonify({"error": "broker must be one of: ibkr, alpaca, demo"}), 400

        active = switch_broker(broker_type, config)
        return jsonify({"status": "success", "broker": active, "connected": True}), 200
    except Exception as e:
        logger.error(f"Broker switch failed: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/ticker/research", methods=["GET"])
def ticker_research():
    """Search ticker and return quote, fundamentals, analyst sentiment, and recommendation."""
    symbol = request.args.get("symbol", "").upper().strip()
    if not symbol:
        return jsonify({"error": "Query param 'symbol' is required"}), 400

    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info or {}
        hist = ticker.history(period="5d", interval="1m")
        if hist.empty:
            hist = ticker.history(period="1d", interval="5m")

        price = float(hist["Close"].iloc[-1]) if not hist.empty else float(info.get("currentPrice") or 0.0)
        prev_close = float(info.get("previousClose") or price or 0.0)
        change = price - prev_close
        change_pct = (change / prev_close * 100.0) if prev_close else 0.0

        positions = get_positions_for_recommendation()
        account_total = float(request.args.get("account_total", 0) or 0)
        if account_total <= 0:
            account_total = sum(float(p.get("current_price", 0)) * float(p.get("quantity", 0)) for p in positions)
            account_total = account_total or 100000.0

        existing_position_value = 0.0
        for p in positions:
            if p.get("symbol", "").upper() == symbol:
                existing_position_value += float(p.get("current_price", 0)) * float(p.get("quantity", 0))
        concentration_pct = (existing_position_value / account_total) * 100.0 if account_total else 0.0

        recommendation_mean = info.get("recommendationMean")
        analyst_count = int(info.get("numberOfAnalystOpinions") or 0)
        trailing_pe = info.get("trailingPE")
        forward_pe = info.get("forwardPE")
        market_cap = info.get("marketCap")

        score = 50.0

        if recommendation_mean is not None:
            # Yahoo scale: 1=strong buy ... 5=sell
            score += max(-20.0, min(20.0, (3.0 - float(recommendation_mean)) * 15.0))
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

        score = max(0.0, min(100.0, score))

        if score >= 65:
            action = "buy"
        elif score >= 45:
            action = "watch"
        else:
            action = "avoid"

        reasons = []
        if recommendation_mean is not None:
            reasons.append(f"Analyst recommendation mean: {float(recommendation_mean):.2f} (1=strong buy, 5=sell)")
        if forward_pe is not None:
            reasons.append(f"Forward P/E: {float(forward_pe):.2f}")
        elif trailing_pe is not None:
            reasons.append(f"Trailing P/E: {float(trailing_pe):.2f}")
        reasons.append(f"Portfolio concentration in {symbol}: {concentration_pct:.2f}%")

        return jsonify({
            "symbol": symbol,
            "company_name": info.get("longName") or info.get("shortName") or symbol,
            "sector": info.get("sector"),
            "industry": info.get("industry"),
            "price": round(price, 4),
            "previous_close": round(prev_close, 4),
            "change": round(change, 4),
            "change_pct": round(change_pct, 4),
            "market_cap": market_cap,
            "trailing_pe": trailing_pe,
            "forward_pe": forward_pe,
            "analyst_recommendation_mean": recommendation_mean,
            "analyst_opinions_count": analyst_count,
            "recommendation": {
                "action": action,
                "score": round(score, 2),
                "reasons": reasons,
            },
        }), 200
    except Exception as e:
        logger.error(f"Error researching ticker {symbol}: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/status/health", methods=["GET"])
def health_check():
    """Health check endpoint."""
    return jsonify({"status": "healthy", "timestamp": datetime.now().isoformat()}), 200


# ============ Error Handlers ============

@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(500)
def internal_error(error):
    return jsonify({"error": "Internal server error"}), 500


if __name__ == "__main__":
    app.run(debug=True, host="127.0.0.1", port=5000)
