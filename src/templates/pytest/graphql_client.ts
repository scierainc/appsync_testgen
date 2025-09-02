// v1.1 - pytest GraphQL client template
export default function getGraphqlClientPy(): string {
  return `from __future__ import annotations
import json, os, time, pathlib
import requests
from typing import Any, Dict, Optional

APPSYNC_ENDPOINT = os.getenv("APPSYNC_ENDPOINT", "").strip()
AUTH_MODE       = (os.getenv("APPSYNC_AUTH_MODE", "API_KEY") or "API_KEY").upper()
AWS_REGION      = os.getenv("AWS_REGION", "").strip()
AWS_PROFILE     = os.getenv("AWS_PROFILE", "").strip()
API_KEY         = os.getenv("APPSYNC_API_KEY", "").strip()
COGNITO_JWT     = os.getenv("APPSYNC_JWT", "").strip()

ARTIFACT_POLICY = (os.getenv("APPSYNC_WRITE_ARTIFACTS", "onfail") or "onfail").lower()  # onfail|all|off
ARTIFACT_DIR    = os.getenv("APPSYNC_ARTIFACT_DIR", "artifacts").strip()
MASK_SECRETS    = os.getenv("APPSYNC_MASK_SECRETS", "1") not in ("0", "false", "False")

SESSION = requests.Session()
TIMEOUT = float(os.getenv("APPSYNC_TIMEOUT_SECONDS", "60"))

def _mask(s: Optional[str]) -> Optional[str]:
    if not MASK_SECRETS or not s:
        return s
    if len(s) <= 12:
        return "***"
    return s[:4] + "…" + s[-4:]

def _headers() -> Dict[str, str]:
    h = {"content-type": "application/json"}
    if AUTH_MODE == "API_KEY":
        if not API_KEY:
            raise RuntimeError("APPSYNC_API_KEY is required for AUTH_MODE=API_KEY")
        h["x-api-key"] = API_KEY
    elif AUTH_MODE == "COGNITO":
        if not COGNITO_JWT:
            raise RuntimeError("APPSYNC_JWT is required for AUTH_MODE=COGNITO")
        h["authorization"] = COGNITO_JWT
    elif AUTH_MODE == "IAM":
        raise RuntimeError("AUTH_MODE=IAM not supported in pytest helper (use Jest/Node for IAM or enable botocore signer).")
    else:
        raise RuntimeError(f"Unknown APPSYNC_AUTH_MODE: {AUTH_MODE}")
    return h

def _artifact_path(op: str, scenario: str, file: str) -> pathlib.Path:
    safe = lambda s: "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in s)
    return pathlib.Path(ARTIFACT_DIR) / safe(op) / f"{safe(scenario)}.{file}"

def _ensure_dir(p: pathlib.Path) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)

def gql_request(query: str,
                variables: Optional[Dict[str, Any]] = None,
                *,
                op: str = "operation",
                scenario: str = "scenario") -> Dict[str, Any]:
    if not APPSYNC_ENDPOINT:
        raise RuntimeError("APPSYNC_ENDPOINT is not set")

    body = {"query": query, "variables": variables or {}}
    headers = _headers()

    t0 = time.time()
    resp = SESSION.post(APPSYNC_ENDPOINT, json=body, headers=headers, timeout=TIMEOUT)
    dt = int((time.time() - t0) * 1000)

    try:
        payload = resp.json()
    except Exception:
        payload = {"_non_json_response": resp.text}

    masked_headers = {k: (_mask(v) if k.lower() in ("x-api-key", "authorization") else v) for k, v in headers.items()}
    artifact = {
        "meta": {
            "operation": op,
            "scenario": scenario,
            "authMode": AUTH_MODE,
            "endpoint": APPSYNC_ENDPOINT,
            "region": AWS_REGION or None,
            "profile": AWS_PROFILE or None,
            "timingsMs": {"http": dt},
            "status_code": resp.status_code,
        },
        "request": {"query": query, "variables": variables or {}, "headers": masked_headers},
        "response": payload,
    }

    tmp = _artifact_path(op, scenario, "last.json")
    _ensure_dir(tmp)
    tmp.write_text(json.dumps(artifact, indent=2), encoding="utf-8")

    if ARTIFACT_POLICY == "all":
        out = _artifact_path(op, scenario, "json")
        _ensure_dir(out)
        out.write_text(json.dumps(artifact, indent=2), encoding="utf-8")

    return payload
`;
}
