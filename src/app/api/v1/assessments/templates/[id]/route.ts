import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { getTemplateDefinition, replaceTemplate, setTemplateActive } from "@/lib/template-service";
import { z } from "zod";

type RouteParams = { params: Promise<{ id: string }> };

export const GET = withApiHandler<NextResponse, RouteParams>(async (ctx, _req, { params }) => {
  const { id } = await params;
  return NextResponse.json(await getTemplateDefinition(ctx, id));
});

// PUT — replace the template's contents. Refused with 409 once an assessment has used it.
export const PUT = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  return NextResponse.json(await replaceTemplate(ctx, id, await req.json()));
});

const patchSchema = z.object({ isActive: z.boolean() });

// PATCH — retire a template from new assessments, or bring it back.
export const PATCH = withApiHandler<NextResponse, RouteParams>(async (ctx, req, { params }) => {
  const { id } = await params;
  return NextResponse.json(await setTemplateActive(ctx, id, patchSchema.parse(await req.json()).isActive));
});
