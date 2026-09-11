import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { __setStorageProviderForTest, getStorageProvider, type StorageProvider } from "@/lib/storage";

/**
 * The S3 provider is exercised against a real HTTP server that behaves like an
 * S3-compatible store, rather than against a mocked `fetch`.
 *
 * The distinction matters. A mock asserts that we called a function with the
 * arguments we expected — which is a restatement of the implementation, not a
 * test of it. This server instead *independently recomputes the SigV4
 * signature* from the raw request line and rejects anything that does not
 * match, exactly as a real store would. A signing bug fails here for the same
 * reason it would fail in production.
 *
 * The verifier below is written straight from the AWS pseudocode and shares no
 * code with `src/lib/s3-signer.ts`, so the two cannot be wrong in the same way.
 */

const ACCESS_KEY = "AKIAIOSFODNN7EXAMPLE";
const SECRET_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const REGION = "us-east-1";
const BUCKET = "test-bucket";

interface StoredObject {
  body: Buffer;
  sha256Base64: string;
}

const objects = new Map<string, StoredObject>();
/** Requests the fake store rejected, so tests can assert on *why*. */
const rejections: { reason: string; url: string }[] = [];

const hmac = (k: Buffer | string, d: string) => crypto.createHmac("sha256", k).update(d, "utf8").digest();

/** Independent re-implementation of SigV4 query presigning, per AWS pseudocode. */
function independentlyVerifySignature(method: string, url: URL, host: string): string | null {
  const provided = url.searchParams.get("X-Amz-Signature");
  if (!provided) return "missing X-Amz-Signature";

  const amzDate = url.searchParams.get("X-Amz-Date");
  const credential = url.searchParams.get("X-Amz-Credential");
  const expires = url.searchParams.get("X-Amz-Expires");
  if (!amzDate || !credential || !expires) return "missing required query parameters";

  const [accessKey, dateStamp, region, service] = credential.split("/");
  if (accessKey !== ACCESS_KEY) return "unknown access key";

  // Rebuild the canonical query string from everything except the signature.
  const params: [string, string][] = [];
  url.searchParams.forEach((v, k) => {
    if (k !== "X-Amz-Signature") params.push([k, v]);
  });
  const encode = (s: string) =>
    encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  const canonicalQuery = params
    .map(([k, v]) => [encode(k), encode(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const canonicalRequest = [
    method,
    url.pathname,
    canonicalQuery,
    `host:${host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    crypto.createHash("sha256").update(canonicalRequest, "utf8").digest("hex"),
  ].join("\n");

  const signingKey = hmac(hmac(hmac(hmac(`AWS4${SECRET_KEY}`, dateStamp), region), service), "aws4_request");
  const expected = crypto.createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  if (expected !== provided) return "signature mismatch";

  // Expiry is part of the contract, not decoration.
  const signedAt = Date.parse(
    `${amzDate.slice(0, 4)}-${amzDate.slice(4, 6)}-${amzDate.slice(6, 8)}T` +
      `${amzDate.slice(9, 11)}:${amzDate.slice(11, 13)}:${amzDate.slice(13, 15)}Z`,
  );
  if (Date.now() > signedAt + Number(expires) * 1000) return "expired";

  return null;
}

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const host = req.headers.host ?? "";
    const url = new URL(req.url ?? "/", `http://${host}`);
    const failure = independentlyVerifySignature(req.method ?? "GET", url, host);
    if (failure) {
      rejections.push({ reason: failure, url: url.pathname });
      res.writeHead(403).end(failure);
      return;
    }

    const prefix = `/${BUCKET}/`;
    if (!url.pathname.startsWith(prefix)) {
      res.writeHead(400).end("bad bucket path");
      return;
    }
    const key = decodeURIComponent(url.pathname.slice(prefix.length));

    if (req.method === "PUT") {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks);
        objects.set(key, {
          body,
          sha256Base64: crypto.createHash("sha256").update(body).digest("base64"),
        });
        res.writeHead(200).end();
      });
      return;
    }

    const obj = objects.get(key);
    if (req.method === "HEAD") {
      if (!obj) {
        res.writeHead(404).end();
        return;
      }
      const headers: Record<string, string> = { "content-length": String(obj.body.byteLength) };
      // Mirrors real S3: the stored checksum is only returned when asked for.
      if (req.headers["x-amz-checksum-mode"] === "ENABLED") {
        headers["x-amz-checksum-sha256"] = obj.sha256Base64;
      }
      res.writeHead(200, headers).end();
      return;
    }
    if (req.method === "GET") {
      if (!obj) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "content-length": String(obj.body.byteLength) }).end(obj.body);
      return;
    }
    if (req.method === "DELETE") {
      objects.delete(key);
      res.writeHead(204).end();
      return;
    }
    res.writeHead(405).end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;

  process.env.STORAGE_PROVIDER = "s3";
  process.env.STORAGE_BUCKET = BUCKET;
  process.env.STORAGE_REGION = REGION;
  process.env.STORAGE_ENDPOINT = baseUrl;
  process.env.STORAGE_ACCESS_KEY_ID = ACCESS_KEY;
  process.env.STORAGE_SECRET_ACCESS_KEY = SECRET_KEY;
  process.env.STORAGE_FORCE_PATH_STYLE = "true";
  __setStorageProviderForTest(null);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  __setStorageProviderForTest(null);
  process.env.STORAGE_PROVIDER = "local";
});

function provider(): StorageProvider {
  return getStorageProvider();
}

