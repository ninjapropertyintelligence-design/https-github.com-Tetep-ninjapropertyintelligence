"use client";

import { useState } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { apiRequest } from "@/components/settings/api-request";

interface CatalogEntry {
  type: string;
  label: string;
  description: string;
  group: string;
}

/**
 * One switch per kind of notification email. Each change saves on its own,
 * so there is no Save button to forget; a failed save puts the switch back
 * and says why.
 */
export function NotificationPreferencesForm({
  catalog,
  initial,
}: {
  catalog: CatalogEntry[];
  initial: Record<string, boolean>;
}) {
  const [email, setEmail] = useState<Record<string, boolean>>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(changes: Array<{ type: string; email: boolean }>) {
    const before = email;
    setEmail({ ...email, ...Object.fromEntries(changes.map((c) => [c.type, c.email])) });
    setSaving(true);
    setError(null);
    setSaved(false);
    const result = await apiRequest("/api/v1/me/notification-preferences", {
      method: "PATCH",
      body: JSON.stringify({ changes }),
    });
    setSaving(false);
    if (!result.ok) {
      setEmail(before);
      setError(result.error);
      return;
    }
    setSaved(true);
  }

  const groups = [...new Set(catalog.map((c) => c.group))];
  const allOn = catalog.every((c) => email[c.type]);
  const allOff = catalog.every((c) => !email[c.type]);

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="space-y-3 text-sm">
          <p className="text-foreground">
            Choose which notifications also arrive by email. You will still see every notification in the app, under
            the bell.
          </p>
          <p className="text-muted">
            Emails about your account — password resets, invitations, and changes to your access — always send.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={saving || allOn}
              onClick={() => save(catalog.map((c) => ({ type: c.type, email: true })))}
            >
              Turn all on
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={saving || allOff}
              onClick={() => save(catalog.map((c) => ({ type: c.type, email: false })))}
            >
              Turn all off
            </Button>
            <span className="text-xs text-muted" aria-live="polite">
              {saving ? "Saving…" : saved ? "Saved" : ""}
            </span>
          </div>
          {error ? <p className="text-sm text-[var(--band-critical)]">{error}</p> : null}
        </CardBody>
      </Card>

      {groups.map((group) => (
        <Card key={group}>
          <CardHeader title={group} />
          <CardBody className="p-0">
            <ul>
              {catalog
                .filter((c) => c.group === group)
                .map((c) => {
                  const id = `pref-${c.type}`;
                  return (
                    <li
                      key={c.type}
                      className="flex items-center justify-between gap-4 border-b border-border px-5 py-3 text-sm last:border-0"
                    >
                      <label htmlFor={id} className="min-w-0 cursor-pointer">
                        <span className="block font-medium text-foreground">{c.label}</span>
                        <span className="block text-xs text-muted">{c.description}</span>
                      </label>
                      <button
                        id={id}
                        type="button"
                        role="switch"
                        aria-checked={email[c.type]}
                        disabled={saving}
                        onClick={() => save([{ type: c.type, email: !email[c.type] }])}
                        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-60 ${
                          email[c.type] ? "bg-brand" : "bg-zinc-300"
                        }`}
                      >
                        <span className="sr-only">Email me about: {c.label}</span>
                        <span
                          className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${
                            email[c.type] ? "translate-x-5" : "translate-x-0.5"
                          }`}
                        />
                      </button>
                    </li>
                  );
                })}
            </ul>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
