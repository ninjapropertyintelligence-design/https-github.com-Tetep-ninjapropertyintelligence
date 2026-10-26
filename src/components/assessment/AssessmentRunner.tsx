"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { apiRequest } from "@/components/settings/api-request";
import { TagPicker, type PickerTagType } from "@/components/tags/TagPicker";

interface Question {
  id: string;
  prompt: string;
  type: string;
  isRequired: boolean;
  options: string[];
  category: string | null;
}
interface Task {
  id: string;
  name: string;
  description: string | null;
  isRequired: boolean;
  isRepeatable: boolean;
  isCompletable: boolean;
  questions: Question[];
}
interface Section {
  id: string;
  name: string;
  questions: Question[];
  tasks: Task[];
}
interface TaskResponse {
  id: string;
  taskId: string;
  instance: number;
  label: string | null;
  isComplete: boolean;
  tagValueIds: string[];
}
interface AnswerFile {
  id: string;
  type: string;
}
interface Answer {
  id: string;
  questionId: string;
  taskResponseId: string | null;
  assetId: string | null;
  textValue: string | null;
  numberValue: number | null;
  boolValue: boolean | null;
  conditionValue: number | null;
  selectValues: string[];
  files: AnswerFile[];
}

type AnswerPatch = Partial<Pick<Answer, "textValue" | "numberValue" | "boolValue" | "conditionValue" | "selectValues">>;
type TaskFilter = "all" | "incomplete" | "complete";

const NOTE_TYPES = new Set(["MEASUREMENT", "ASSET", "SIGNATURE"]);
const FILE_TYPES = new Set(["PHOTO", "VIDEO"]);

const answerKey = (questionId: string, taskResponseId: string | null) => `${questionId}|${taskResponseId ?? ""}`;

