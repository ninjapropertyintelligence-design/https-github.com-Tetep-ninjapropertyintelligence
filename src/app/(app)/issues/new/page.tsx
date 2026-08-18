import { redirect } from "next/navigation";
import { getSessionContext, propertyScopeWhere, can } from "@/lib/session-context";
import { prisma } from "@/lib/prisma";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { CreateIssueForm } from "@/components/issue/CreateIssueForm";

export default async function NewIssuePage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!can(ctx, "canCreateIssues")) redirect("/issues");

  const properties = await prisma.property.findMany({
    where: propertyScopeWhere(ctx),
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-foreground">Create Issue</h1>
      <Card>
        <CardHeader title="New Issue" />
        <CardBody>
          <CreateIssueForm properties={properties} />
        </CardBody>
      </Card>
    </div>
  );
}
