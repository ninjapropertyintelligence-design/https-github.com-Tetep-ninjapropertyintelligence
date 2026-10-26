"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { apiRequest } from "@/components/settings/api-request";
import { TagPicker, type PickerTagType } from "@/components/tags/TagPicker";

/** Mirrors `templateDefinitionSchema` in template-service; the server re-validates everything. */
export interface BuilderQuestion {
  prompt: string;
  type: string;
  isRequired: boolean;
  options: string[];
  category?: string | null;
}
export interface BuilderTask {
  name: string;
  description?: string | null;
  isRequired: boolean;
  isRepeatable: boolean;
  isCompletable: boolean;
  defaultTagValueIds?: string[];
  questions: BuilderQuestion[];
}
export interface BuilderSection {
  name: string;
  questions: BuilderQuestion[];
  tasks: BuilderTask[];
}
export interface BuilderDefinition {
  name: string;
  description?: string | null;
  sections: BuilderSection[];
}

const QUESTION_TYPE_LABELS: Record<string, string> = {
  PHOTO: "Photo",
  TEXT: "Text",
  NUMBER: "Number",
  YES_NO: "Yes / No",
  SELECT: "Choose one",
  MULTI_SELECT: "Choose several",
  CONDITION: "Condition score (0-100)",
  VIDEO: "Video",
  MEASUREMENT: "Measurement",
  ASSET: "Asset",
  SIGNATURE: "Signature",
};

const INPUT = "w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-brand";
const SMALL = "rounded border border-border px-1.5 py-0.5 text-xs text-muted hover:text-foreground disabled:opacity-40";

const newQuestion = (): BuilderQuestion => ({ prompt: "", type: "PHOTO", isRequired: true, options: [] });
const newTask = (): BuilderTask => ({ name: "", isRequired: true, isRepeatable: false, isCompletable: true, questions: [newQuestion()] });
const newSection = (): BuilderSection => ({ name: "", questions: [], tasks: [newTask()] });

