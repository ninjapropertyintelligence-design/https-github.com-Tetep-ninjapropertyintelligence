import crypto from "node:crypto";

/**
 * AWS SIGNATURE VERSION 4 — query-string presigning.
 *
 * Why this exists rather than `@aws-sdk/client-s3`: the storage design
 * (spec §18-19) hands signed URLs to the *browser* so large capture files
 * upload directly to storage and never transit the app server. That needs a
 * URL, not an SDK call, so presigning is required either way. Expressing the
 * server-side operations (HEAD/GET/PUT/DELETE) as presigned fetches too means
 * there is exactly one signing path in the codebase instead of two.
 *
 * Hand-rolled crypto earns scepticism, so this is held to the same bar as the
 * TOTP implementation: asserted against the signing vectors AWS publishes, and
 * mutation-tested so a change to any signed input provably changes the
 * signature. A wrong signature also fails loudly (403 from the store) rather
 * than corrupting anything silently.
 *
 * Reference: AWS "Signature Version 4 signing process", query parameter variant.
 */

const ALGORITHM = "AWS4-HMAC-SHA256";
const SERVICE = "s3";
/**
 * Presigned requests sign the *absence* of a payload hash. This is required for
 * browser uploads (the browser cannot hash the body before the URL is minted)
 * and is the documented value for the query-parameter variant.
 */
const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";

export interface S3SignerConfig {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  /** Origin only, e.g. https://xyz.supabase.co/storage/v1/s3 or https://s3.us-east-1.amazonaws.com */
  endpoint: string;
  bucket: string;
  /**
   * Path-style puts the bucket in the URL path (https://host/bucket/key);
   * virtual-host style puts it in the hostname (https://bucket.host/key).
   * Supabase, MinIO and R2 are path-style; AWS S3 proper prefers virtual-host.
   */
  forcePathStyle: boolean;
  /** Session token for temporary credentials (STS). Optional. */
  sessionToken?: string;
}

/**
 * RFC 3986 encoding. `encodeURIComponent` leaves !'()* unescaped, but SigV4's
 * canonical form requires them escaped — a mismatch here produces a signature
 * that differs from the server's for any key containing those characters,
 * which is exactly the kind of bug that only shows up on a customer's oddly
 * named file months later.
 */
function uriEncode(value: string, encodeSlash: boolean): string {
  let out = "";
  for (const ch of value) {
    if (/[A-Za-z0-9\-._~]/.test(ch)) {
      out += ch;
    } else if (ch === "/") {
      out += encodeSlash ? "%2F" : "/";
    } else {
      for (const byte of Buffer.from(ch, "utf8")) {
        out += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
      }
    }
  }
  return out;
}

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