describe("S3 storage provider against a signature-verifying store", () => {
  it("writes and reads an object back byte for byte", async () => {
    const bytes = Buffer.from("property condition report, page 1");
    await provider().writeBytes("org-1/report.txt", bytes);
    const read = await provider().readBytes("org-1/report.txt");
    expect(read).not.toBeNull();
    expect(read!.equals(bytes)).toBe(true);
  });

  it("round-trips binary content without corruption", async () => {
    // Random bytes catch encoding mistakes that ASCII payloads hide.
    const bytes = crypto.randomBytes(4096);
    await provider().writeBytes("org-1/capture.bin", bytes);
    const read = await provider().readBytes("org-1/capture.bin");
    expect(read!.equals(bytes)).toBe(true);
  });

  it("reports size and a hex checksum for an uploaded object", async () => {
    const bytes = Buffer.from("drone frame");
    await provider().writeBytes("org-1/frame.jpg", bytes);
    const verification = await provider().verifyUpload("org-1/frame.jpg");
    expect(verification.exists).toBe(true);
    expect(verification.actualSizeBytes).toBe(bytes.byteLength);
    // The store speaks base64; the rest of the codebase speaks hex. If that
    // conversion were dropped, this would compare base64 to hex and fail.
    expect(verification.actualChecksumSha256).toBe(
      crypto.createHash("sha256").update(bytes).digest("hex"),
    );
  });

  it("reports a missing object as absent rather than throwing", async () => {
    const verification = await provider().verifyUpload("org-1/never-written");
    expect(verification.exists).toBe(false);
    expect(verification.actualSizeBytes).toBeNull();
  });

  it("returns null when reading a key that does not exist", async () => {
    expect(await provider().readBytes("org-1/absent")).toBeNull();
  });

  it("actually removes the bytes on delete", async () => {
    await provider().writeBytes("org-1/doomed.txt", Buffer.from("x"));
    expect((await provider().verifyUpload("org-1/doomed.txt")).exists).toBe(true);
    await provider().delete("org-1/doomed.txt");
    expect((await provider().verifyUpload("org-1/doomed.txt")).exists).toBe(false);
  });

  it("treats deleting an already-absent key as success", async () => {
    // Secure deletion retries and must converge; "already gone" is the goal.
    await expect(provider().delete("org-1/never-existed")).resolves.toBeUndefined();
  });

  it("mints an upload URL the store accepts, scoped to the organization", async () => {
    const signed = await provider().createUploadUrl({
      organizationId: "org-42",
      filename: "site survey.pdf",
      contentType: "application/pdf",
    });
    expect(signed.method).toBe("PUT");
    expect(signed.key.startsWith("org-42/")).toBe(true);

    // Upload through the minted URL exactly as a browser would.
    const res = await fetch(signed.url, { method: "PUT", body: "pdf-bytes" });
    expect(res.status).toBe(200);
    expect((await provider().verifyUpload(signed.key)).exists).toBe(true);
  });

  it("mints a download URL the store accepts", async () => {
    await provider().writeBytes("org-1/readable.txt", Buffer.from("hello"));
    const url = await provider().getDownloadUrl("org-1/readable.txt");
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
  });

  it("handles keys containing spaces and unicode", async () => {
    // These are the keys that break naive URI encoding, and a real customer
    // filename is far more likely to contain them than a test fixture is.
    const key = "org-1/Café Report (final) v2.pdf";
    const bytes = Buffer.from("unicode payload");
    await provider().writeBytes(key, bytes);
    const read = await provider().readBytes(key);
    expect(read!.equals(bytes)).toBe(true);
  });
});

describe("the fake store genuinely enforces signatures", () => {
  /**
   * Guards the test harness itself. If the server accepted anything, every
   * assertion above would pass against a broken signer — so prove it rejects.
   */
  it("rejects an unsigned request", async () => {
    const res = await fetch(`${baseUrl}/${BUCKET}/org-1/report.txt`);
    expect(res.status).toBe(403);
  });

  it("rejects a request whose signature has been tampered with", async () => {
    const url = await provider().getDownloadUrl("org-1/report.txt");
    const tampered = new URL(url);
    const sig = tampered.searchParams.get("X-Amz-Signature")!;
    // Flip one hex character.
    tampered.searchParams.set("X-Amz-Signature", (sig[0] === "a" ? "b" : "a") + sig.slice(1));
    const res = await fetch(tampered.toString());
    expect(res.status).toBe(403);
    expect(rejections.some((r) => r.reason === "signature mismatch")).toBe(true);
  });

  it("rejects a URL signed for a different key", async () => {
    // Swapping the path after signing must invalidate it, or a signed URL for
    // one tenant's object would authorise reading another's.
    const url = new URL(await provider().getDownloadUrl("org-1/report.txt"));
    url.pathname = `/${BUCKET}/org-2/secret.txt`;
    const res = await fetch(url.toString());
    expect(res.status).toBe(403);
  });

  it("rejects an expired signature", async () => {
    const { presignS3Url } = await import("@/lib/s3-signer");
    const { url } = presignS3Url(
      {
        accessKeyId: ACCESS_KEY,
        secretAccessKey: SECRET_KEY,
        region: REGION,
        endpoint: baseUrl,
        bucket: BUCKET,
        forcePathStyle: true,
      },
      {
        method: "GET",
        key: "org-1/report.txt",
        expiresInSeconds: 60,
        now: new Date(Date.now() - 120_000),
      },
    );
    const res = await fetch(url);
    expect(res.status).toBe(403);
    expect(rejections.some((r) => r.reason === "expired")).toBe(true);
  });
});
