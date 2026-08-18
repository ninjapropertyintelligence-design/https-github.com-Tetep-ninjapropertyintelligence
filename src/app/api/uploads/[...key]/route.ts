import { NextResponse } from "next/server";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { verifyStorageToken } from "@/lib/storage";

// Local disk-backed stand-in for a real object store's signed-URL endpoint
// (spec §18). Files land under LOCAL_STORAGE_ROOT, outside `public/`, so the
// only way to read or write one is through this HMAC-signature-checked
// route — the same trust boundary a real S3 presigned URL provides.
const LOCAL_STORAGE_ROOT = path.join(process.cwd(), ".local-storage");

function resolveSafePath(keyParts: string[]): string {
  const key = keyParts.map((p) => decodeURIComponent(p)).join("/");
  const resolved = path.join(LOCAL_STORAGE_ROOT, key);
  if (!resolved.startsWith(LOCAL_STORAGE_ROOT + path.sep)) {
    throw new Error("Invalid storage key");
  }
  return resolved;
}

function checkAuth(req: Request, keyParts: string[]): boolean {
  const url = new URL(req.url);
  const exp = Number(url.searchParams.get("exp"));
  const token = url.searchParams.get("token");
  if (!exp || !token) return false;
  const key = keyParts.map((p) => decodeURIComponent(p)).join("/");
  return verifyStorageToken(key, exp, token);
}

type RouteParams = { params: Promise<{ key: string[] }> };

export async function PUT(req: Request, { params }: RouteParams) {
  const { key } = await params;
  if (!checkAuth(req, key)) {
    return NextResponse.json({ error: "Invalid or expired upload URL" }, { status: 403 });
  }
  const filePath = resolveSafePath(key);
  await mkdir(path.dirname(filePath), { recursive: true });
  const bytes = Buffer.from(await req.arrayBuffer());
  await writeFile(filePath, bytes);
  return NextResponse.json({ ok: true, sizeBytes: bytes.length });
}

export async function GET(req: Request, { params }: RouteParams) {
  const { key } = await params;
  if (!checkAuth(req, key)) {
    return NextResponse.json({ error: "Invalid or expired download URL" }, { status: 403 });
  }
  const filePath = resolveSafePath(key);
  try {
    await stat(filePath);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const bytes = await readFile(filePath);
  return new NextResponse(bytes as unknown as BodyInit, {
    headers: { "content-type": "application/octet-stream" },
  });
}
