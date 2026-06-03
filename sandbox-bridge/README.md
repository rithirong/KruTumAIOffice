# Sandbox Bridge (Devon's real code execution)

Lets Devon (the developer agent) **write and actually run** Python in an isolated
Docker container, then report the real output — instead of only describing the work.

## Safety

Model-written code never touches your host:
- `python:3.12-slim`, `--network none`, `--memory 256m`, `--cpus 1`,
  `--pids-limit 128`, `--rm`.
- Code is piped over stdin (`python -`) — nothing written to the host filesystem.
- Wall-clock `SANDBOX_TIMEOUT` (default 15s); the container is killed on overrun.
- `BRIDGE_TOKEN` header auth. Degraded mode if Docker isn't running.

## Setup

1. Install & start **Docker Desktop**, then pull the image once:
   ```powershell
   docker pull python:3.12-slim
   ```
2. ```powershell
   cd C:\Users\Rithirong\gemification\sandbox-bridge
   py -m venv .venv; .\.venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   $env:BRIDGE_TOKEN = "pick-a-long-random-string"
   uvicorn bridge:app --host 127.0.0.1 --port 8200
   ```
3. Check: http://127.0.0.1:8200/health → `docker_running: true`.

## Tell Convex about the bridge

```powershell
cd C:\Users\Rithirong\gemification
$env:CONVEX_AGENT_MODE="anonymous"
npx convex env set SANDBOX_BRIDGE_URL   http://127.0.0.1:8200
npx convex env set SANDBOX_BRIDGE_TOKEN pick-a-long-random-string
```

When set, Devon writes a self-contained Python solution for each task, runs it in
the sandbox, and the task is marked **done** only if it exits 0 (else **failed**).
Without it, Devon falls back to an AI-written description (no execution).

> Local only — like the MT5/IoT bridges, a cloud (Vercel) deployment can't reach
> `127.0.0.1`, so real execution works when you run the app locally.

## Endpoints

| Method | Path      | Purpose                                   |
|--------|-----------|-------------------------------------------|
| GET    | `/health` | bridge + docker status                    |
| POST   | `/run`    | `{code, language:"python"}` → run, get output |
