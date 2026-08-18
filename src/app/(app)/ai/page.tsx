import { redirect } from "next/navigation";
import { getSessionContext, can } from "@/lib/session-context";
import { prisma } from "@/lib/prisma";
import { AskAiInline } from "@/components/ai/AskAiInline";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { formatRelativeTime } from "@/lib/format";

const EXAMPLE_QUESTIONS: Record<string, string[]> = {
  OWNER: ["Which are my worst properties?", "What is our estimated capital exposure?", "What changed this month?"],
  PORTFOLIO_ADMIN: ["Which properties are missing Matterport or drone capture?", "What assessments are overdue?"],
  REGIONAL_MANAGER: ["Which stores in my region need attention?", "What changed this week?"],
  FACILITIES_MANAGER: ["What needs my attention today?", "Which assets need replacement?"],
  INSPECTOR: ["What do I need to inspect at my assigned properties?"],
  TECHNICIAN: ["What work do I need to complete today?"],
  VENDOR: ["What work is assigned to us?"],
  VIEWER: ["What is happening across my properties?"],
  PLATFORM_ADMIN: ["What is our overall AI usage this month?"],
};

export default async function AiPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!can(ctx, "canViewAI")) redirect("/dashboard");

  const recentLogs = await prisma.aIQueryLog.findMany({
    where: { organizationId: ctx.organizationId, userId: ctx.userId },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Ask Property AI</h1>
        <p className="text-sm text-muted">Scoped to exactly what you can see — {ctx.organizationName}</p>
      </div>

      <AskAiInline placeholder={EXAMPLE_QUESTIONS[ctx.role]?.[0] ?? "Ask a question about your properties"} />

      <div className="flex flex-wrap gap-2">
        {(EXAMPLE_QUESTIONS[ctx.role] ?? []).map((q) => (
          <span key={q} className="rounded-full border border-border px-3 py-1 text-xs text-muted">
            {q}
          </span>
        ))}
      </div>

      <Card>
        <CardHeader title="Your Recent Questions" />
        <CardBody className="p-0">
          {recentLogs.length === 0 ? (
            <p className="p-5 text-sm text-muted">No questions asked yet.</p>
          ) : (
            <ul>
              {recentLogs.map((log) => (
                <li key={log.id} className="border-b border-border px-5 py-3 text-sm last:border-0">
                  <p className="font-medium text-foreground">{log.question}</p>
                  <p className="mt-1 text-xs text-muted">{formatRelativeTime(log.createdAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
