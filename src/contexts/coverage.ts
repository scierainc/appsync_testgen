// src/contexts/coverage.ts

// Best-effort filler for <String>, <Int> style skeletons.
// Produces deterministic-ish values based on a seed.
export function buildHappyVariables(skel: any, seed = "001"): any {
  return deepMap(skel, (k, v) => {
    if (typeof v === "string") {
      const m = v.match(/^<\s*([A-Za-z]+)\s*>$/);
      if (m) {
        const t = m[1].toLowerCase();
        if (t === "string") return pickStringForKey(k, seed);
        if (t === "int") return 1;
        if (t === "float" || t === "number") return 1.0;
        if (t === "boolean") return true;
        if (t === "id") return `${keyBase(k)}-${seed}`;
        return `${keyBase(k)}-${seed}`;
      }
      return v;
    }
    return v;
  });
}

export function makeMissingField(vars: any): { vars: any; removedPath?: string[] } {
  const path = pickFirstStringPath(vars);
  if (!path) return { vars };
  const cloned = structuredClone(vars);
  unsetAtPath(cloned, path);
  return { vars: cloned, removedPath: path };
}

export function makeInvalidEmptyString(vars: any): { vars: any; mutatedPath?: string[] } {
  const path = pickFirstStringPath(vars);
  if (!path) return { vars };
  const cloned = structuredClone(vars);
  setAtPath(cloned, path, "");
  return { vars: cloned, mutatedPath: path };
}

export function makeNotFound(vars: any): { vars: any; mutatedPath?: string[] } {
  // try to rewrite id-ish keys to a nonexistent value
  const path = pickFirstIdLikePath(vars);
  if (!path) return { vars };
  const cloned = structuredClone(vars);
  setAtPath(cloned, path, `nonexistent-${Date.now()}`);
  return { vars: cloned, mutatedPath: path };
}

/* ----------------- helpers ----------------- */

function deepMap(obj: any, fn: (k: string, v: any) => any): any {
  if (Array.isArray(obj)) return obj.map((v, i) => deepMap(v, fn));
  if (obj && typeof obj === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === "object") out[k] = deepMap(v, fn);
      else out[k] = fn(k, v);
    }
    return out;
  }
  return obj;
}

function keyBase(k: string): string {
  const s = k.toLowerCase();
  if (s.includes("id")) return "id";
  if (s.includes("name")) return "name";
  if (s.includes("date")) return "2023-10-01";
  return s.replace(/[^a-z0-9]+/g, "") || "val";
}

function pickStringForKey(k: string, seed: string): string {
  const s = k.toLowerCase();
  if (s.includes("id")) return `${keyBase(k)}-${seed}`;
  if (s.includes("name")) return `name-${seed}`;
  if (s.includes("date")) return `2023-10-01T00:00:00Z`;
  if (s.includes("status")) return `ACTIVE`;
  return `${keyBase(k)}-${seed}`;
}

function pickFirstStringPath(o: any, path: string[] = []): string[] | undefined {
  if (!o || typeof o !== "object") return;
  for (const [k, v] of Object.entries(o)) {
    const p = [...path, k];
    if (typeof v === "string") return p;
    if (v && typeof v === "object") {
      const inner = pickFirstStringPath(v, p);
      if (inner) return inner;
    }
  }
}

function pickFirstIdLikePath(o: any, path: string[] = []): string[] | undefined {
  if (!o || typeof o !== "object") return;
  for (const [k, v] of Object.entries(o)) {
    const p = [...path, k];
    if (typeof v === "string" && /(^|[_-])id(s)?$/i.test(k)) return p;
    if (v && typeof v === "object") {
      const inner = pickFirstIdLikePath(v, p);
      if (inner) return inner;
    }
  }
}

function unsetAtPath(obj: any, path: string[]) {
  if (!path.length) return;
  const last = path[path.length - 1];
  const parent = getAtPath(obj, path.slice(0, -1));
  if (parent && typeof parent === "object") delete parent[last as any];
}

function setAtPath(obj: any, path: string[], value: any) {
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i];
    if (!cur[k] || typeof cur[k] !== "object") cur[k] = {};
    cur = cur[k];
  }
  cur[path[path.length - 1]] = value;
}

function getAtPath(obj: any, path: string[]) {
  return path.reduce((acc, k) => (acc ? (acc as any)[k] : undefined), obj);
}
