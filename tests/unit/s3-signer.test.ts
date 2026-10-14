import { describe, expect, it } from "vitest";
import {
  __buildCanonicalRequestForTest,
  __uriEncodeForTest,
  deriveSigningKey,
  formatAmzDate,
  presignS3Url,
  type S3SignerConfig,
} from "@/lib/s3-signer";

/**
 * Hand-rolled request signing is only trustworthy if it reproduces the
 * reference implementation bit for bit, so these assert against the vectors
 * AWS publishes in the Signature Version 4 documentation rather than against
 * values this code produced (which would only prove it is self-consistent).
 */

// AWS docs, "Authenticating Requests: Using Query Parameters" — the canonical
// presigned GET example for s3.
const AWS_PRESIGN_VECTOR = {
  config: {
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    region: "us-east-1",
    endpoint: "https://s3.amazonaws.com",
    bucket: "examplebucket",
    forcePathStyle: false,
  } satisfies S3SignerConfig,
  key: "test.txt",
  now: new Date("2013-05-24T00:00:00Z"),
  expiresInSeconds: 86400,
  expectedCanonicalRequest: [
    "GET",
    "/test.txt",
    "X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host",
    "host:examplebucket.s3.amazonaws.com\n",
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n"),
  expectedStringToSign: [
    "AWS4-HMAC-SHA256",
    "20130524T000000Z",
    "20130524/us-east-1/s3/aws4_request",
    "3bfa292879f6447bbcda7001decf97f4a54dc650c8942174ae0a9121cf58ad04",
  ].join("\n"),
  expectedSignature: "aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
};

describe("SigV4 signing key derivation", () => {
  /**
   * There is deliberately no standalone "expected hex" vector here.
   *
   * Correctness of the derivation is established externally by the S3 presign
   * vector below: that signature is HMAC(deriveSigningKey(...), stringToSign),
   * so it cannot match AWS's published value unless the derived key is right.
   * Pinning a hex constant produced by this same code would look like
   * independent validation while only proving self-consistency — which is
   * worse than no assertion, because it reads as evidence.
   *
   * What is worth asserting here is that every input actually participates.
   */
  it("produces a different key for a different date, region, or service", () => {
    const base = deriveSigningKey("secret", "20240101", "us-east-1", "s3").toString("hex");
    expect(deriveSigningKey("secret", "20240102", "us-east-1", "s3").toString("hex")).not.toBe(base);
    expect(deriveSigningKey("secret", "20240101", "eu-west-1", "s3").toString("hex")).not.toBe(base);
    expect(deriveSigningKey("secret", "20240101", "us-east-1", "iam").toString("hex")).not.toBe(base);
    expect(deriveSigningKey("other", "20240101", "us-east-1", "s3").toString("hex")).not.toBe(base);
  });
});

describe("SigV4 presigned URL", () => {
  const v = AWS_PRESIGN_VECTOR;

  it("reproduces the AWS canonical request byte for byte", () => {
    const { canonicalRequest } = __buildCanonicalRequestForTest(v.config, {
      method: "GET",
      key: v.key,
      expiresInSeconds: v.expiresInSeconds,
      now: v.now,
    });
    expect(canonicalRequest).toBe(v.expectedCanonicalRequest);
  });

  it("reproduces the AWS string-to-sign byte for byte", () => {
    const { stringToSign } = __buildCanonicalRequestForTest(v.config, {
      method: "GET",
      key: v.key,
      expiresInSeconds: v.expiresInSeconds,
      now: v.now,
    });
    expect(stringToSign).toBe(v.expectedStringToSign);
  });

  it("reproduces the AWS published signature", () => {
    const { url } = presignS3Url(v.config, {
      method: "GET",
      key: v.key,
      expiresInSeconds: v.expiresInSeconds,
      now: v.now,
    });
    expect(url).toContain(`X-Amz-Signature=${v.expectedSignature}`);
  });

  it("produces a URL that parses and carries every required query parameter", () => {
    const { url } = presignS3Url(v.config, {
      method: "GET",
      key: v.key,
      expiresInSeconds: v.expiresInSeconds,
      now: v.now,
    });
    const parsed = new URL(url);
    expect(parsed.host).toBe("examplebucket.s3.amazonaws.com");
    expect(parsed.pathname).toBe("/test.txt");
    for (const param of [
      "X-Amz-Algorithm",
      "X-Amz-Credential",
      "X-Amz-Date",
      "X-Amz-Expires",
      "X-Amz-SignedHeaders",
      "X-Amz-Signature",
    ]) {
      expect(parsed.searchParams.get(param), `missing ${param}`).toBeTruthy();
    }
  });
});

/**
 * Mutation coverage. Each of these changes exactly one signed input and
 * asserts the signature moves. Without them a signer that silently ignored,
 * say, the HTTP method would still pass the vector test above (which only
 * exercises GET) while minting URLs that authorise the wrong operation.
 */
describe("SigV4 signature depends on every signed input", () => {
  const v = AWS_PRESIGN_VECTOR;
  const baseline = presignS3Url(v.config, {
    method: "GET",
    key: v.key,
    expiresInSeconds: v.expiresInSeconds,
    now: v.now,
  }).url;
  const sigOf = (url: string) => new URL(url).searchParams.get("X-Amz-Signature");

  it("changes when the HTTP method changes", () => {
    const mutated = presignS3Url(v.config, {
      method: "PUT",
      key: v.key,
      expiresInSeconds: v.expiresInSeconds,
      now: v.now,
    }).url;
    expect(sigOf(mutated)).not.toBe(sigOf(baseline));
  });

  it("changes when the object key changes", () => {
    const mutated = presignS3Url(v.config, {
      method: "GET",
      key: "other.txt",
      expiresInSeconds: v.expiresInSeconds,
      now: v.now,
    }).url;
    expect(sigOf(mutated)).not.toBe(sigOf(baseline));
  });

  it("changes when the expiry changes", () => {
    const mutated = presignS3Url(v.config, {
      method: "GET",
      key: v.key,
      expiresInSeconds: 3600,
      now: v.now,
    }).url;
    expect(sigOf(mutated)).not.toBe(sigOf(baseline));
  });

  it("changes when the signing time changes", () => {
    const mutated = presignS3Url(v.config, {
      method: "GET",
      key: v.key,
      expiresInSeconds: v.expiresInSeconds,
      now: new Date("2013-05-25T00:00:00Z"),
    }).url;
    expect(sigOf(mutated)).not.toBe(sigOf(baseline));
  });

  it("changes when the secret key changes", () => {
    const mutated = presignS3Url(
      { ...v.config, secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEZ" },
      { method: "GET", key: v.key, expiresInSeconds: v.expiresInSeconds, now: v.now },
    ).url;
    expect(sigOf(mutated)).not.toBe(sigOf(baseline));
  });

  it("changes when the bucket changes", () => {
    const mutated = presignS3Url(
      { ...v.config, bucket: "otherbucket" },
      { method: "GET", key: v.key, expiresInSeconds: v.expiresInSeconds, now: v.now },
    ).url;
    expect(sigOf(mutated)).not.toBe(sigOf(baseline));
  });

  it("changes when an extra signed query parameter is added", () => {
    const mutated = presignS3Url(v.config, {
      method: "GET",
      key: v.key,
      expiresInSeconds: v.expiresInSeconds,
      now: v.now,
      query: { "response-content-type": "application/pdf" },
    }).url;
    expect(sigOf(mutated)).not.toBe(sigOf(baseline));
  });
});

describe("RFC 3986 URI encoding", () => {
  /**
   * encodeURIComponent leaves these unescaped; SigV4's canonical form does not.
   * A key containing any of them would otherwise sign differently to how the
   * store canonicalises it, producing a 403 on exactly the files with unusual
   * names — the hardest kind of bug to reproduce on demand.
   */
  it("escapes the characters encodeURIComponent leaves alone", () => {
    for (const ch of ["!", "'", "(", ")", "*"]) {
      expect(__uriEncodeForTest(ch, true)).not.toBe(ch);
      expect(__uriEncodeForTest(ch, true).startsWith("%")).toBe(true);
    }
  });

  it("leaves unreserved characters untouched", () => {
    expect(__uriEncodeForTest("abcXYZ123-._~", true)).toBe("abcXYZ123-._~");
  });

  it("encodes slashes only when asked", () => {
    expect(__uriEncodeForTest("a/b", false)).toBe("a/b");
    expect(__uriEncodeForTest("a/b", true)).toBe("a%2Fb");
  });

  it("encodes multi-byte UTF-8 per byte", () => {
    // "é" is C3 A9 in UTF-8 and must encode as two percent-escapes, not one.
    expect(__uriEncodeForTest("é", true)).toBe("%C3%A9");
  });

  it("signs keys with spaces and unicode without throwing", () => {
    const { url } = presignS3Url(AWS_PRESIGN_VECTOR.config, {
      method: "PUT",
      key: "org-1/Café Report (final).pdf",
      expiresInSeconds: 900,
    });
    expect(() => new URL(url)).not.toThrow();
    expect(url).toContain("Caf%C3%A9");
    expect(url).toContain("%20");
  });
});

describe("presign guards", () => {
  it("rejects a non-positive expiry", () => {
    expect(() =>
      presignS3Url(AWS_PRESIGN_VECTOR.config, { method: "GET", key: "k", expiresInSeconds: 0 }),
    ).toThrow(/expiry/i);
  });

  it("rejects an expiry beyond the S3 maximum of seven days", () => {
    expect(() =>
      presignS3Url(AWS_PRESIGN_VECTOR.config, { method: "GET", key: "k", expiresInSeconds: 604801 }),
    ).toThrow(/expiry/i);
  });

  it("puts the bucket in the path for path-style endpoints", () => {
    const { url } = presignS3Url(
      {
        ...AWS_PRESIGN_VECTOR.config,
        endpoint: "https://proj.supabase.co/storage/v1/s3",
        forcePathStyle: true,
      },
      { method: "GET", key: "a/b.txt", expiresInSeconds: 900 },
    );
    const parsed = new URL(url);
    expect(parsed.host).toBe("proj.supabase.co");
    expect(parsed.pathname).toBe("/storage/v1/s3/examplebucket/a/b.txt");
  });
});

describe("formatAmzDate", () => {
  it("produces ISO8601 basic format and its date prefix", () => {
    const { amzDate, dateStamp } = formatAmzDate(new Date("2013-05-24T00:00:00Z"));
    expect(amzDate).toBe("20130524T000000Z");
    expect(dateStamp).toBe("20130524");
  });
});
