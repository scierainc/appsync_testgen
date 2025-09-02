// v1.0.1 — top-level pytest shim (no literal backticks)
export default function getTopLevelConftestPy(): string {
  return `from __future__ import annotations
import sys, pathlib

# testsRoot/conftest.py — ensure testsRoot/_shared/pytest is on sys.path
ROOT = pathlib.Path(__file__).parent.resolve()
SHARED = ROOT / "_shared" / "pytest"
if SHARED.exists():
    p = str(SHARED)
    if p not in sys.path:
        sys.path.insert(0, p)

# Import shared hooks (session banner, on-fail artifacts, executive view, etc.)
# The module lives at testsRoot/_shared/pytest/conftest_shared.py
try:
    import conftest_shared  # noqa: F401
except Exception as e:
    print("[conftest] warning: failed to import shared hooks:", e)
`;
}
