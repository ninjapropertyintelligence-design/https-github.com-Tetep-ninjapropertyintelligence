import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import {
  connectVendorDroneDeploy,
  connectVendorMatterport,
  disconnectVendorConnection,
  listVendorConnections,
} from "@/lib/vendor-connection-service";
import { z } from "zod";

const connectSchema = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("DRONEDEPLOY"), apiKey: z.string().min(1).max(500) }),
  z.object({
    provider: z.literal("MATTERPORT"),
    tokenId: z.string().min(1).max(500),
    tokenSecret: z.string().min(1).max(500),
  }),
]);

// GET /api/v1/vendor/connections — which of the vendor's accounts are connected. Never the keys.
export const GET = withApiHandler(async (ctx) => NextResponse.json({ items: await listVendorConnections(ctx) }));

// POST /api/v1/vendor/connections — connect (or replace) one account; the credentials are checked first.
export const POST = withApiHandler(async (ctx, req) => {
  const body = connectSchema.parse(await req.json());
  const items =
    body.provider === "DRONEDEPLOY"
      ? await connectVendorDroneDeploy(ctx, body.apiKey)
      : await connectVendorMatterport(ctx, body.tokenId, body.tokenSecret);
  return NextResponse.json({ items });
});

// DELETE /api/v1/vendor/connections?provider=DRONEDEPLOY — forget one account's credentials.
export const DELETE = withApiHandler(async (ctx, req) => {
  const provider = z.enum(["DRONEDEPLOY", "MATTERPORT"]).parse(new URL(req.url).searchParams.get("provider"));
  return NextResponse.json({ items: await disconnectVendorConnection(ctx, provider) });
});
