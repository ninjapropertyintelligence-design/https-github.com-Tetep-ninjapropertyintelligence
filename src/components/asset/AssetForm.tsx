"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { apiRequest } from "@/components/settings/api-request";

export interface AssetFormValues {
  name: string;
  assetType: string;
  areaId: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
}

export interface AssetFormOptions {
  areas: Array<{ id: string; label: string }>;
}

const EMPTY: AssetFormValues = {
  name: "",
  assetType: "",
  areaId: "",
  manufacturer: "",
  model: "",
  serialNumber: "",
};

const input = "mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand";

/**
 * Adding an asset, or editing one: what it is, where it is and its data
 * plate (make, model, serial). The field crew fills this in on site, so
 * every field but the name and type is optional and can be completed later.
 * Who services it and its inspection dates live in their own panels on the
 * asset page (contractor, expiry dates).
 */
export function AssetForm({
  propertyId,
  options,
  asset,
  onDone,
}: {
  propertyId: string;
  options: AssetFormOptions;
  /** The asset being edited; omitted to add a new one. */
  asset?: { id: string; version: number; values: AssetFormValues };
  onDone?: () => void;
}) {
  const router = useRouter();
  const [values, setValues] = useState<AssetFormValues>(asset?.values ?? EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof AssetFormValues) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body = {
      propertyId,
      name: values.name.trim(),
      assetType: values.assetType.trim(),
      areaId: values.areaId || null,
      manufacturer: values.manufacturer.trim() || null,
      model: values.model.trim() || null,
      serialNumber: values.serialNumber.trim() || null,
      ...(asset ? { version: asset.version } : {}),
    };
    const res = asset
      ? await apiRequest(`/api/v1/assets/${asset.id}`, { method: "PATCH", body: JSON.stringify(body) })
      : await apiRequest("/api/v1/assets", { method: "POST", body: JSON.stringify(body) });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    if (!asset) setValues(EMPTY);
    router.refresh();
    onDone?.();
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="block text-xs font-medium text-muted">
        Name
        <input required value={values.name} onChange={set("name")} placeholder="e.g. Fryer 2" className={input} />
      </label>
      <label className="block text-xs font-medium text-muted">
        Type
        <input required value={values.assetType} onChange={set("assetType")} placeholder="e.g. Fryer" className={input} />
      </label>
      <label className="block text-xs font-medium text-muted">
        Section
        <select value={values.areaId} onChange={set("areaId")} className={input}>
          <option value="">Not set</option>
          {options.areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs font-medium text-muted">
        Make
        <input value={values.manufacturer} onChange={set("manufacturer")} className={input} />
      </label>
      <label className="block text-xs font-medium text-muted">
        Model
        <input value={values.model} onChange={set("model")} className={input} />
      </label>
      <label className="block text-xs font-medium text-muted">
        Serial number
        <input value={values.serialNumber} onChange={set("serialNumber")} className={input} />
      </label>
      {error ? <p className="text-sm text-[var(--band-critical)] sm:col-span-2">{error}</p> : null}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : asset ? "Save asset" : "Add asset"}
        </Button>
        {onDone ? (
          <Button type="button" variant="secondary" onClick={onDone}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/** A button that opens the form in place: "Add asset" or "Edit details". */
export function AssetFormToggle(props: Parameters<typeof AssetForm>[0] & { label: string }) {
  const [open, setOpen] = useState(false);
  const { label, ...formProps } = props;
  if (!open) {
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }
  return <AssetForm {...formProps} onDone={() => setOpen(false)} />;
}
