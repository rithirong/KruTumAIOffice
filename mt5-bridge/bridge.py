"""
MT5 Bridge — a tiny local HTTP service that lets the (TypeScript/Convex)
gemification app talk to a running MetaTrader 5 terminal.

Safety model:
  • Demo-only by default. It refuses to trade on a LIVE account unless
    ALLOW_LIVE=true is explicitly set.
  • Volume is capped by MAX_LOT.
  • A shared BRIDGE_TOKEN must match the `X-Bridge-Token` header (if set).
  • Runs in "degraded mode" if the MetaTrader5 package or terminal is absent —
    /health still answers so you can wire and test everything before MT5 exists.

Run:
  pip install -r requirements.txt
  # set env (see README.md), then:
  uvicorn bridge:app --host 127.0.0.1 --port 8000
"""

import os
from typing import Optional

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

# ── config from environment ──
BRIDGE_TOKEN = os.environ.get("BRIDGE_TOKEN", "")
SYMBOL = os.environ.get("MT5_SYMBOL", "XAUUSD")
ALLOW_LIVE = os.environ.get("ALLOW_LIVE", "false").lower() == "true"
MAX_LOT = float(os.environ.get("MAX_LOT", "0.10"))
LOGIN = os.environ.get("MT5_LOGIN")
PASSWORD = os.environ.get("MT5_PASSWORD")
SERVER = os.environ.get("MT5_SERVER")
MT5_PATH = os.environ.get("MT5_PATH")  # optional path to terminal64.exe

# MetaTrader5 is Windows-only and needs the terminal installed. Import lazily so
# the bridge still boots (degraded) without it.
try:
    import MetaTrader5 as mt5  # type: ignore

    HAS_MT5 = True
    MT5_IMPORT_ERR = ""
except Exception as e:  # pragma: no cover
    mt5 = None  # type: ignore
    HAS_MT5 = False
    MT5_IMPORT_ERR = str(e)

app = FastAPI(title="MT5 Bridge", version="1.0")


def ensure_auth(token: str) -> None:
    if BRIDGE_TOKEN and token != BRIDGE_TOKEN:
        raise HTTPException(status_code=401, detail="bad bridge token")


def mt5_init() -> None:
    if not HAS_MT5:
        raise HTTPException(
            status_code=503,
            detail=f"MetaTrader5 package unavailable: {MT5_IMPORT_ERR}",
        )
    kwargs = {}
    if MT5_PATH:
        kwargs["path"] = MT5_PATH
    if LOGIN and PASSWORD and SERVER:
        ok = mt5.initialize(login=int(LOGIN), password=PASSWORD, server=SERVER, **kwargs)
    else:
        ok = mt5.initialize(**kwargs)
    if not ok:
        raise HTTPException(status_code=503, detail=f"mt5.initialize failed: {mt5.last_error()}")


@app.get("/health")
def health():
    info = {
        "bridge": "ok",
        "has_mt5_package": HAS_MT5,
        "symbol": SYMBOL,
        "allow_live": ALLOW_LIVE,
        "mt5_connected": False,
    }
    if not HAS_MT5:
        info["error"] = MT5_IMPORT_ERR
        return info
    try:
        mt5_init()
        acc = mt5.account_info()
        info["mt5_connected"] = acc is not None
        if acc is not None:
            info["is_demo"] = acc.trade_mode == 0  # 0=demo,1=contest,2=real
            info["account"] = {
                "login": acc.login,
                "server": acc.server,
                "balance": acc.balance,
                "equity": acc.equity,
                "currency": acc.currency,
            }
    except HTTPException as e:
        info["error"] = e.detail
    return info


@app.get("/price")
def price(x_bridge_token: str = Header(default="")):
    ensure_auth(x_bridge_token)
    mt5_init()
    if not mt5.symbol_select(SYMBOL, True):
        raise HTTPException(status_code=404, detail=f"symbol {SYMBOL} not found")
    t = mt5.symbol_info_tick(SYMBOL)
    return {"symbol": SYMBOL, "bid": t.bid, "ask": t.ask, "last": t.last, "time": t.time}


@app.get("/account")
def account(x_bridge_token: str = Header(default="")):
    ensure_auth(x_bridge_token)
    mt5_init()
    acc = mt5.account_info()
    if acc is None:
        raise HTTPException(status_code=503, detail="no account (is the terminal logged in?)")
    return acc._asdict()


class OrderReq(BaseModel):
    side: str  # "BUY" | "SELL"
    volume: float  # lots
    sl: Optional[float] = None
    tp: Optional[float] = None


@app.post("/order")
def order(req: OrderReq, x_bridge_token: str = Header(default="")):
    ensure_auth(x_bridge_token)
    mt5_init()

    acc = mt5.account_info()
    if acc is None:
        raise HTTPException(status_code=503, detail="no account")
    is_demo = acc.trade_mode == 0
    if not is_demo and not ALLOW_LIVE:
        raise HTTPException(
            status_code=403,
            detail="refusing to trade on a LIVE account (set ALLOW_LIVE=true to override)",
        )

    vol = min(abs(req.volume), MAX_LOT)
    if vol <= 0:
        raise HTTPException(status_code=400, detail="volume must be > 0")

    mt5.symbol_select(SYMBOL, True)
    tick = mt5.symbol_info_tick(SYMBOL)
    side = req.side.upper()
    if side not in ("BUY", "SELL"):
        raise HTTPException(status_code=400, detail="side must be BUY or SELL")
    order_type = mt5.ORDER_TYPE_BUY if side == "BUY" else mt5.ORDER_TYPE_SELL
    fill_price = tick.ask if side == "BUY" else tick.bid

    request = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": SYMBOL,
        "volume": float(vol),
        "type": order_type,
        "price": fill_price,
        "deviation": 20,
        "magic": 770077,
        "comment": "gemification-tariq",
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": mt5.ORDER_FILLING_IOC,
    }
    if req.sl:
        request["sl"] = float(req.sl)
    if req.tp:
        request["tp"] = float(req.tp)

    result = mt5.order_send(request)
    if result is None:
        raise HTTPException(status_code=400, detail=f"order_send returned None: {mt5.last_error()}")
    if result.retcode != mt5.TRADE_RETCODE_DONE:
        raise HTTPException(
            status_code=400,
            detail=f"order rejected: retcode={result.retcode} {result.comment}",
        )
    return {"ok": True, "demo": is_demo, "result": result._asdict()}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PORT", "8000")))
