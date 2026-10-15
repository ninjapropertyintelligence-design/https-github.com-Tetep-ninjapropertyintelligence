import { randomBytes } from "node:crypto";
import { presignS3Url } from "@/lib/s3-signer";
import { withObservability } from "@/lib/observability";

/**
 * Turning a full-resolution drone map into Mapbox raster tiles, for deep zoom.
 *
 * A drone map is often gigabytes; no browser can open it whole. Mapbox's
 * Uploads API cuts a GeoTIFF into tiles and hosts them, and the map then
 * loads only the tiles in view, at full detail — the way DroneDeploy shows
 * its own maps.
 *
 * Needs a SECRET token (scopes uploads:read, uploads:write) and the account's
 * username: the public token that draws maps cannot upload. The tileset then
 * belongs to that account and is drawn with its public token, so the public
 * NEXT_PUBLIC_MAPBOX_TOKEN must come from the same Mapbox account.
 *
 * Flow (https://docs.mapbox.com/api/maps/uploads/):
 *   1. POST /uploads/v1/{user}/credentials → temporary S3 credentials for a
 *      staging object.
 *   2. PUT the GeoTIFF there (here: a presigned PUT, streamed from our store).
 *   3. POST /uploads/v1/{user} with that object's URL and a tileset id.
 *   4. GET /uploads/v1/{user}/{upload} until complete or error.
 */

const API = process.env.MAPBOX_API_URL ?? "https://api.mapbox.com";

export function mapboxTilingConfig(): { token: string; username: string } | null {
  const token = process.env.MAPBOX_UPLOAD_TOKEN?.trim();
  const username = process.env.MAPBOX_USERNAME?.trim();
  return token && username ? { token, username } : null;
}

export class MapboxTilingError extends Error {}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const config = mapboxTilingConfig();
  if (!config) throw new MapboxTilingError("Mapbox tiling is not configured (MAPBOX_UPLOAD_TOKEN, MAPBOX_USERNAME)");
  const url = `${API}${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(config.token)}`;
  return withObservability("mapbox.api_call", { provider: "mapbox" }, async () => {
    const res = await fetch(url, init);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new MapboxTilingError(`Mapbox returned ${res.status}: ${body.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  });
}

interface StagingCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  bucket: string;
  key: string;
  url: string;
}

/**
 * A tileset id that cannot be guessed. Mapbox tilesets are drawn with the
 * account's public token, which every visitor's browser holds; the id is what
 * keeps one customer's imagery from being fetched by anyone who reads it.
 */
export function newTilesetId(username: string): string {
  return `${username}.pi-${randomBytes(12).toString("hex")}`;
}

/**
 * Copies a GeoTIFF into Mapbox's staging area and starts tiling it.
 * The bytes are streamed from `sourceUrl` (our store) — never held in memory.
 */
export async function startMapboxTiling(params: {
  sourceUrl: string;
  sizeBytes: number;
  name: string;
}): Promise<{ uploadId: string; tileset: string }> {
  const config = mapboxTilingConfig();
  if (!config) throw new MapboxTilingError("Mapbox tiling is not configured");

  const creds = await call<StagingCredentials>(`/uploads/v1/${config.username}/credentials`, { method: "POST" });
  const put = presignS3Url(
    {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      sessionToken: creds.sessionToken,
      region: "us-east-1",
      endpoint: "https://s3.amazonaws.com",
      bucket: creds.bucket,
      forcePathStyle: false,
    },
    { method: "PUT", key: creds.key, expiresInSeconds: 3600 },
  );

  const source = await fetch(params.sourceUrl);
  if (!source.ok || !source.body) throw new MapboxTilingError(`Reading the map from storage failed (HTTP ${source.status})`);
  const staged = await fetch(put.url, {
    method: "PUT",
    body: source.body,
    headers: { "Content-Length": String(params.sizeBytes) },
    // Node's fetch streams a request body only in half-duplex mode.
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  if (!staged.ok) throw new MapboxTilingError(`Staging the map at Mapbox failed (HTTP ${staged.status})`);

  const tileset = newTilesetId(config.username);
  const upload = await call<{ id: string }>(`/uploads/v1/${config.username}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: creds.url, tileset, name: params.name.slice(0, 64) }),
  });
  return { uploadId: upload.id, tileset };
}

export type MapboxUploadState =
  | { state: "PROCESSING"; progress: number }
  | { state: "READY" }
  | { state: "FAILED"; error: string };

export async function getMapboxUpload(uploadId: string): Promise<MapboxUploadState> {
  const config = mapboxTilingConfig();
  if (!config) throw new MapboxTilingError("Mapbox tiling is not configured");
  const upload = await call<{ complete: boolean; error: string | null; progress: number }>(
    `/uploads/v1/${config.username}/${encodeURIComponent(uploadId)}`,
  );
  if (upload.error) return { state: "FAILED", error: upload.error };
  if (upload.complete) return { state: "READY" };
  return { state: "PROCESSING", progress: upload.progress ?? 0 };
}