/** kSigning = HMAC(HMAC(HMAC(HMAC("AWS4"+secret, date), region), service), "aws4_request") */
export function deriveSigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string = SERVICE,
): Buffer {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

/** ISO8601 basic format: 20130524T000000Z, and its date-only prefix. */
export function formatAmzDate(date: Date): { amzDate: string; dateStamp: string } {
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

/**
 * Canonical query strings must be sorted by encoded key name, with encoded
 * values. Sorting on the *encoded* key matters: "X-Amz-Date" and "X-Amz-Expires"
 * order differently before and after encoding in some locales.
 */
function canonicalQueryString(params: Record<string, string>): string {
  return Object.keys(params)
    .map((k) => [uriEncode(k, true), uriEncode(params[k], true)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

export interface PresignParams {
  method: "GET" | "PUT" | "HEAD" | "DELETE";
  key: string;
  expiresInSeconds: number;
  /** Extra query parameters to include in the signature (e.g. response-content-type). */
  query?: Record<string, string>;
  /** Injectable for deterministic tests; defaults to now. */
  now?: Date;
}

export interface PresignResult {
  url: string;
  /** Exposed so callers can record/assert expiry without re-parsing the URL. */
  expiresAt: Date;
}

/**
 * Builds a presigned URL for a single object operation.
 *
 * Only `host` is signed. Signing more headers would oblige every caller —
 * including a browser we do not control — to send them byte-identically, and
 * any drift produces an opaque 403.
 */
export function presignS3Url(config: S3SignerConfig, params: PresignParams): PresignResult {
  if (params.expiresInSeconds <= 0 || params.expiresInSeconds > 604800) {
    // S3 rejects >7d outright; catching it here gives a clear error instead of
    // a signature the store will refuse for a reason it does not explain.
    throw new Error("Presigned URL expiry must be between 1 second and 7 days");
  }

  const now = params.now ?? new Date();
  const { amzDate, dateStamp } = formatAmzDate(now);
  const credentialScope = `${dateStamp}/${config.region}/${SERVICE}/aws4_request`;

  const endpoint = new URL(config.endpoint);
  const basePath = endpoint.pathname === "/" ? "" : endpoint.pathname.replace(/\/$/, "");

  let host: string;
  let canonicalUri: string;
  if (config.forcePathStyle) {
    host = endpoint.host;
    canonicalUri = `${basePath}/${uriEncode(config.bucket, true)}/${uriEncode(params.key, false)}`;
  } else {
    host = `${config.bucket}.${endpoint.host}`;
    canonicalUri = `${basePath}/${uriEncode(params.key, false)}`;
  }

  const query: Record<string, string> = {
    ...(params.query ?? {}),
    "X-Amz-Algorithm": ALGORITHM,
    "X-Amz-Credential": `${config.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(params.expiresInSeconds),
    "X-Amz-SignedHeaders": "host",
  };
  if (config.sessionToken) {
    query["X-Amz-Security-Token"] = config.sessionToken;
  }

  const canonicalRequest = [
    params.method,
    canonicalUri,
    canonicalQueryString(query),
    `host:${host}\n`,
    "host",
    UNSIGNED_PAYLOAD,
  ].join("\n");

  const stringToSign = [ALGORITHM, amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const signingKey = deriveSigningKey(config.secretAccessKey, dateStamp, config.region);
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  const finalQuery = `${canonicalQueryString(query)}&X-Amz-Signature=${signature}`;
  return {
    url: `${endpoint.protocol}//${host}${canonicalUri}?${finalQuery}`,
    expiresAt: new Date(now.getTime() + params.expiresInSeconds * 1000),
  };
}

/**
 * Exposed purely so tests can assert on the intermediate canonical form.
 * Signature bugs are much easier to localise when the canonical request is
 * visible than when only the final hex digest is.
 */
export function __buildCanonicalRequestForTest(
  config: S3SignerConfig,
  params: PresignParams,
): { canonicalRequest: string; stringToSign: string } {
  const now = params.now ?? new Date();
  const { amzDate, dateStamp } = formatAmzDate(now);
  const credentialScope = `${dateStamp}/${config.region}/${SERVICE}/aws4_request`;
  const endpoint = new URL(config.endpoint);
  const basePath = endpoint.pathname === "/" ? "" : endpoint.pathname.replace(/\/$/, "");
  const host = config.forcePathStyle ? endpoint.host : `${config.bucket}.${endpoint.host}`;
  const canonicalUri = config.forcePathStyle
    ? `${basePath}/${uriEncode(config.bucket, true)}/${uriEncode(params.key, false)}`
    : `${basePath}/${uriEncode(params.key, false)}`;

  const query: Record<string, string> = {
    ...(params.query ?? {}),
    "X-Amz-Algorithm": ALGORITHM,
    "X-Amz-Credential": `${config.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(params.expiresInSeconds),
    "X-Amz-SignedHeaders": "host",
  };
  if (config.sessionToken) query["X-Amz-Security-Token"] = config.sessionToken;

  const canonicalRequest = [
    params.method,
    canonicalUri,
    canonicalQueryString(query),
    `host:${host}\n`,
    "host",
    UNSIGNED_PAYLOAD,
  ].join("\n");
  const stringToSign = [ALGORITHM, amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  return { canonicalRequest, stringToSign };
}

export { uriEncode as __uriEncodeForTest };
