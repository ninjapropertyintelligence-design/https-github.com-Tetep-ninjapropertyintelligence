/**
 * Structured operational logging (spec Phase 2 §19). Every integration
 * touchpoint that can fail or take meaningful time — Matterport API calls,
 * drone uploads, AI tool calls, document indexing, report generation —
 * emits one structured line here. This is real, working logging (not a
 * stub): in this environment it writes newline-delimited JSON to stdout,
 * which is exactly what a log shipper (CloudWatch, Datadog, etc.) tails in
 * production. Swapping the sink later means changing `write()` only; every
 * call site stays the same.
 */
export type ObservabilityEvent =
  | "matterport.api_call"
  | "matterport.sync"
  | "drone.upload"
  | "drone.processing_job"
  | "ai.tool_call"
  | "ai.provider_call"
  | "document.index_job"
  | "report.generate";

export interface ObservabilityFields {
  organizationId?: string;
  propertyId?: string;
  ok: boolean;
  durationMs?: number;
  sizeBytes?: number;
  provider?: string;
  errorMessage?: string;
  [key: string]: unknown;
}

function write(event: ObservabilityEvent, fields: ObservabilityFields) {
  const line = { ts: new Date().toISOString(), event, ...fields };
  if (fields.ok) {
    console.log(JSON.stringify(line));
  } else {
    console.error(JSON.stringify(line));
  }
}

export function logEvent(event: ObservabilityEvent, fields: ObservabilityFields) {
  write(event, fields);
}

/** Wraps an async operation, timing it and logging success/failure exactly once. */
export async function withObservability<T>(
  event: ObservabilityEvent,
  fields: Omit<ObservabilityFields, "ok" | "durationMs">,
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    logEvent(event, { ...fields, ok: true, durationMs: Date.now() - startedAt });
    return result;
  } catch (err) {
    logEvent(event, {
      ...fields,
      ok: false,
      durationMs: Date.now() - startedAt,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
