# MT5 Bridge (Tariq's real-order skill)

A tiny local HTTP service that lets the gemification app place **gold (XAUUSD)**
orders on a running **MetaTrader 5** terminal. Used only by the human-confirmed
"ส่งคำสั่งจริง" button — the autonomous AI loop never calls it.

## Safety

- **Demo-only by default.** Refuses LIVE accounts unless `ALLOW_LIVE=true`.
- Volume capped by `MAX_LOT` (default 0.10).
- Optional shared secret (`BRIDGE_TOKEN`) checked against the `X-Bridge-Token` header.
- Boots in **degraded mode** if MetaTrader5 / the terminal is missing — `/health`
  still answers so you can wire and test before MT5 is installed.

## Prerequisites

1. Install the **MetaTrader 5 desktop terminal** (Windows) and log into a
   **demo** account (Tools → Options → keep it running while trading).
2. Note your demo **login / password / server** and the broker's gold symbol
   (often `XAUUSD`, sometimes `XAUUSD.m`, `GOLD`, etc. — see Market Watch).
3. Python: the `MetaTrader5` package is Windows-only and currently ships wheels
   for Python 3.9–3.12. If your default Python is newer (e.g. 3.14), create a
   3.12 venv for this bridge.

## Setup

```powershell
cd C:\Users\Rithirong\gemification\mt5-bridge
py -3.12 -m venv .venv            # or: python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## Configure (environment)

```powershell
$env:MT5_LOGIN   = "12345678"          # demo account number
$env:MT5_PASSWORD= "your-demo-pass"
$env:MT5_SERVER  = "YourBroker-Demo"
$env:MT5_SYMBOL  = "XAUUSD"            # match Market Watch exactly
$env:BRIDGE_TOKEN= "pick-a-long-random-string"
$env:MAX_LOT     = "0.10"
# $env:MT5_PATH  = "C:\Program Files\MetaTrader 5\terminal64.exe"  # if non-default
# $env:ALLOW_LIVE= "true"   # ⚠ only if you really mean real money
```

## Run

```powershell
uvicorn bridge:app --host 127.0.0.1 --port 8000
```

Check it: open http://127.0.0.1:8000/health — it reports whether the MT5
package is present and whether the terminal/account is connected (and `is_demo`).

## Tell Convex about the bridge

```powershell
cd C:\Users\Rithirong\gemification
$env:CONVEX_AGENT_MODE="anonymous"
npx convex env set MT5_BRIDGE_URL   http://127.0.0.1:8000
npx convex env set MT5_BRIDGE_TOKEN pick-a-long-random-string   # same as BRIDGE_TOKEN
npx convex env set MT5_LOT          0.01                        # lot per real order
```

Without these vars, the "ส่งคำสั่งจริง" button just logs the intent (no order is
placed).

## Endpoints

| Method | Path       | Purpose                              |
|--------|------------|--------------------------------------|
| GET    | `/health`  | bridge + MT5 + account status        |
| GET    | `/price`   | current XAUUSD bid/ask/last          |
| GET    | `/account` | balance / equity / margin            |
| POST   | `/order`   | place a market order (demo-guarded)  |
