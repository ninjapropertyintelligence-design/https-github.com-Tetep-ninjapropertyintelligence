"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { apiRequest } from "@/components/settings/api-request";

const SELECT = "rounded-lg border border-border px-3 py-1.5 text-sm";

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function act(url: string, init: RequestInit) {
    setBusy(true);
    setError(null);
    const res = await apiRequest(url, init);
    setBusy(false);
    if (!res.ok) setError(res.error);
    else router.refresh();
    return res;
  }
  return { busy, error, act };
}

function ErrorText({ error }: { error: string | null }) {
  return error ? <p className="text-sm text-[var(--band-critical)]">{error}</p> : null;
}

const STATUS_LABELS: Record<string, string> = { NEW: "New", IN_PROGRESS: "In Progress", PUBLISHED: "Published", COMPLETED: "Completed" };

export function ProjectStatusSelect({ projectId, status }: { projectId: string; status: string }) {
  const { busy, error, act } = useAction();
  return (
    <div className="space-y-1">
      <select
        aria-label="Project status"
        disabled={busy}
        defaultValue={status}
        className={SELECT}
        onChange={(e) => act(`/api/v1/projects/${projectId}`, { method: "PATCH", body: JSON.stringify({ status: e.target.value }) })}
      >
        {Object.entries(STATUS_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <ErrorText error={error} />
    </div>
  );
}

export function AddProjectMember({ projectId, candidates }: { projectId: string; candidates: Array<{ id: string; name: string }> }) {
  const { busy, error, act } = useAction();
  const [userId, setUserId] = useState("");
  if (candidates.length === 0) return null;
  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <select aria-label="Person to add" value={userId} onChange={(e) => setUserId(e.target.value)} className={SELECT}>
          <option value="">Add a team member…</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <Button
          variant="secondary"
          disabled={busy || !userId}
          onClick={async () => {
            const res = await act(`/api/v1/projects/${projectId}/members`, { method: "POST", body: JSON.stringify({ userId }) });
            if (res.ok) setUserId("");
          }}
        >
          Add
        </Button>
      </div>
      <ErrorText error={error} />
    </div>
  );
}

export function ToggleMemberActive({ projectId, memberId, isActive }: { projectId: string; memberId: string; isActive: boolean }) {
  const { busy, act } = useAction();
  return (
    <Button
      variant="ghost"
      disabled={busy}
      onClick={() => act(`/api/v1/projects/${projectId}/members/${memberId}`, { method: "PATCH", body: JSON.stringify({ isActive: !isActive }) })}
    >
      {isActive ? "Mark inactive" : "Mark active"}
    </Button>
  );
}

export function AttachDocument({ projectId, documents }: { projectId: string; documents: Array<{ id: string; title: string }> }) {
  const { busy, error, act } = useAction();
  const [documentId, setDocumentId] = useState("");
  if (documents.length === 0) return null;
  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <select aria-label="Document to file" value={documentId} onChange={(e) => setDocumentId(e.target.value)} className={SELECT}>
          <option value="">File a property document here…</option>
          {documents.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </select>
        <Button
          variant="secondary"
          disabled={busy || !documentId}
          onClick={async () => {
            const res = await act(`/api/v1/projects/${projectId}/documents`, { method: "POST", body: JSON.stringify({ documentId }) });
            if (res.ok) setDocumentId("");
          }}
        >
          File
        </Button>
      </div>
      <ErrorText error={error} />
    </div>
  );
}

export function DetachDocument({ projectId, documentId }: { projectId: string; documentId: string }) {
  const { busy, act } = useAction();
  return (
    <Button
      variant="ghost"
      disabled={busy}
      onClick={() => act(`/api/v1/projects/${projectId}/documents`, { method: "POST", body: JSON.stringify({ documentId, attached: false }) })}
    >
      Remove from project
    </Button>
  );
}

export function ScheduleProjectAssessment({
  projectId,
  propertyId,
  templates,
  inspectors,
}: {
  projectId: string;
  propertyId: string;
  templates: Array<{ id: string; name: string }>;
  inspectors: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const { busy, error, act } = useAction();
  const [templateId, setTemplateId] = useState("");
  const [inspectorId, setInspectorId] = useState("");
  if (templates.length === 0) return null;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-2">
        <select aria-label="Template" value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={SELECT}>
          <option value="">Template…</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select aria-label="Inspector" value={inspectorId} onChange={(e) => setInspectorId(e.target.value)} className={SELECT}>
          <option value="">Assign to me</option>
          {inspectors.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <Button
          variant="secondary"
          disabled={busy || !templateId}
          onClick={async () => {
            const res = await act("/api/v1/assessments", {
              method: "POST",
              body: JSON.stringify({ propertyId, templateId, projectId, inspectorId: inspectorId || undefined }),
            });
            if (res.ok && res.data?.id) router.push(`/assessments/${res.data.id}`);
          }}
        >
          Schedule assessment
        </Button>
      </div>
      <ErrorText error={error} />
    </div>
  );
}
