"use client";

/** The vocabulary as pickers need it; built from `getVocabulary`. */
export interface PickerTagType {
  id: string;
  name: string;
  allowMultiple: boolean;
  values: Array<{ id: string; name: string }>;
}

/**
 * One control per tag type: a dropdown where a type takes one value (Level,
 * Area), toggle chips where it takes several (Tag). Controlled — the caller
 * owns the selected ids and decides when to save.
 */
export function TagPicker({
  types,
  selected,
  onChange,
  disabled = false,
}: {
  types: PickerTagType[];
  selected: string[];
  onChange: (tagValueIds: string[]) => void;
  disabled?: boolean;
}) {
  const chosen = new Set(selected);
  const offered = types.filter((t) => t.values.length > 0);
  if (offered.length === 0) return <p className="text-xs text-muted">No tags are set up yet.</p>;

  return (
    <div className="flex flex-wrap items-start gap-2">
      {offered.map((type) =>
        type.allowMultiple ? (
          <div key={type.id} className="flex flex-wrap items-center gap-1">
            <span className="text-xs text-muted">{type.name}:</span>
            {type.values.map((v) => (
              <button
                key={v.id}
                type="button"
                disabled={disabled}
                aria-pressed={chosen.has(v.id)}
                onClick={() => onChange(chosen.has(v.id) ? selected.filter((id) => id !== v.id) : [...selected, v.id])}
                className={`rounded-full border px-2 py-0.5 text-xs ${chosen.has(v.id) ? "border-brand bg-brand/10 text-brand" : "border-border text-muted"}`}
              >
                {v.name}
              </button>
            ))}
          </div>
        ) : (
          <label key={type.id} className="flex items-center gap-1 text-xs text-muted">
            {type.name}
            <select
              aria-label={type.name}
              disabled={disabled}
              value={type.values.find((v) => chosen.has(v.id))?.id ?? ""}
              onChange={(e) => {
                const others = selected.filter((id) => !type.values.some((v) => v.id === id));
                onChange(e.target.value ? [...others, e.target.value] : others);
              }}
              className="rounded-lg border border-border bg-surface px-2 py-1 text-xs text-foreground"
            >
              <option value="">—</option>
              {type.values.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
        ),
      )}
    </div>
  );
}
