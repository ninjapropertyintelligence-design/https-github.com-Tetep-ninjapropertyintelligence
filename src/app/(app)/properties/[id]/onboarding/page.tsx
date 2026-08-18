import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionContext, can } from "@/lib/session-context";
import { getPropertyOnboardingStatus } from "@/lib/property-onboarding-status";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";

/** Deep Property Setup (spec Phase 2 §8) — onboarding a real reference property end to end. */
export default async function PropertyOnboardingPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!can(ctx, "canManageProperties")) redirect("/dashboard");

  const { id } = await params;
  let data;
  try {
    data = await getPropertyOnboardingStatus(ctx, id);
  } catch {
    notFound();
  }

  const { property, steps, completionPercent } = data;

  const stepLinks: Record<string, string> = {
    interior: `/properties/${id}?tab=interior`,
    exterior: `/properties/${id}?tab=exterior`,
    assets: `/properties/${id}?tab=assets`,
    assessment: `/properties/${id}?tab=assessments`,
    issues: `/properties/${id}?tab=issues`,
    documents: `/properties/${id}?tab=documents`,
    health_calculable: `/properties/${id}?tab=overview`,
    ai_ready: `/properties/${id}?tab=ai`,
  };

  return (
    <div className="space-y-4">
      <div>
        <Link href={`/properties/${id}`} className="text-xs text-muted hover:text-brand">
          ← {property.name}
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-foreground">Deep Property Setup</h1>
        <p className="text-sm text-muted">Bring this property to a fully connected, demo-ready state.</p>
      </div>

      <Card>
        <CardHeader title="Property Data Completeness" />
        <CardBody>
          <div className="flex items-center gap-4">
            <div className="h-3 flex-1 overflow-hidden rounded-full bg-zinc-100">
              <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${completionPercent}%` }} />
            </div>
            <span className="text-lg font-semibold tabular-nums text-foreground">{completionPercent}%</span>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="p-0">
          <ol>
            {steps.map((step, idx) => (
              <li key={step.key} className="flex items-center justify-between border-b border-border px-5 py-3 text-sm last:border-0">
                <div className="flex items-center gap-3">
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                      step.done ? "bg-[var(--band-good)]/15 text-[var(--band-good)]" : "bg-zinc-100 text-muted"
                    }`}
                  >
                    {step.done ? "✓" : idx + 1}
                  </span>
                  <div>
                    <p className="font-medium text-foreground">{step.label}</p>
                    <p className="text-xs text-muted">{step.detail}</p>
                  </div>
                </div>
                {stepLinks[step.key] ? (
                  <Link href={stepLinks[step.key]} className="text-xs font-medium text-brand hover:underline">
                    Go →
                  </Link>
                ) : null}
              </li>
            ))}
          </ol>
        </CardBody>
      </Card>
    </div>
  );
}
