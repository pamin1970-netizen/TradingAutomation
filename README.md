# TradingAutomation

Parse text option orders (1–4 legs), dry-run them at the broker, and place only after a single-use approval.

## Flow
1. `POST /api/parse`: text → validated legs. Every leg must say `TO OPEN` or `TO CLOSE`.
2. `POST /api/preview`: guardrails → broker dry run → approval id (valid 60s, single use).
3. `POST /api/previews/:id/place`: places the exact previewed order. Any edit needs a new preview.

## Input format
```
BUY 1 SPY 2026-12-18 480 PUT TO OPEN
SELL 1 SPY 2026-12-18 490 PUT TO OPEN
SELL 1 SPY 2026-12-18 510 CALL TO OPEN
BUY 1 SPY 2026-12-18 520 CALL TO OPEN
@ 2.10 CREDIT
```

## Brokers
- **tastytrade**: enabled with `TASTYTRADE_ENABLED=1`.
- **Robinhood**: stub, always disabled. Its official API is crypto-only.

## Safety
- Bearer `ADMIN_TOKEN` required on `/api/*`.
- Guardrails: `MAX_CONTRACTS`, `MAX_ORDER_VALUE_USD`, `DAILY_CAP_USD`, `SYMBOL_ALLOWLIST`.
- `KILL_SWITCH=1` blocks previews and placements. `READ_ONLY=1` blocks placements.
- Credentials come only from environment variables. Never commit `.env`.

## Run
```
bun install
bun test
bun run start
```

See `.env.example` for variables.

