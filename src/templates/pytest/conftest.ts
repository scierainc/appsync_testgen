// Version: pytest/conftest v1.2.0
// Returns the content of contexts/conftest.py
export default function getConftestPy(): string {
  return `# Version: pytest/conftest v1.2.0
from __future__ import annotations
import os, sys, json, datetime, shutil, pathlib, re
import pytest

# -------- optional Allure import (gated by env) --------
try:
    import allure  # type: ignore
except Exception:
    allure = None

def _on(v: str) -> bool:
    return (v or "").lower() in ("1","true","yes","on")

def _env(k: str, default: str = "") -> str:
    v = os.getenv(k, default)
    return v if v is not None else default

def _allure_enabled() -> bool:
    return _on(_env("APPSYNC_ALLURE","0")) and (allure is not None)

# Ensure contexts/_shared/pytest is importable for 'from graphql_client import gql_request'
ROOT = pathlib.Path(__file__).parent.resolve()
SHARED = ROOT / "_shared" / "pytest"
if SHARED.exists():
    p = str(SHARED)
    if p not in sys.path:
        sys.path.insert(0, p)

try:
    from graphql_client import _artifact_path  # type: ignore
except Exception:
    def _artifact_path(op: str, scenario: str, file: str) -> pathlib.Path:
        safe = lambda s: "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in s)
        art = pathlib.Path(_env("APPSYNC_ARTIFACT_DIR","artifacts"))
        return art / safe(op) / f"{safe(scenario)}.{file}"

def pytest_sessionstart(session):
    now = datetime.datetime.utcnow().isoformat(timespec="seconds") + "Z"
    banner = [
        "",
        "======== AppSync Test Session ========",
        f"time:     {now} UTC",
        f"endpoint: {_env('APPSYNC_ENDPOINT','(unset)')}",
        f"auth:     {_env('APPSYNC_AUTH_MODE','API_KEY')}",
        f"region:   {_env('AWS_REGION','-')}",
        f"profile:  {_env('AWS_PROFILE','-')}",
        f"artifacts: {_env('APPSYNC_ARTIFACT_DIR','artifacts')} (policy={_env('APPSYNC_WRITE_ARTIFACTS','onfail')})",
        f"allure:   {'on' if _allure_enabled() else 'off'}",
        "======================================",
        ""
    ]
    print("\\n".join(banner))

_EXEC_RESULTS: list[dict] = []
_CATEGORY_WORDS = (
    ("happy", re.compile(r"\\bhappy\\b", re.I)),
    ("validation", re.compile(r"\\b(validation|missing|invalid)\\b", re.I)),
    ("notfound", re.compile(r"\\bnot[\\s_-]*found\\b|\\b404\\b", re.I)),
    ("auth", re.compile(r"\\bauth|forbidden|unauthorized|401|403\\b", re.I)),
)

def _categorize(item: pytest.Item) -> list[str]:
    marks = [k for k in ("happy","validation","notfound","auth") if k in item.keywords]
    if marks:
        return marks
    txt = f"{item.name} {(item._obj.__doc__ or '') if hasattr(item, '_obj') else ''}"
    cats = [name for name, rx in _CATEGORY_WORDS if rx.search(txt)]
    return cats or ["uncategorized"]

def _latest_artifact():
    root = pathlib.Path(_env("APPSYNC_ARTIFACT_DIR","artifacts"))
    if not root.exists():
        return None
    candidates = list(root.rglob("*.last.json"))
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)

@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    rep = outcome.get_result()

    # Record timing/categories for executive view
    if rep.when == "call":
        _EXEC_RESULTS.append({
            "nodeid": rep.nodeid,
            "outcome": rep.outcome,
            "duration": getattr(rep, "duration", 0.0),
            "categories": _categorize(item),
        })

    # Attach latest artifact to Allure for any completed test call
    if rep.when == "call" and _allure_enabled():
        try:
            art = _latest_artifact()
            if art and art.exists():
                data = art.read_bytes()
                # try to parse for nicer naming
                try:
                    parsed = json.loads(data.decode("utf-8", errors="ignore"))
                    op = (parsed.get("meta") or {}).get("operation") or "operation"
                    sc = (parsed.get("meta") or {}).get("scenario") or "scenario"
                    name = f"{op}/{sc} artifact"
                except Exception:
                    name = art.name
                allure.attach(data, name=name, attachment_type=getattr(allure.attachment_type, "JSON", None))
        except Exception:
            # don't break test flow if allure attach fails
            pass

    # On-fail artifact promotion (onfail policy)
    policy = (_env("APPSYNC_WRITE_ARTIFACTS", "onfail") or "onfail").lower()
    if rep.when != "call" or policy != "onfail":
        return
    if rep.failed:
        art = _latest_artifact()
        if art and art.exists():
            out = art.with_suffix(".json")
            try:
                out.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(art, out)
                print(f"[artifacts] saved: {out}")
            except Exception as e:
                print(f"[artifacts] copy failed: {e}")

def pytest_terminal_summary(terminalreporter, exitstatus, config):
    # Category summary
    cat_stats: dict[str, dict[str,int]] = {}
    for rep in terminalreporter.getreports("passed") + \
              terminalreporter.getreports("failed") + \
              terminalreporter.getreports("skipped") + \
              terminalreporter.getreports("xfailed") + \
              terminalreporter.getreports("xpassed"):
        marks = [k for k in ("happy","validation","notfound","auth") if k in rep.keywords]
        if not marks:
            txt = rep.nodeid
            marks = []
            for name, rx in _CATEGORY_WORDS:
                if rx.search(txt):
                    marks.append(name)
            if not marks:
                marks = ["uncategorized"]
        for m in marks:
            s = cat_stats.setdefault(m, {"passed":0,"failed":0,"skipped":0,"xfailed":0,"xpassed":0})
            s[rep.outcome] = s.get(rep.outcome, 0) + 1

    if cat_stats:
        terminalreporter.write_line("\\nSummary by category:")
        for k in sorted(cat_stats.keys()):
            s = cat_stats[k]
            terminalreporter.write_line(
                f"  {k:12s}  passed:{s.get('passed',0):2d}  failed:{s.get('failed',0):2d}  "
                f"skipped:{s.get('skipped',0):2d}  xfailed:{s.get('xfailed',0):2d}"
            )

    # Executive view (markdown) — enable via APPSYNC_EXEC_VIEW=1
    exec_on = _on(_env("APPSYNC_EXEC_VIEW", "0"))
    if not exec_on:
        return

    totals = {"passed":0,"failed":0,"skipped":0}
    for r in _EXEC_RESULTS:
        if r["outcome"] in totals:
            totals[r["outcome"]] += 1

    by_cat: dict[str, dict[str,int]] = {}
    for r in _EXEC_RESULTS:
        for c in r["categories"]:
            s = by_cat.setdefault(c, {"passed":0,"failed":0,"skipped":0})
            if r["outcome"] in s:
                s[r["outcome"]] += 1

    slow = sorted(_EXEC_RESULTS, key=lambda x: x["duration"], reverse=True)[:10]
    failures = terminalreporter.stats.get("failed", []) or []

    md = []
    md.append("# AppSync Tests — Executive Summary\\n")
    md.append(f"- **Endpoint:** {_env('APPSYNC_ENDPOINT','(unset)')}  ")
    md.append(f"- **Auth:** {_env('APPSYNC_AUTH_MODE','API_KEY')}  ")
    md.append(f"- **When:** {datetime.datetime.utcnow().isoformat(timespec='seconds')}Z\\n")
    md.append("## Totals\\n")
    md.append(f"- Passed: **{totals['passed']}**   Failed: **{totals['failed']}**   Skipped: **{totals['skipped']}**\\n")
    md.append("## By Category\\n")
    if by_cat:
        md.append("| Category | Passed | Failed | Skipped |")
        md.append("|---|---:|---:|---:|")
        for c in sorted(by_cat.keys()):
            s = by_cat[c]
            md.append(f"| {c} | {s['passed']} | {s['failed']} | {s['skipped']} |")
        md.append("")
    else:
        md.append("_No category data._\\n")

    if failures:
        md.append("## Failures\\n")
        for rep in failures:
            md.append(f"- {rep.nodeid}")
            try:
                text = str(getattr(rep, "longreprtext", "") or "").splitlines()
                if text:
                    md.append(f"  - {text[0]}")
            except Exception:
                pass
        md.append("")

    if slow:
        md.append("## Slowest tests (top 10)\\n")
        md.append("| Test | Duration (s) |")
        md.append("|---|---:|")
        for r in slow:
            md.append(f"| {r['nodeid']} | {r['duration']:.2f} |")
        md.append("")

    out_name = _env("APPSYNC_EXEC_VIEW_FILE", "executive_report.md")
    out_path = pathlib.Path(config.rootdir).joinpath(out_name).resolve()
    try:
        out_path.write_text("\\n".join(md), encoding="utf-8")
        terminalreporter.write_line(f"\\n[executive] wrote {out_path}")
    except Exception as e:
        terminalreporter.write_line(f"\\n[executive] failed to write report: {e}")
`;
}
