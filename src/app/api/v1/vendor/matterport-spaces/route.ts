import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api-utils";
import { listVendorMatterportSpaces } from "@/lib/vendor-connection-service";

// GET /api/v1/vendor/matterport-spaces — the scans in the vendor's own Matterport account.
export const GET = withApiHandler(async (ctx) => NextResponse.json({ items: await listVendorMatterportSpaces(ctx) }));