export function AssessmentRunner({
  assessmentId,
  propertyId,
  sections,
  taskResponses,
  initialAnswers,
  status,
  readOnly,
  canComplete,
  canReopen,
  canRelease,
  tagTypes = [],
}: {
  tagTypes?: PickerTagType[];
  assessmentId: string;
  propertyId: string;
  sections: Section[];
  taskResponses: TaskResponse[];
  initialAnswers: Answer[];
  status: string;
  readOnly: boolean;
  canComplete: boolean;
  canReopen: boolean;
  canRelease: boolean;
}) {
  const router = useRouter();
  const answers = new Map(initialAnswers.map((a) => [answerKey(a.questionId, a.taskResponseId), a]));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<TaskFilter>("all");
  const [selected, setSelected] = useState<Record<string, string>>({});
  // Shown at once and saved in the background, so choosing a Level does not
  // wait on the round trip; a refused save puts the error up.
  const [responseTags, setResponseTags] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(taskResponses.map((r) => [r.id, r.tagValueIds])),
  );

  const saveResponseTags = (response: TaskResponse, tagValueIds: string[]) => {
    setResponseTags((prev) => ({ ...prev, [response.id]: tagValueIds }));
    return run(`tags:${response.id}`, () =>
      apiRequest(`/api/v1/assessments/${assessmentId}/task-responses/${response.id}/tags`, {
        method: "PUT",
        body: JSON.stringify({ tagValueIds }),
      }),
    );
  };

  const responsesOf = (taskId: string) => taskResponses.filter((r) => r.taskId === taskId);

  async function run(label: string, action: () => Promise<{ ok: true; data?: Record<string, unknown> } | { ok: false; error: string }>) {
    setBusy(label);
    setError(null);
    const result = await action();
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return null;
    }
    router.refresh();
    return result.data ?? {};
  }

  const saveAnswer = (question: Question, taskResponseId: string | null, patch: AnswerPatch) =>
    run(`answer:${question.id}`, () =>
      apiRequest(`/api/v1/assessments/${assessmentId}/answers`, {
        method: "POST",
        body: JSON.stringify({ questionId: question.id, taskResponseId, ...answerValues(answers.get(answerKey(question.id, taskResponseId))), ...patch }),
      }),
    );

  async function uploadFiles(question: Question, taskResponseId: string | null, files: File[]) {
    setBusy(`answer:${question.id}`);
    setError(null);
    try {
      // The file hangs off the answer, so the answer has to exist first.
      const saved = await apiRequest(`/api/v1/assessments/${assessmentId}/answers`, {
        method: "POST",
        body: JSON.stringify({ questionId: question.id, taskResponseId }),
      });
      if (!saved.ok) throw new Error(saved.error);
      const answerId = String(saved.data?.id);
      for (const file of files) {
        const contentType = file.type || "application/octet-stream";
        const signed = await apiRequest("/api/v1/evidence/upload-url", {
          method: "POST",
          body: JSON.stringify({ filename: file.name, contentType }),
        });
        if (!signed.ok) throw new Error(signed.error);
        const { url, key } = signed.data as { url: string; key: string };
        const put = await fetch(url, { method: "PUT", body: file, headers: { "Content-Type": contentType } });
        if (!put.ok) throw new Error(`Storage refused ${file.name} (HTTP ${put.status})`);
        const registered = await apiRequest("/api/v1/evidence", {
          method: "POST",
          body: JSON.stringify({
            type: question.type === "VIDEO" ? "VIDEO" : "PHOTO",
            storageKey: key,
            mimeType: contentType,
            sizeBytes: file.size,
            propertyId,
            assessmentAnswerId: answerId,
            clientId: crypto.randomUUID(),
            captureDate: new Date(file.lastModified).toISOString(),
          }),
        });
        if (!registered.ok) throw new Error(registered.error);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  }

  async function addResponse(task: Task) {
    const label = window.prompt(`Name this ${task.name.toLowerCase()} (optional)`, "") ?? null;
    if (label === null) return;
    const data = await run(`task:${task.id}`, () =>
      apiRequest(`/api/v1/assessments/${assessmentId}/task-responses`, {
        method: "POST",
        // A fresh id per press: if the request is retried after a dropped
        // connection, the server returns this response instead of a second one.
        body: JSON.stringify({ taskId: task.id, label: label || null, clientId: crypto.randomUUID() }),
      }),
    );
    if (data?.id) setSelected((prev) => ({ ...prev, [task.id]: String(data.id) }));
  }

  const setComplete = (task: Task, response: TaskResponse, isComplete: boolean) =>
    run(`task:${task.id}`, () =>
      apiRequest(`/api/v1/assessments/${assessmentId}/task-responses/${response.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isComplete }),
      }),
    );

  async function deleteResponse(task: Task, response: TaskResponse) {
    const name = response.label || `${task.name} #${response.instance}`;
    if (!window.confirm(`Delete "${name}" and its answers? Its photos are kept.`)) return;
    const result = await run(`task:${task.id}`, () =>
      apiRequest(`/api/v1/assessments/${assessmentId}/task-responses/${response.id}`, { method: "DELETE" }),
    );
    if (result) setSelected((prev) => ({ ...prev, [task.id]: "" }));
  }

  const changeStatus = (next: "COMPLETED" | "IN_PROGRESS" | "RELEASED") =>
    run(`status:${next}`, () =>
      apiRequest(`/api/v1/assessments/${assessmentId}`, { method: "PATCH", body: JSON.stringify({ status: next }) }),
    );

  function taskVisible(task: Task) {
    if (filter === "all") return true;
    const responses = responsesOf(task.id);
    const done = responses.length > 0 && responses.every((r) => r.isComplete);
    return filter === "complete" ? done : !done;
  }

  const hasTasks = sections.some((s) => s.tasks.length > 0);

  function renderQuestion(question: Question, taskResponseId: string | null) {
    const current = answers.get(answerKey(question.id, taskResponseId));
    return (
      <div key={`${question.id}:${taskResponseId ?? ""}`} className="px-5 py-4">
        <p className="text-sm font-medium text-foreground">
          {question.prompt}
          {question.isRequired ? <span className="text-[var(--band-critical)]"> *</span> : null}
        </p>
        <div className="mt-2 max-w-md">
          {FILE_TYPES.has(question.type) ? (
            <FileInput
              question={question}
              files={current?.files ?? []}
              disabled={readOnly || busy !== null}
              onFiles={(files) => uploadFiles(question, taskResponseId, files)}
            />
          ) : (
            <QuestionInput
              question={question}
              value={current ?? {}}
              disabled={readOnly}
              onSave={(patch) => saveAnswer(question, taskResponseId, patch)}
            />
          )}
        </div>
        {busy === `answer:${question.id}` ? <p className="mt-1 text-xs text-muted">Saving...</p> : null}
      </div>
    );
  }

  function renderTask(task: Task) {
    const responses = responsesOf(task.id);
    const active = responses.find((r) => r.id === selected[task.id]) ?? responses[0] ?? null;
    return (
      <div key={task.id} className="border-t border-border first:border-t-0">
        <div className="flex flex-wrap items-center justify-between gap-2 bg-zinc-50 px-5 py-2.5">
          <div>
            <p className="text-sm font-medium text-foreground">
              {task.name}
              {task.isRequired ? <span className="text-[var(--band-critical)]"> *</span> : null}
            </p>
            <p className="text-xs text-muted">
              {[task.isRepeatable ? "Repeatable" : null, task.isCompletable ? "Mark complete when done" : "Completes when answered"]
                .filter(Boolean)
                .join(" · ")}
              {task.description ? ` — ${task.description}` : ""}
            </p>
          </div>
          {active ? (
            <span className={`text-xs font-medium ${active.isComplete ? "text-[var(--band-good)]" : "text-muted"}`}>
              {active.isComplete ? "Complete" : "Incomplete"}
            </span>
          ) : (
            <span className="text-xs text-muted">Not started</span>
          )}
        </div>

        {task.isRepeatable && responses.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-5 py-2">
            {responses.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelected((prev) => ({ ...prev, [task.id]: r.id }))}
                className={`rounded-full border px-2.5 py-0.5 text-xs ${
                  active?.id === r.id ? "border-brand bg-brand/10 text-brand" : "border-border text-muted hover:text-foreground"
                }`}
              >
                {r.label || `#${r.instance}`}
                {r.isComplete ? " ✓" : ""}
              </button>
            ))}
          </div>
        ) : null}

        {active && tagTypes.some((t) => t.values.length > 0) ? (
          <div className="border-b border-border px-5 py-2">
            <TagPicker
              types={tagTypes}
              selected={responseTags[active.id] ?? active.tagValueIds}
              disabled={readOnly}
              onChange={(ids) => saveResponseTags(active, ids)}
            />
            <p className="mt-1 text-[11px] text-muted">Photos taken for this response are filed with these tags.</p>
          </div>
        ) : null}

        <div className="divide-y divide-border">{task.questions.map((q) => renderQuestion(q, active?.id ?? null))}</div>

        {!readOnly ? (
          <div className="flex flex-wrap gap-2 px-5 pb-4">
            {task.isCompletable && active ? (
              <Button variant="secondary" disabled={busy !== null} onClick={() => setComplete(task, active, !active.isComplete)}>
                {active.isComplete ? "Mark incomplete" : "Mark complete"}
              </Button>
            ) : null}
            {task.isRepeatable ? (
              <Button variant="secondary" disabled={busy !== null} onClick={() => addResponse(task)}>
                Add another
              </Button>
            ) : null}
            {task.isRepeatable && active ? (
              <Button variant="ghost" disabled={busy !== null} onClick={() => deleteResponse(task, active)}>
                Delete this response
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {hasTasks ? (
        <div className="flex gap-1.5" role="tablist" aria-label="Filter tasks">
          {(["all", "incomplete", "complete"] as const).map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={`rounded-lg border px-3 py-1.5 text-sm capitalize ${
                filter === f ? "border-brand bg-brand/10 text-brand" : "border-border text-muted"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-lg border border-[var(--band-critical)] px-3 py-2 text-sm text-[var(--band-critical)]">
          {error}
        </p>
      ) : null}

      {sections.map((section) => {
        const tasks = section.tasks.filter(taskVisible);
        if (section.questions.length === 0 && tasks.length === 0) return null;
        return (
          <div key={section.id} className="overflow-hidden rounded-xl border border-border bg-surface">
            <div className="border-b border-border px-5 py-3">
              <h3 className="text-sm font-semibold text-foreground">{section.name}</h3>
            </div>
            {section.questions.length > 0 ? (
              <div className="divide-y divide-border">{section.questions.map((q) => renderQuestion(q, null))}</div>
            ) : null}
            {tasks.map(renderTask)}
          </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-2">
        {canComplete ? (
          <Button onClick={() => changeStatus("COMPLETED")} disabled={busy !== null}>
            {busy === "status:COMPLETED" ? "Completing..." : "Complete Assessment"}
          </Button>
        ) : null}
        {canRelease ? (
          <Button onClick={() => changeStatus("RELEASED")} disabled={busy !== null}>
            {busy === "status:RELEASED" ? "Releasing..." : "Release to client"}
          </Button>
        ) : null}
        {canReopen ? (
          <Button variant="secondary" onClick={() => changeStatus("IN_PROGRESS")} disabled={busy !== null}>
            Reopen
          </Button>
        ) : null}
        {readOnly ? (
          <p className="text-sm text-muted">
            {status === "COMPLETED" || status === "RELEASED"
              ? `This assessment is ${status.toLowerCase()} and its answers are locked.`
              : "You can view this assessment; only its inspector or a template manager can answer it."}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** The stored values of an answer, so saving one field does not wipe the others. */
function answerValues(answer: Answer | undefined): AnswerPatch {
  if (!answer) return {};
  return {
    textValue: answer.textValue,
    numberValue: answer.numberValue,
    boolValue: answer.boolValue,
    conditionValue: answer.conditionValue,
    selectValues: answer.selectValues,
  };
}

function FileInput({
  question,
  files,
  disabled,
  onFiles,
}: {
  question: Question;
  files: AnswerFile[];
  disabled: boolean;
  onFiles: (files: File[]) => void;
}) {
  const accept = question.type === "VIDEO" ? "video/*" : "image/*";
  return (
    <div className="space-y-2">
      {files.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {files.map((f) =>
            f.type === "VIDEO" ? (
              <a key={f.id} href={`/api/v1/evidence/${f.id}/content`} className="text-xs text-brand underline">
                Video
              </a>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- same-origin evidence bytes, not a static asset
              <img
                key={f.id}
                src={`/api/v1/evidence/${f.id}/content?size=small`}
                alt={`${question.prompt} photo`}
                className="h-20 w-20 rounded-lg border border-border object-cover"
              />
            ),
          )}
        </div>
      ) : (
        <p className="text-xs text-muted">No {question.type === "VIDEO" ? "video" : "photos"} yet.</p>
      )}
      {!disabled ? (
        <label className="inline-flex cursor-pointer items-center rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-zinc-50">
          {question.type === "VIDEO" ? "Add video" : "Add photos"}
          <input
            type="file"
            accept={accept}
            capture="environment"
            multiple={question.type !== "VIDEO"}
            className="sr-only"
            onChange={(e) => {
              // Copied before the reset: the FileList is live, and clearing the
              // input empties it under the upload that is still reading it.
              const picked = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (picked.length > 0) onFiles(picked);
            }}
          />
        </label>
      ) : null}
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
  onSave: (patch: AnswerPatch) => void;
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
          const selected = Array.from(e.target.selectedOptions).map((o) => o.value).filter(Boolean);
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
  if (NOTE_TYPES.has(question.type)) {
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
