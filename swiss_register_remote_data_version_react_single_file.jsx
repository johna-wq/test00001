import React, { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Search, Loader2, AlertCircle, Database } from "lucide-react";

/**
 * Remote-data Swiss Register (single-file preview)
 *
 * HOW TO USE
 * 1) Host your dataset (JSON or JSONL). Recommend gzipped JSON for large files.
 * 2) Make it publicly fetchable (GitHub Raw, Cloudflare R2, GCS, etc.).
 * 3) Set DATA_URL below to your file's direct URL.
 *    - If you use GitHub, click the file then "Raw" and copy that URL.
 * 4) If your file is gzipped, set IS_GZIPPED = true (and keep content-type generic OK).
 * 5) Commit this file and the dataset link to GitHub. The ChatGPT preview will fetch it at runtime.
 *
 * DATA FORMAT
 * - JSON array of objects  OR  JSON Lines (JSONL), one object per line.
 * - Each object should at least have: { id, name, city, type, ... }
 */

// ▼▼ Replace this with your hosted dataset URL (e.g., GitHub Raw URL) ▼▼
const DATA_URL = "https://raw.githubusercontent.com/johna-wq/test00001/refs/heads/main/companies_full.jsonl"; // ← Replace with your link
const IS_GZIPPED = false; // set to true if your file is .gz
const IS_JSONL = false;   // set to true if your file is JSON Lines

// --- Types ---
/** @typedef {{ id: string|number, name: string, city?: string, type?: string, address?: string, [k: string]: any }} Company */

// --- Utility: streaming fetch with optional gzip + JSON/JSONL parsing ---
async function fetchTextMaybeGzip(url, { gz = false } = {}) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  if (gz && "DecompressionStream" in window) {
    const ds = new DecompressionStream("gzip");
    const decompressed = res.body.pipeThrough(ds);
    return await new Response(decompressed).text();
  }
  // If server sends already decompressed text (or no DS support), fallback to text()
  return await res.text();
}

async function loadCompaniesFromURL(url, { gz = false, jsonl = false } = {}) {
  const text = await fetchTextMaybeGzip(url, { gz });
  if (jsonl) {
    const lines = text.split(/\r?\n/).filter(Boolean);
    return lines.map((ln, i) => {
      try { return JSON.parse(ln); } catch { return { id: `line-${i}`, name: ln }; }
    });
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    // Last-resort: attempt to parse as "CSV-like" name-only list
    const fallback = text.split(/\r?\n/).filter(Boolean).map((name, i) => ({ id: i+1, name }));
    return fallback;
  }
}

// --- Simple in-memory index (token → docIds) for fast filtering ---
function buildIndex(rows /** @type {Company[]} */) {
  const idx = new Map(); // token -> Set(docIndex)
  const fields = ["name", "city", "type"]; // extend as needed
  rows.forEach((row, i) => {
    fields.forEach((f) => {
      const v = (row?.[f] ?? "").toString().toLowerCase();
      v.split(/[^\p{L}\p{N}]+/u).filter(Boolean).forEach((tok) => {
        if (!idx.has(tok)) idx.set(tok, new Set());
        idx.get(tok).add(i);
      });
    });
  });
  return idx;
}

function queryIndex(query, rows, idx) {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  const toks = q.split(/\s+/);
  let current = null;
  for (const t of toks) {
    const set = idx.get(t);
    if (!set) return [];
    current = current ? new Set([...current].filter((x) => set.has(x))) : new Set(set);
    if (!current.size) return [];
  }
  return [...current].slice(0, 1000).map((i) => rows[i]); // cap to keep UI snappy
}

// --- UI Components ---
function Stat({ label, value }) {
  return (
    <div className="p-4 rounded-2xl shadow-sm border bg-white flex items-center gap-3">
      <Database className="w-5 h-5" />
      <div>
        <div className="text-xs text-gray-500">{label}</div>
        <div className="text-lg font-semibold">{value}</div>
      </div>
    </div>
  );
}

function CompanyCard({ c /** @type {Company} */ }) {
  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="p-4 rounded-2xl shadow-sm border bg-white">
      <div className="text-base font-semibold">{c.name}</div>
      <div className="text-sm text-gray-600">{c.city || "—"}{c.type ? ` • ${c.type}` : ""}</div>
      {c.address && <div className="text-sm text-gray-500 mt-1">{c.address}</div>}
    </motion.div>
  );
}

export default function App() {
  const [raw, setRaw] = useState(/** @type {Company[]} */([]));
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Load remote dataset on mount
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const data = await loadCompaniesFromURL(DATA_URL, { gz: IS_GZIPPED, jsonl: IS_JSONL });
        if (!alive) return;
        // normalize minimal fields
        const norm = data.map((d, i) => ({
          id: d.id ?? i + 1,
          name: d.name ?? d.companyName ?? d.title ?? `Company ${i+1}`,
          city: d.city ?? d.location ?? d.town ?? "",
          type: d.type ?? d.category ?? d.industry ?? "",
          address: d.address ?? d.addr ?? "",
          ...d,
        }));
        setRaw(norm);
        setError(null);
      } catch (e) {
        console.error(e);
        setError(e?.message ?? String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Build index memoized
  const index = useMemo(() => buildIndex(raw), [raw]);
  const results = useMemo(() => queryIndex(query, raw, index), [query, raw, index]);

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Swiss Register – Remote Data</h1>
          <div className="flex gap-3">
            <Stat label="Loaded" value={raw.length} />
            <Stat label="Matches" value={results.length} />
          </div>
        </header>

        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3 border rounded-xl px-3 py-2">
            <Search className="w-5 h-5 text-gray-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search company, city, type..."
              className="w-full outline-none text-base py-1"
            />
          </div>

          {loading && (
            <div className="flex items-center gap-2 text-gray-600 mt-3">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Loading dataset from remote URL…</span>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-red-600 mt-3">
              <AlertCircle className="w-4 h-4" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <main className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((c) => (
            <CompanyCard key={c.id} c={c} />
          ))}
        </main>

        {!loading && !error && results.length === 0 && (
          <div className="text-sm text-gray-600">No matches. Try another query.</div>
        )}

        <footer className="text-xs text-gray-500 mt-6">
          <p>
            Data is fetched at runtime from <code>DATA_URL</code>. Supports JSON array or JSONL; optional gzip via
            <code> DecompressionStream </code>. For huge corpora, consider hosting gzipped JSONL and enabling <code>IS_GZIPPED</code> & <code>IS_JSONL</code>.
          </p>
        </footer>
      </div>
    </div>
  );
}
