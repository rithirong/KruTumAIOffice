"""
Sandbox Bridge — runs Devon's (LLM-written) code inside a locked-down Docker
container, so the "developer" agent actually executes & tests code instead of just
describing it. Mirrors the MT5/IoT bridges: a small local FastAPI service the
Convex app calls.

Security (the whole point — never run model code on the host):
  • Runs in `python:3.12-slim` with `--network none` (no internet),
    `--memory 256m`, `--cpus 1`, `--pids-limit 128`, `--rm`.
  • Code is piped via stdin (`python -`) — nothing is written to the host.
  • Hard wall-clock timeout; the container is killed if it overruns.
  • `BRIDGE_TOKEN` header auth. Degraded mode if Docker isn't running.

Run:
  pip install -r requirements.txt
  uvicorn bridge:app --host 127.0.0.1 --port 8200
(Requires Docker Desktop running.)
"""

import os
import subprocess
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

BRIDGE_TOKEN = os.environ.get("BRIDGE_TOKEN", "")
IMAGE = os.environ.get("SANDBOX_IMAGE", "python:3.12-slim")
TIMEOUT = int(os.environ.get("SANDBOX_TIMEOUT", "15"))

app = FastAPI(title="Sandbox Bridge", version="1.0")


def ensure_auth(token: str) -> None:
    if BRIDGE_TOKEN and token != BRIDGE_TOKEN:
        raise HTTPException(status_code=401, detail="bad bridge token")


def docker_ok() -> tuple[bool, str]:
    # `docker info` can be slow right after Docker Desktop wakes up — give it room.
    try:
        r = subprocess.run(["docker", "version", "-f", "{{.Server.Version}}"], capture_output=True, text=True, timeout=25)
        return (r.returncode == 0, "" if r.returncode == 0 else r.stderr.strip()[:200])
    except Exception as e:
        return (False, str(e))


@app.get("/health")
def health():
    ok, err = docker_ok()
    info = {"bridge": "ok", "docker_running": ok, "image": IMAGE, "timeout": TIMEOUT}
    if not ok:
        info["error"] = err or "docker daemon not reachable (start Docker Desktop)"
    return info


class RunReq(BaseModel):
    code: str
    language: str = "python"  # only python for now


@app.post("/run")
def run(req: RunReq, x_bridge_token: str = Header(default="")):
    ensure_auth(x_bridge_token)
    if req.language != "python":
        raise HTTPException(status_code=400, detail="only python is supported")
    ok, err = docker_ok()
    if not ok:
        raise HTTPException(status_code=503, detail=f"docker unavailable: {err}")

    cmd = [
        "docker", "run", "--rm", "-i",
        "--network", "none",
        "--memory", "256m",
        "--cpus", "1",
        "--pids-limit", "128",
        IMAGE,
        "python", "-",
    ]
    try:
        proc = subprocess.run(
            cmd, input=req.code, capture_output=True, text=True, timeout=TIMEOUT + 10
        )
        return {
            "ok": proc.returncode == 0,
            "exit_code": proc.returncode,
            "stdout": proc.stdout[-8000:],
            "stderr": proc.stderr[-4000:],
            "timed_out": False,
        }
    except subprocess.TimeoutExpired:
        return {
            "ok": False,
            "exit_code": -1,
            "stdout": "",
            "stderr": f"timed out after {TIMEOUT}s",
            "timed_out": True,
        }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PORT", "8200")))
