import type { SpatialEmbedKind } from "@/generated/prisma/client";

/**
 * Rules for the URLs a 3D embed may point at. Pure, so the page and the
 * server agree and the rules are testable.
 *
 * The URL is rendered as an iframe inside this app, so it must be https (a
 * plain-http frame is blocked as mixed content, and would be readable on the
 * wire anyway) and must not carry credentials. A Matterport embed must be a
 * Matterport share link — the one kind where a well-known host is the whole
 * point, and where a lookalike URL would be a convincing fake tour.
 */

export const EMBED_KIND_LABELS: Record<SpatialEmbedKind, string> = {
  MATTERPORT: "Matterport tour",
  POINT_CLOUD: "Point cloud",
  BIM: "BIM model",
  OTHER: "3D viewer",
};

/** Autodesk and most BIM viewers refuse to be framed, so they open in their own tab. */
export function opensInNewTab(kind: SpatialEmbedKind): boolean {
  return kind === "BIM";
}

export function embedUrlProblem(kind: SpatialEmbedKind, raw: string): string | null {
  if (raw.length > 2000) return "That link is too long";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "That is not a valid link";
  }
  if (url.protocol !== "https:") return "Embed links must start with https://";
  if (url.username || url.password) return "Embed links cannot contain a username or password";
  if (kind === "MATTERPORT" && !(url.hostname === "my.matterport.com" && url.pathname.startsWith("/show"))) {
    return "A Matterport tour must be a my.matterport.com/show link";
  }
  return null;
}
