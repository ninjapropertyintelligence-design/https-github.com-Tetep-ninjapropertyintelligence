import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ApiError, withApiHandler } from "@/lib/api-utils";
import { canAccessProperty } from "@/lib/session-context";
import { ORG_WIDE_ROLES } from "@/lib/permissions";
import { getStorageProvider } from "@/lib/storage";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/documents/[id]/download?version=N — sends the caller to a
 * short-lived storage URL for one version (the latest by default).
 *
 * A document inherits its property's scope; one with no property is an
 * organization-level record that only org-wide roles reach. Not found, not
 * forbidden, outside scope: whether a document exists is itself information.
 */
export const GET = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  const document = await prisma.document.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!document) throw new ApiError(404, "Document not found");
  const allowed = document.propertyId ? await canAccessProperty(ctx, document.propertyId) : ORG_WIDE_ROLES.includes(ctx.role);
  if (!allowed) throw new ApiError(404, "Document not found");

  const requested = new URL(req.url).searchParams.get("version");
  const version = await prisma.documentVersion.findFirst({
    where: { documentId: document.id, ...(requested ? { versionNumber: Number(requested) } : {}) },
    orderBy: { versionNumber: "desc" },
  });
  if (!version) throw new ApiError(404, requested ? "That version does not exist" : "This document has no uploaded file yet");
  // Resolved against the request: the local provider signs a relative path,
  // and a redirect needs an absolute URL. An S3 URL is absolute and unchanged.
  const target = new URL(await getStorageProvider().getDownloadUrl(version.storageKey), req.url);
  return NextResponse.redirect(target, 302);
});
