import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api-error";
import { SessionContext, propertyScopeWhere } from "@/lib/tenant-scope";
import { getLatestHealthSnapshot } from "@/lib/scoring";
import { getAIProvider } from "@/lib/ai/provider-factory";
import { NullProvider } from "@/lib/ai/providers/null-provider";

export interface OnboardingStep {
  key: string;
  label: string;
  done: boolean;
  detail: string;
}

/**
 * Deep Property Onboarding (spec Phase 2 §8) — tracks the concrete signals
 * that make one property a genuinely "deep" reference property: connected
 * interior/exterior capture, populated assets, a completed assessment,
 * documents, tracked issues, a calculable health score, and AI readiness.
 */
export async function getPropertyOnboardingStatus(ctx: SessionContext, propertyId: string) {
  const property = await prisma.property.findFirst({ where: { AND: [{ id: propertyId }, propertyScopeWhere(ctx)] } });
  if (!property) throw new ApiError(404, "Property not found");

  const [matterportLink, droneCapture, assetCount, completedAssessment, documentCount, issueCount, health] = await Promise.all([
    prisma.matterportPropertyLink.findFirst({ where: { propertyId } }),
    prisma.droneCapture.findFirst({ where: { propertyId, status: "READY" } }),
    prisma.asset.count({ where: { propertyId, status: "ACTIVE" } }),
    prisma.assessment.findFirst({ where: { propertyId, status: "COMPLETED" } }),
    prisma.document.count({ where: { propertyId } }),
    prisma.issue.count({ where: { propertyId } }),
    getLatestHealthSnapshot(propertyId),
  ]);

  const aiProvider = getAIProvider();
  const aiConfigured = !(aiProvider instanceof NullProvider);

  const steps: OnboardingStep[] = [
    { key: "property_details", label: "Property details", done: true, detail: `${property.name} — ${property.addressLine1}` },
    { key: "interior", label: "Interior connection", done: !!matterportLink, detail: matterportLink ? "Matterport space linked" : "No interior capture linked yet" },
    { key: "exterior", label: "Exterior capture", done: !!droneCapture, detail: droneCapture ? "Drone capture ready" : "No exterior capture uploaded yet" },
    { key: "assets", label: "Assets", done: assetCount > 0, detail: `${assetCount} active asset(s)` },
    { key: "assessment", label: "Assessment", done: !!completedAssessment, detail: completedAssessment ? "At least one completed assessment" : "No completed assessment yet" },
    { key: "issues", label: "Issues", done: issueCount > 0, detail: `${issueCount} issue(s) tracked` },
    { key: "documents", label: "Documents", done: documentCount > 0, detail: `${documentCount} document(s) uploaded` },
    { key: "health_calculable", label: "Property health calculable", done: !!health, detail: health ? `Health score ${health.healthScore}` : "No health snapshot computed yet" },
    {
      key: "ai_ready",
      label: "AI ready",
      done: aiConfigured && !!health,
      detail: !aiConfigured ? "No AI provider configured" : health ? "AI provider configured and data available" : "AI provider configured, but no health data yet",
    },
  ];

  const completedCount = steps.filter((s) => s.done).length;
  const completionPercent = Math.round((completedCount / steps.length) * 100);

  return { property, steps, completionPercent };
}
