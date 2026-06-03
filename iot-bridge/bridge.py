"""
IoT Bridge — lets the gemification app (แม่บ้านนวล) read and control real smart-home
devices from two ecosystems:
  • SmartLife / Tuya   → via the `tinytuya` Cloud API
  • Xiaomi Home / Mi    → via `python-miio` (local IP + token)

Safety / design (mirrors the MT5 bridge):
  • Token auth: requests must send `X-Bridge-Token` matching BRIDGE_TOKEN (if set).
  • Degraded mode: boots even if tinytuya/miio or credentials are missing — /health
    still answers so you can wire and test before the real setup exists.
  • Read-only by default for discovery; /control actuates a device (on/off).

Devices are declared in the IOT_DEVICES env var as a JSON array, e.g.:
[
  {"name":"ไฟห้องประชุม","platform":"tuya","device_id":"abc123","switch_code":"switch_1"},
  {"name":"แอร์ห้องเทรด","platform":"xiaomi","ip":"192.168.1.50","token":"<32-hex>"}
]
Tuya cloud creds: TUYA_API_REGION (us/eu/cn/in), TUYA_API_KEY, TUYA_API_SECRET.

Run:
  pip install -r requirements.txt
  uvicorn bridge:app --host 127.0.0.1 --port 8100
"""

import json
import os
from typing import Optional

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

BRIDGE_TOKEN = os.environ.get("BRIDGE_TOKEN", "")
DEVICES = json.loads(os.environ.get("IOT_DEVICES", "[]"))

# Tuya cloud
TUYA_REGION = os.environ.get("TUYA_API_REGION", "us")
TUYA_KEY = os.environ.get("TUYA_API_KEY", "")
TUYA_SECRET = os.environ.get("TUYA_API_SECRET", "")

try:
    import tinytuya  # type: ignore

    HAS_TUYA = True
except Exception as e:  # pragma: no cover
    tinytuya = None  # type: ignore
    HAS_TUYA = False
    TUYA_ERR = str(e)

try:
    import miio  # type: ignore

    HAS_MIIO = True
except Exception as e:  # pragma: no cover
    miio = None  # type: ignore
    HAS_MIIO = False
    MIIO_ERR = str(e)

app = FastAPI(title="IoT Bridge", version="1.0")


def ensure_auth(token: str) -> None:
    if BRIDGE_TOKEN and token != BRIDGE_TOKEN:
        raise HTTPException(status_code=401, detail="bad bridge token")


def find_device(name: str) -> dict:
    for d in DEVICES:
        if d.get("name") == name:
            return d
    raise HTTPException(status_code=404, detail=f"unknown device: {name}")


def tuya_cloud():
    if not HAS_TUYA:
        raise HTTPException(status_code=503, detail=f"tinytuya unavailable: {TUYA_ERR}")
    if not (TUYA_KEY and TUYA_SECRET):
        raise HTTPException(status_code=503, detail="Tuya cloud creds not set")
    return tinytuya.Cloud(apiRegion=TUYA_REGION, apiKey=TUYA_KEY, apiSecret=TUYA_SECRET)


def control_tuya(dev: dict, on: bool) -> dict:
    c = tuya_cloud()
    code = dev.get("switch_code", "switch_1")
    res = c.sendcommand(dev["device_id"], {"commands": [{"code": code, "value": on}]})
    return {"platform": "tuya", "result": res}


def control_xiaomi(dev: dict, on: bool) -> dict:
    if not HAS_MIIO:
        raise HTTPException(status_code=503, detail=f"python-miio unavailable: {MIIO_ERR}")
    device = miio.Device(dev["ip"], dev["token"])
    # Generic best-effort; specific models may need a dedicated class/command.
    res = device.send("set_power", ["on" if on else "off"])
    return {"platform": "xiaomi", "result": res}


@app.get("/health")
def health():
    return {
        "bridge": "ok",
        "has_tuya": HAS_TUYA,
        "has_miio": HAS_MIIO,
        "tuya_creds": bool(TUYA_KEY and TUYA_SECRET),
        "device_count": len(DEVICES),
        "devices": [{"name": d.get("name"), "platform": d.get("platform")} for d in DEVICES],
    }


@app.get("/devices")
def devices(x_bridge_token: str = Header(default="")):
    ensure_auth(x_bridge_token)
    return {"devices": [{"name": d.get("name"), "platform": d.get("platform")} for d in DEVICES]}


class ControlReq(BaseModel):
    name: str
    on: bool


@app.post("/control")
def control(req: ControlReq, x_bridge_token: str = Header(default="")):
    ensure_auth(x_bridge_token)
    dev = find_device(req.name)
    platform = dev.get("platform")
    if platform == "tuya":
        out = control_tuya(dev, req.on)
    elif platform == "xiaomi":
        out = control_xiaomi(dev, req.on)
    else:
        raise HTTPException(status_code=400, detail=f"unsupported platform: {platform}")
    return {"ok": True, "name": req.name, "on": req.on, **out}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PORT", "8100")))
