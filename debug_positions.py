#!/usr/bin/env python
import sys
sys.path.insert(0, '.')
from backend.brokers.ibkr_broker import IBKRBroker
from backend.config import get_config

config = get_config()
broker = IBKRBroker(config)

# Check positions
try:
    positions = broker.get_positions()
    if positions:
        print(f"Found {len(positions)} positions:\n")
        for pos in positions:
            print(f"Symbol: {pos.symbol}, Qty: {pos.quantity}, Avg Price: {pos.avg_price}")
            if hasattr(pos, 'entry_date'):
                print(f"  entry_date: {pos.entry_date}")
            if hasattr(pos, 'opened_at'):
                print(f"  opened_at: {pos.opened_at}")
            if hasattr(pos, 'buy_date'):
                print(f"  buy_date: {pos.buy_date}")
            if hasattr(pos, 'created_at'):
                print(f"  created_at: {pos.created_at}")
            if hasattr(pos, 'timestamp'):
                print(f"  timestamp: {pos.timestamp}")
            print(f"  asset_type: {pos.asset_type}")
            print()
    else:
        print("No positions")
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()
