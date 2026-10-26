import Link from "next/link";
import { redirect } from "next/navigation";
import { can, getSessionContext } from "@/lib/session-context";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { listActivity, listTeamMembers, type ActivityKind } from "@/lib/team-activity-service";
import { formatDateTime, formatRelativeTime } from "@/lib/format";

const KINDS: Array<{ value: ActivityKind; label: string }> = [
  { value: "all", label: "Everything" },
  { value: "logins", label: "Sign-ins" },
  { value: "changes", label: "Changes" },
  { value: "views", label: "Pages used" },
];

const KIND_STYLE: Record<string, string> = {
  login: "border-blue-200 bg-blue-50 text-blue-700",
  change: "border-amber-200 bg-amber-50 text-amber-700",
  view: "border-zinc-200 bg-zinc-50 text-zinc-600",
};
const KIND_LABEL: Record<string, string> = { login: "sign-in", change: "change", view: "page" };

const selectClass =
  "rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-brand";

/**
 * What the team has been doing: sign-ins, changes, and pages used, newest
 * first, for everyone or for one person. Owners and Portfolio Admins.
 *
 * The filters are a plain GET form, so a filtered view is a link that can be
 * shared and works without client script.
 */
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.organizationId || !can(ctx, "canViewTeamActivity")) redirect("/dashboard");

  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const members = await listTeamMembers(ctx);
  const userParam = one(params.user);
  const userId = members.some((m) => m.userId === userParam) ? userParam : "";
  const kindParam = one(params.kind) as ActivityKind;
  const kind: ActivityKind = KINDS.some((k) => k.value === kindParam) ? kindParam : "all";
  const beforeParam = one(params.before);
  const before = beforeParam && !Number.isNaN(Date.parse(beforeParam)) ? new Date(beforeParam) : null;

  const { entries, hasMore } = await listActivity(ctx, { userId: userId || null, kind, before });
  const person = members.find((m) => m.userId === userId) ?? null;

  const linkWith = (extra: Record<string, string>) => {
    const q = new URLSearchParams();
    if (userId) q.set("user", userId);
    if (kind !== "all") q.set("kind", kind);
    for (const [k, v] of Object.entries(extra)) q.set(k, v);
    return `/settings/activity?${q.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Activity</h1>
        <p className="text-sm text-muted">Who signed in, what they changed, and which pages they used</p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="block text-xs font-medium text-muted">
          Person
          <select name="user" defaultValue={userId} className={`mt-1 block ${selectClass}`}>
            <option value="">Everyone</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name} — {m.roleLabel}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-medium text-muted">
          Show
          <select name="kind" defaultValue={kind} className={`mt-1 block ${selectClass}`}>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-lg bg-brand px-3.5 py-2 text-sm font-medium text-brand-foreground hover:bg-brand/90"
        >
          Apply
        </button>
        {userId || kind !== "all" ? (
          <Link href="/settings/activity" className="py-2 text-sm text-muted hover:text-foreground">
            Clear
          </Link>
        ) : null}
      </form>

      {person ? (
        <Card>
          <CardBody className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
            <div>
              <p className="text-xs text-muted">Person</p>
              <p className="font-medium text-foreground">{person.name}</p>
              <p className="text-xs text-muted">
                {person.roleLabel} · {person.email}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted">Can see</p>
              {person.access.map((line) => (
                <p key={line} className="text-foreground">
                  {line}
                </p>
              ))}
            </div>
            <div>
              <p className="text-xs text-muted">Last sign-in</p>
              <p className="text-foreground">{person.lastSignInAt ? formatDateTime(person.lastSignInAt) : "Never"}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Last active</p>
              <p className="text-foreground">{person.lastActiveAt ? formatDateTime(person.lastActiveAt) : "Never"}</p>
            </div>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title={person ? `${person.name}'s activity` : "All activity"}
          subtitle={before ? `Before ${formatDateTime(before)}` : "Newest first"}
        />
        <CardBody className="p-0">
          {entries.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted">Nothing recorded for this filter yet.</p>
          ) : (
            <ul>
              {entries.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-2.5 text-sm last:border-0">
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${KIND_STYLE[e.kind]}`}
                    >
                      {KIND_LABEL[e.kind]}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-foreground">
                        {e.userId && !person ? (
                          <Link href={linkWith({ user: e.userId })} className="font-medium hover:text-brand">
                            {e.userName ?? "Former member"}
                          </Link>
                        ) : person ? null : (
                          <span className="font-medium">System</span>
                        )}
                        {person ? "" : " · "}
                        {e.description}
                      </p>
                      {e.bySupport ? <p className="text-xs text-muted">By the platform support team</p> : null}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-muted" title={formatDateTime(e.at)}>
                    {formatRelativeTime(e.at)}
                    {e.ipAddress ? ` · ${e.ipAddress}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
        {hasMore && entries.length > 0 ? (
          <div className="border-t border-border px-5 py-3 text-right">
            <Link
              href={linkWith({ before: entries[entries.length - 1].at.toISOString() })}
              className="text-sm font-medium text-brand hover:underline"
            >
              Older →
            </Link>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
