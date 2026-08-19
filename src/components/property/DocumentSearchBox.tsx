"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-client";

interface Hit {
  documentId: string;
  documentTitle: string;
  chunkId: string;
  pageNumber: number | null;
  snippet: string;
}

/** Real Postgres full-text search over extracted document text (spec §15). */
export function DocumentSearchBox({ propertyId }: { propertyId: string }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Hit[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function search(e: FormEvent) {
    e.preventDefault();
    if (q.trim().length < 2) return;
    setLoading(true);
    try {
      const body = await apiFetch<{ results: Hit[] }>(`/api/documents/search?propertyId=${propertyId}&q=${encodeURIComponent(q)}`);
      setResults(body.results ?? []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mb-3">
      <form onSubmit={search} className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search document text (e.g. 'roof warranty', 'compressor')..."
          className="flex-1 rounded-lg border border-border px-3 py-1.5 text-sm outline-none focus:border-brand"
        />
        <button type="submit" className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white" disabled={loading}>
          {loading ? "Searching..." : "Search"}
        </button>
      </form>
      {results ? (
        results.length === 0 ? (
          <p className="mt-2 text-xs text-muted">No matches in indexed document text.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {results.map((r) => (
              <li key={r.chunkId} className="rounded-lg border border-border p-2 text-xs">
                <Link href={`/documents/${r.documentId}`} className="font-medium text-brand hover:underline">
                  {r.documentTitle}
                  {r.pageNumber ? ` (p. ${r.pageNumber})` : ""}
                </Link>
                <p className="mt-1 text-muted">{r.snippet}</p>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
