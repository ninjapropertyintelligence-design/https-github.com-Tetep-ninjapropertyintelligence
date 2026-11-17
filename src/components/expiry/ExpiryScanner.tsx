"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { apiRequest } from "@/components/settings/api-request";
import { ExpiryForm, EMPTY_EXPIRY, type ExpiryFormValues } from "@/components/expiry/ExpiryForm";

type Reading = {
  kind: string;
  expiresOn: string | null;
  lastInspectedOn: string | null;
  servicedBy: string | null;
  confidence: number;
  notes: string;
};

type Outcome =
  | { state: "saved"; reading: Reading; alreadyExpired: boolean }
  | { state: "manual"; message: string; reading: Reading | null; evidenceId: string };

/**
 * Photograph the tag; the platform reads the date, remembers it and counts it
 * down. Whatever it reads is marked for a person to check, and when it cannot
 * read the tag the form opens with what it did make out, so nothing is lost.
 */
export function ExpiryScanner({
  assetId,
  propertyId,
  kinds,
  hasContractor,
  canEnterByHand,
}: {
  assetId: string;
  propertyId: string;
  kinds: readonly string[];
  hasContractor: boolean;
  /** Offer typing a date without a photo. Hidden while the form is already open after a failed read. */
  canEnterByHand: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"idle" | "uploading" | "reading">("idle");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function scan(file: File) {
    setError(null);
    setOutcome(null);
    let evidenceId: string | null = null;
    try {
      setStep("uploading");
      const contentType = file.type || "image/jpeg";
      const signed = await apiRequest("/api/v1/evidence/upload-url", {
        method: "POST",
        body: JSON.stringify({ filename: file.name, contentType }),
      });
      if (!signed.ok) throw new Error(signed.error);
      const { url, key } = signed.data as { url: string; key: string };
      const put = await fetch(url, { method: "PUT", body: file, headers: { "Content-Type": contentType } });
      if (!put.ok) throw new Error(`Storage refused the photo (HTTP ${put.status})`);
      const registered = await apiRequest("/api/v1/evidence", {
        method: "POST",
        body: JSON.stringify({
          type: "PHOTO",
          storageKey: key,
          mimeType: contentType,
          sizeBytes: file.size,
          propertyId,
          assetId,
          captureDate: new Date(file.lastModified).toISOString(),
        }),
      });
      if (!registered.ok) throw new Error(registered.error);
      evidenceId = String((registered.data as { id: string }).id);

      setStep("reading");
      const res = await apiRequest(`/api/v1/assets/${assetId}/expiry-scan`, {
        method: "POST",
        body: JSON.stringify({ evidenceId }),
      });
      if (!res.ok) {
        // Not set up, or the provider failed: the photo is saved, so the date can be typed.
        setOutcome({ state: "manual", message: res.error, reading: null, evidenceId });
        return;
      }
      const data = res.data as unknown as
        | { created: true; reading: Reading; alreadyExpired: boolean }
        | { created: false; message: string; reading: Reading | null };
      if (data.created) {
        setOutcome({ state: "saved", reading: data.reading, alreadyExpired: data.alreadyExpired });
        router.refresh();
      } else {
        setOutcome({ state: "manual", message: data.message, reading: data.reading, evidenceId });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setStep("idle");
      if (input.current) input.current.value = "";
    }
  }

  const prefill = (r: Reading | null): ExpiryFormValues =>
    r
      ? { ...EMPTY_EXPIRY, kind: r.kind, expiresAt: r.expiresOn ?? "", lastInspectedAt: r.lastInspectedOn ?? "", servicedBy: r.servicedBy ?? "" }
      : EMPTY_EXPIRY;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={input}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void scan(file);
          }}
        />
        <Button disabled={step !== "idle"} onClick={() => input.current?.click()}>
          {step === "uploading" ? "Uploading…" : step === "reading" ? "Reading the tag…" : "Photograph a tag"}
        </Button>
        <span className="text-xs text-muted">Take a close-up of the tag. The date is read, remembered and counted down.</span>
      </div>
      {error ? <p className="text-xs text-[var(--band-critical)]">{error}</p> : null}

      {outcome?.state === "saved" ? (
        <div className="rounded-lg border border-border bg-zinc-50 p-3 text-sm">
          <p className="font-medium text-foreground">
            Read {outcome.reading.kind}: {outcome.reading.expiresOn}
            {outcome.alreadyExpired ? " (already expired)" : ""}
          </p>
          <p className="text-xs text-muted">
            Now counting down. Please check the date against the tag below and confirm or correct it.
            {outcome.reading.notes ? ` ${outcome.reading.notes}` : ""}
          </p>
        </div>
      ) : null}

      {canEnterByHand && outcome?.state !== "manual" ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-brand">Or enter a date by hand</summary>
          <div className="mt-3">
            <ExpiryForm propertyId={propertyId} assetId={assetId} kinds={kinds} hasContractor={hasContractor} />
          </div>
        </details>
      ) : null}

      {outcome?.state === "manual" ? (
        <div className="space-y-3 rounded-lg border border-border p-3">
          <p className="text-sm text-foreground">{outcome.message}</p>
          <ExpiryForm
            propertyId={propertyId}
            assetId={assetId}
            kinds={kinds}
            initial={prefill(outcome.reading)}
            evidenceId={outcome.evidenceId}
            hasContractor={hasContractor}
            onDone={() => setOutcome(null)}
          />
        </div>
      ) : null}
    </div>
  );
}
