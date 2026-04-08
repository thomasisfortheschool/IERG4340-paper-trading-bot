# Testing Strategy

## Framework

Use a layered test stack:

1. Python backend: `unittest` for API smoke tests and targeted regression checks.
2. Frontend: `npm run build` plus React component tests where logic is non-trivial.
3. Integration: API-backed smoke tests against the Flask app with mocked broker/data providers.
4. Manual validation: end-to-end checks for broker connection, research, and order flows before presentations or demos.

## What Must Be Validated

The app should be validated in the areas that carry the highest risk or user-visible impact:

1. Broker safety: live order confirmation, broker switching restrictions, and bot start/stop behavior.
2. Portfolio integrity: account snapshot, positions, P&L, and trade history persistence across restarts.
3. Research correctness: ticker search, chart rendering payloads, fundamentals, dividends, news, and recommendation logic.
4. Strategy controls: custom strategy settings, backtest inputs, and regime-aware outputs.
5. Risk controls: concentration warnings, drawdown exposure, and covered-call eligibility rules.
6. UI reliability: dashboard navigation, state refresh, and empty-data handling.
7. Failure handling: missing Yahoo fields, broker disconnects, and fallback data paths.

## Presentation Angle

For a professor, frame this as a risk-based testing plan:

1. Unit tests protect calculations and formatting logic.
2. API smoke tests prove the system stays safe and responsive under expected flows.
3. Integration tests ensure the dashboard and backend agree on payload shapes.
4. Regression tests catch the exact kinds of runtime failures that caused past issues, such as null-market-data crashes.