function move<T>(list: T[], index: number, by: -1 | 1): T[] {
  const target = index + by;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
const replaceAt = <T,>(list: T[], index: number, value: T) => list.map((x, i) => (i === index ? value : x));
const removeAt = <T,>(list: T[], index: number) => list.filter((_, i) => i !== index);

/** Up / down / remove for one item in an ordered list. */
function ItemControls({ index, count, onMove, onRemove, label }: { index: number; count: number; onMove: (by: -1 | 1) => void; onRemove: () => void; label: string }) {
  return (
    <span className="flex shrink-0 gap-1">
      <button type="button" className={SMALL} disabled={index === 0} onClick={() => onMove(-1)} aria-label={`Move ${label} up`}>
        ↑
      </button>
      <button type="button" className={SMALL} disabled={index === count - 1} onClick={() => onMove(1)} aria-label={`Move ${label} down`}>
        ↓
      </button>
      <button type="button" className={SMALL} onClick={onRemove} aria-label={`Remove ${label}`}>
        Remove
      </button>
    </span>
  );
}

function QuestionEditor({
  question,
  onChange,
  controls,
}: {
  question: BuilderQuestion;
  onChange: (q: BuilderQuestion) => void;
  controls: React.ReactNode;
}) {
  const choice = question.type === "SELECT" || question.type === "MULTI_SELECT";
  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-start gap-2">
        <input
          aria-label="Question prompt"
          value={question.prompt}
          onChange={(e) => onChange({ ...question, prompt: e.target.value })}
          placeholder="Question, e.g. Panel photo (door open)"
          className={`${INPUT} min-w-48 flex-1`}
        />
        <select
          aria-label="Answer type"
          value={question.type}
          onChange={(e) => onChange({ ...question, type: e.target.value })}
          className="rounded-lg border border-border px-2 py-2 text-sm"
        >
          {Object.entries(QUESTION_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 self-center text-xs text-foreground">
          <input type="checkbox" checked={question.isRequired} onChange={(e) => onChange({ ...question, isRequired: e.target.checked })} />
          Required
        </label>
        {controls}
      </div>
      {choice ? (
        <input
          aria-label="Options"
          value={question.options.join(", ")}
          onChange={(e) => onChange({ ...question, options: e.target.value.split(",").map((o) => o.trimStart()) })}
          onBlur={() => onChange({ ...question, options: question.options.map((o) => o.trim()).filter(Boolean) })}
          placeholder="Options, separated by commas"
          className={INPUT}
        />
      ) : null}
      {question.type === "CONDITION" ? (
        <input
          aria-label="Scoring category"
          value={question.category ?? ""}
          onChange={(e) => onChange({ ...question, category: e.target.value || null })}
          placeholder="Scoring category, e.g. Roof, HVAC, Electrical"
          className={INPUT}
        />
      ) : null}
    </div>
  );
}

function QuestionList({ questions, onChange }: { questions: BuilderQuestion[]; onChange: (qs: BuilderQuestion[]) => void }) {
  return (
    <div className="space-y-2">
      {questions.map((q, i) => (
        <QuestionEditor
          key={i}
          question={q}
          onChange={(next) => onChange(replaceAt(questions, i, next))}
          controls={
            <ItemControls
              index={i}
              count={questions.length}
              label="question"
              onMove={(by) => onChange(move(questions, i, by))}
              onRemove={() => onChange(removeAt(questions, i))}
            />
          }
        />
      ))}
      <button type="button" onClick={() => onChange([...questions, newQuestion()])} className="text-sm text-brand hover:underline">
        + Add question
      </button>
    </div>
  );
}

export function TemplateBuilder({
  templateId,
  initial,
  usedBy = 0,
  tagTypes = [],
}: {
  /** Organization-wide tag values only: a template is used at every property. */
  tagTypes?: PickerTagType[];
  /** Absent when creating a new template. */
  templateId?: string;
  initial?: BuilderDefinition;
  /** How many assessments use this template. Above zero, saving makes a new version. */
  usedBy?: number;
}) {
  const router = useRouter();
  const [def, setDef] = useState<BuilderDefinition>(initial ?? { name: "", description: "", sections: [newSection()] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inUse = !!templateId && usedBy > 0;

  const setSection = (i: number, s: BuilderSection) => setDef({ ...def, sections: replaceAt(def.sections, i, s) });

  async function save() {
    setBusy(true);
    setError(null);
    const body = JSON.stringify(def);
    const res = !templateId
      ? await apiRequest("/api/v1/assessments/templates", { method: "POST", body })
      : inUse
        ? await apiRequest(`/api/v1/assessments/templates/${templateId}/versions`, { method: "POST", body })
        : await apiRequest(`/api/v1/assessments/templates/${templateId}`, { method: "PUT", body });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.push(`/assessments/templates/${res.data?.id ?? templateId}`);
    router.refresh();
  }

  const totals = def.sections.reduce(
    (acc, s) => ({
      tasks: acc.tasks + s.tasks.length,
      questions: acc.questions + s.questions.length + s.tasks.reduce((n, t) => n + t.questions.length, 0),
    }),
    { tasks: 0, questions: 0 },
  );

  return (
    <div className="space-y-4">
      {inUse ? (
        <p className="rounded-lg border border-[var(--band-needs-attention)] px-3 py-2 text-sm text-foreground">
          {usedBy} assessment{usedBy === 1 ? " has" : "s have"} used this template, so saving creates a new version and retires this
          one. Those assessments keep the questions they were answered against.
        </p>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-muted">Template name</span>
          <input value={def.name} onChange={(e) => setDef({ ...def, name: e.target.value })} placeholder="e.g. Site Survey" className={INPUT} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted">Description</span>
          <input value={def.description ?? ""} onChange={(e) => setDef({ ...def, description: e.target.value })} className={INPUT} />
        </label>
      </div>

      {def.sections.map((section, sIdx) => (
        <div key={sIdx} className="space-y-3 rounded-xl border border-border bg-zinc-50 p-4">
          <div className="flex items-center gap-2">
            <input
              aria-label="Section name"
              value={section.name}
              onChange={(e) => setSection(sIdx, { ...section, name: e.target.value })}
              placeholder={`Section ${sIdx + 1}, e.g. Check-In`}
              className={`${INPUT} font-medium`}
            />
            <ItemControls
              index={sIdx}
              count={def.sections.length}
              label="section"
              onMove={(by) => setDef({ ...def, sections: move(def.sections, sIdx, by) })}
              onRemove={() => setDef({ ...def, sections: removeAt(def.sections, sIdx) })}
            />
          </div>

          {section.tasks.map((task, tIdx) => {
            const setTask = (t: BuilderTask) => setSection(sIdx, { ...section, tasks: replaceAt(section.tasks, tIdx, t) });
            return (
              <div key={tIdx} className="ml-2 space-y-2 rounded-lg border border-border bg-background p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    aria-label="Task name"
                    value={task.name}
                    onChange={(e) => setTask({ ...task, name: e.target.value })}
                    placeholder="Task, e.g. Electrical panel"
                    className={`${INPUT} min-w-48 flex-1`}
                  />
                  <ItemControls
                    index={tIdx}
                    count={section.tasks.length}
                    label="task"
                    onMove={(by) => setSection(sIdx, { ...section, tasks: move(section.tasks, tIdx, by) })}
                    onRemove={() => setSection(sIdx, { ...section, tasks: removeAt(section.tasks, tIdx) })}
                  />
                </div>
                <div className="flex flex-wrap gap-4 text-xs text-foreground">
                  <label className="flex items-center gap-1" title="Counts toward required tasks complete">
                    <input type="checkbox" checked={task.isRequired} onChange={(e) => setTask({ ...task, isRequired: e.target.checked })} />
                    Required
                  </label>
                  <label className="flex items-center gap-1" title="Answered once per thing found, e.g. each panel">
                    <input type="checkbox" checked={task.isRepeatable} onChange={(e) => setTask({ ...task, isRepeatable: e.target.checked })} />
                    Repeatable
                  </label>
                  <label className="flex items-center gap-1" title="The inspector marks it complete; otherwise it completes when its required questions are answered">
                    <input type="checkbox" checked={task.isCompletable} onChange={(e) => setTask({ ...task, isCompletable: e.target.checked })} />
                    Marked complete by hand
                  </label>
                </div>
                {tagTypes.some((t) => t.values.length > 0) ? (
                  <div className="space-y-1">
                    <p className="text-xs text-muted">Default tags — every response of this task starts with them, and its photos are filed under them.</p>
                    <TagPicker types={tagTypes} selected={task.defaultTagValueIds ?? []} onChange={(ids) => setTask({ ...task, defaultTagValueIds: ids })} />
                  </div>
                ) : null}
                <QuestionList questions={task.questions} onChange={(questions) => setTask({ ...task, questions })} />
              </div>
            );
          })}

          {section.questions.length > 0 ? (
            <div className="ml-2 space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Asked once, outside any task</p>
              <QuestionList questions={section.questions} onChange={(questions) => setSection(sIdx, { ...section, questions })} />
            </div>
          ) : null}

          <div className="ml-2 flex gap-4 text-sm">
            <button type="button" onClick={() => setSection(sIdx, { ...section, tasks: [...section.tasks, newTask()] })} className="text-brand hover:underline">
              + Add task
            </button>
            {section.questions.length === 0 ? (
              <button type="button" onClick={() => setSection(sIdx, { ...section, questions: [newQuestion()] })} className="text-muted hover:text-foreground">
                + Add a question outside a task
              </button>
            ) : null}
          </div>
        </div>
      ))}

      <button type="button" onClick={() => setDef({ ...def, sections: [...def.sections, newSection()] })} className="text-sm text-brand hover:underline">
        + Add section
      </button>

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button onClick={save} disabled={busy}>
          {busy ? "Saving..." : !templateId ? "Create template" : inUse ? "Save as new version" : "Save changes"}
        </Button>
        <span className="text-xs text-muted">
          {def.sections.length} section{def.sections.length === 1 ? "" : "s"} · {totals.tasks} task{totals.tasks === 1 ? "" : "s"} · {totals.questions} question
          {totals.questions === 1 ? "" : "s"}
        </span>
        {error ? (
          <p role="alert" className="w-full text-sm text-[var(--band-critical)]">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
