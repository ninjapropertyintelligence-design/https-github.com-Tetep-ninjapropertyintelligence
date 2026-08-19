"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { apiFetch } from "@/lib/api-client";

interface AskAiResponse {
  answer: string;
  sourceRefs: SourceRef[];
  configured: boolean;
}

interface SourceRef {
  type: string;
  id: string;
}

const REF_HREF: Record<string, (id: string) => string> = {
  Property: (id) => `/properties/${id}`,
  Asset: (id) => `/assets/${id}`,
  Issue: (id) => `/issues/${id}`,
  Document: (id) => `/documents/${id}`,
  Assessment: (id) => `/assessments/${id}`,
  Evidence: (id) => `/evidence/${id}`,
};

/** Embeds "Ask Property AI" inline on a dashboard (spec §25). Optionally
 * scoped to a specific property when rendered from a Property page. */
export function AskAiInline({
  placeholder,
  propertyId,
  propertyName,
}: {
  placeholder: string;
  propertyId?: string;
  propertyName?: string;
}) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [refs, setRefs] = useState<SourceRef[]>([]);
  const [configured, setConfigured] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function ask(e: FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    setLoading(true);
    setError(null);
    setAnswer(null);
    try {
      const data = await apiFetch<AskAiResponse>("/api/v1/ai/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, propertyId, propertyName }),
      });
      setAnswer(data.answer);
      setRefs(data.sourceRefs ?? []);
      setConfigured(data.configured);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader title={propertyId ? `Ask AI about ${propertyName ?? "this property"}` : "Ask Property AI"} subtitle="Answers are computed from your data, not invented" />
      <CardBody>
        <form onSubmit={ask} className="flex gap-2">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={placeholder}
            className="flex-1 rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <Button type="submit" disabled={loading}>
            {loading ? "Asking..." : "Ask"}
          </Button>
        </form>

        {error ? <p className="mt-3 text-sm text-[var(--band-critical)]">{error}</p> : null}

        {answer ? (
          <div className="mt-4 rounded-lg border border-border bg-background p-4">
            <p className="whitespace-pre-wrap text-sm text-foreground">{answer}</p>
            {!configured ? (
              <p className="mt-2 text-xs text-muted">AI is not configured in this environment — see note above.</p>
            ) : null}
            {refs.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
                <span className="text-xs text-muted">Sources:</span>
                {refs.slice(0, 12).map((ref, i) => {
                  const href = REF_HREF[ref.type]?.(ref.id);
                  return href ? (
                    <Link key={`${ref.type}-${ref.id}-${i}`} href={href} className="text-xs font-medium text-brand hover:underline">
                      {ref.type} →
                    </Link>
                  ) : null;
                })}
              </div>
            ) : null}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
