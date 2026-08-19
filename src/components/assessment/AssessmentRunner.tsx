"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

interface Question {
  id: string;
  prompt: string;
  type: string;
  isRequired: boolean;
  options: string[];
  category: string | null;
}
interface Section {
  id: string;
  name: string;
  questions: Question[];
}
interface Answer {
  questionId: string;
  assetId: string | null;
  textValue: string | null;
  numberValue: number | null;
  boolValue: boolean | null;
  conditionValue: number | null;
  selectValues: string[];
}

const CAPTURE_TYPES = new Set(["PHOTO", "VIDEO", "MEASUREMENT", "ASSET", "SIGNATURE"]);

export function AssessmentRunner({
  assessmentId,
  sections,
  initialAnswers,
  status,
  readOnly,
}: {
  assessmentId: string;
  sections: Section[];
  initialAnswers: Answer[];
  status: string;
  readOnly: boolean;
}) {
  const router = useRouter();
  const answerByQuestion = new Map(initialAnswers.map((a) => [a.questionId, a]));
  const [saving, setSaving] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [values, setValues] = useState<Record<string, Partial<Answer>>>(
    Object.fromEntries(initialAnswers.map((a) => [a.questionId, a])),
  );

  async function saveAnswer(question: Question, patch: Partial<Answer>) {
    setValues((prev) => ({ ...prev, [question.id]: { ...prev[question.id], ...patch } }));
    setSaving(question.id);
    await fetch(`/api/v1/assessments/${assessmentId}/answers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionId: question.id, ...patch }),
    });
    setSaving(null);
  }

  async function completeAssessment() {
    setCompleting(true);
    const res = await fetch(`/api/v1/assessments/${assessmentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "COMPLETED" }),
    });
    setCompleting(false);
    if (res.ok) router.refresh();
  }

  return (
    <div className="space-y-6">
      {sections.map((section) => (
        <div key={section.id} className="rounded-xl border border-border bg-surface">
          <div className="border-b border-border px-5 py-3">
            <h3 className="text-sm font-semibold text-foreground">{section.name}</h3>
          </div>
          <div className="divide-y divide-border">
            {section.questions.map((q) => {
              const current = values[q.id] ?? answerByQuestion.get(q.id) ?? {};
              return (
                <div key={q.id} className="px-5 py-4">
                  <p className="text-sm font-medium text-foreground">
                    {q.prompt}
                    {q.isRequired ? <span className="text-[var(--band-critical)]"> *</span> : null}
                  </p>
                  <div className="mt-2 max-w-md">
                    <QuestionInput question={q} value={current} disabled={readOnly} onSave={(patch) => saveAnswer(q, patch)} />
                  </div>
                  {saving === q.id ? <p className="mt-1 text-xs text-muted">Saving...</p> : null}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {!readOnly ? (
        <Button onClick={completeAssessment} disabled={completing}>
          {completing ? "Completing..." : "Complete Assessment"}
        </Button>
      ) : (
        <p className="text-sm text-muted">This assessment is {status.toLowerCase()} and its answers are locked.</p>
      )}
    </div>
  );
}

function QuestionInput({
  question,
  value,
  disabled,
  onSave,
}: {
  question: Question;
  value: Partial<Answer>;
  disabled: boolean;
  onSave: (patch: Partial<Answer>) => void;
}) {
  if (question.type === "CONDITION") {
    return (
      <div>
        <input
          type="range"
          min={0}
          max={100}
          disabled={disabled}
          defaultValue={value.conditionValue ?? 75}
          onMouseUp={(e) => onSave({ conditionValue: Number((e.target as HTMLInputElement).value) })}
          onTouchEnd={(e) => onSave({ conditionValue: Number((e.target as HTMLInputElement).value) })}
          className="w-full"
        />
        <p className="tabular-nums text-sm text-foreground">{value.conditionValue ?? "—"}</p>
      </div>
    );
  }
  if (question.type === "YES_NO") {
    return (
      <div className="flex gap-2">
        {[true, false].map((b) => (
          <button
            key={String(b)}
            type="button"
            disabled={disabled}
            onClick={() => onSave({ boolValue: b })}
            className={`rounded-lg border px-3 py-1.5 text-sm ${value.boolValue === b ? "border-brand bg-brand/10 text-brand" : "border-border text-muted"}`}
          >
            {b ? "Yes" : "No"}
          </button>
        ))}
      </div>
    );
  }
  if (question.type === "NUMBER") {
    return (
      <input
        type="number"
        disabled={disabled}
        defaultValue={value.numberValue ?? ""}
        onBlur={(e) => onSave({ numberValue: e.target.value ? Number(e.target.value) : null })}
        className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand disabled:bg-zinc-50"
      />
    );
  }
  if (question.type === "SELECT" || question.type === "MULTI_SELECT") {
    return (
      <select
        disabled={disabled}
        multiple={question.type === "MULTI_SELECT"}
        defaultValue={question.type === "MULTI_SELECT" ? value.selectValues ?? [] : value.selectValues?.[0] ?? ""}
        onChange={(e) => {
          const selected = Array.from(e.target.selectedOptions).map((o) => o.value);
          onSave({ selectValues: selected });
        }}
        className="w-full rounded-lg border border-border px-3 py-2 text-sm"
      >
        {question.type !== "MULTI_SELECT" ? <option value="">Select...</option> : null}
        {question.options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  }
  if (CAPTURE_TYPES.has(question.type)) {
    return (
      <div>
        <p className="mb-1 text-xs text-muted">
          {question.type} capture UI isn&apos;t available in this phase — record a note for now.
        </p>
        <input
          disabled={disabled}
          defaultValue={value.textValue ?? ""}
          onBlur={(e) => onSave({ textValue: e.target.value || null })}
          placeholder="Note"
          className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand disabled:bg-zinc-50"
        />
      </div>
    );
  }
  // TEXT (default)
  return (
    <textarea
      disabled={disabled}
      defaultValue={value.textValue ?? ""}
      onBlur={(e) => onSave({ textValue: e.target.value || null })}
      rows={2}
      className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand disabled:bg-zinc-50"
    />
  );
}
