# IoT Bridge (แม่บ้านนวล's skill)

Lets แม่บ้านนวล read/control real smart-home devices from **SmartLife/Tuya** and
**Xiaomi Home/Mi** ecosystems. Same pattern as the MT5 bridge: a small local
FastAPI service that the Convex app calls.

## Why a bridge (and two ecosystems)

Neither SmartLife nor Xiaomi has a JS SDK, and they use different protocols:
- **SmartLife = Tuya** → `tinytuya` Cloud API (needs a Tuya IoT developer account).
- **Xiaomi Home = Mi** → `python-miio` (local control by device IP + token).

> **Easiest unified alternative:** run **Home Assistant** (it has official Tuya/
> SmartLife *and* Xiaomi Miot integrations) and point this bridge at HA's REST API
> instead. If you already run HA, that's less setup than per-device tokens.

## Safety / behaviour

- `BRIDGE_TOKEN` (header `X-Bridge-Token`) auth.
- Boots in **degraded mode** if `tinytuya` / `python-miio` / creds are missing —
  `/health` still answers so the app can show status before setup is complete.

## Setup

```powershell
cd C:\Users\Rithirong\gemification\iot-bridge
py -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### Get device credentials
- **Tuya/SmartLife:** create a project at https://iot.tuya.com, link your SmartLife
  app account, and note `TUYA_API_REGION`, `TUYA_API_KEY`, `TUYA_API_SECRET`, and
  each device's `device_id`. (`python -m tinytuya wizard` helps discover them.)
- **Xiaomi/Mi:** get each device's local **IP** and 32-hex **token** (e.g. via the
  `Xiaomi-cloud-tokens-extractor` tool or `miiocli cloud`).

### Configure (env)

```powershell
$env:BRIDGE_TOKEN     = "pick-a-long-random-string"
$env:TUYA_API_REGION  = "us"     # us | eu | cn | in
$env:TUYA_API_KEY     = "..."
$env:TUYA_API_SECRET  = "..."
$env:IOT_DEVICES = '[
  {"name":"ไฟห้องประชุม","platform":"tuya","device_id":"abc123","switch_code":"switch_1"},
  {"name":"แอร์ห้องเทรด","platform":"xiaomi","ip":"192.168.1.50","token":"<32hex>"}
]'
```

### Run

```powershell
uvicorn bridge:app --host 127.0.0.1 --port 8100
```

Check: http://127.0.0.1:8100/health

## Tell Convex about the bridge

```powershell
cd C:\Users\Rithirong\gemification
$env:CONVEX_AGENT_MODE="anonymous"
npx convex env set IOT_BRIDGE_URL   http://127.0.0.1:8100
npx convex env set IOT_BRIDGE_TOKEN pick-a-long-random-string
```

Without these, แม่บ้านนวล stays in simulated role-play mode.

## Endpoints

| Method | Path       | Purpose                          |
|--------|------------|----------------------------------|
| GET    | `/health`  | bridge + libs + device list      |
| GET    | `/devices` | configured devices               |
| POST   | `/control` | `{name, on}` turn a device on/off |

> Note: device on/off commands vary by model. The generic implementations cover
> common switches; some Xiaomi models need a specific `python-miio` device class.
