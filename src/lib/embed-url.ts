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
  VIDEO: "Video",
  OTHER: "Custom embed",
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

/**
 * The viewer link for a Matterport model id, or null when the id is not one.
 * Model ids are short alphanumeric strings; anything else (a pasted URL, a
 * path) is refused rather than spliced into a link.
 */
export function matterportShowUrl(modelId: string): string | null {
  return /^[A-Za-z0-9]{5,40}$/.test(modelId) ? `https://my.matterport.com/show/?m=${modelId}` : null;
}

/**
 * What to put in the iframe for an embed. A video's share link (YouTube
 * watch/short/youtu.be, Vimeo) is turned into the provider's player URL,
 * since the page a person copies refuses to be framed; anything else is used
 * as given.
 */
export function embedFrameSrc(kind: SpatialEmbedKind, raw: string): string {
  if (kind !== "VIDEO") return raw;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "");
  const id = (value: string | null | undefined) => (value && /^[A-Za-z0-9_-]{6,20}$/.test(value) ? value : null);
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const videoId =
      url.pathname === "/watch"
        ? id(url.searchParams.get("v"))
        : id(url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1]);
    if (videoId) return `https://www.youtube-nocookie.com/embed/${videoId}`;
  }
  if (host === "youtu.be") {
    const videoId = id(url.pathname.slice(1));
    if (videoId) return `https://www.youtube-nocookie.com/embed/${videoId}`;
  }
  if (host === "vimeo.com") {
    const videoId = url.pathname.match(/^\/(\d{4,12})/)?.[1];
    if (videoId) return `https://player.vimeo.com/video/${videoId}`;
  }
  return raw;
}
