import { afterEach, describe, expect, it } from "vitest";
import { __setStorageProviderForTest, getStorageProvider } from "@/lib/storage";

describe("storage provider selection", () => {
  const saved = { provider: process.env.STORAGE_PROVIDER, vercel: process.env.VERCEL };

  afterEach(() => {
    process.env.STORAGE_PROVIDER = saved.provider;
    if (saved.vercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = saved.vercel;
    __setStorageProviderForTest(null);
  });

  it("refuses local storage on Vercel with a message that says what to change", () => {
    // Vercel's filesystem is read-only per instance: local storage there
    // fails every upload, and should say so rather than return a bare 500.
    __setStorageProviderForTest(null);
    process.env.STORAGE_PROVIDER = "local";
    process.env.VERCEL = "1";
    expect(() => getStorageProvider()).toThrow(/STORAGE_PROVIDER to "s3"/);
    try {
      getStorageProvider();
    } catch (err) {
      expect((err as { status?: number }).status).toBe(503);
    }
  });

  it("still uses local storage off Vercel, for development", () => {
    __setStorageProviderForTest(null);
    process.env.STORAGE_PROVIDER = "local";
    delete process.env.VERCEL;
    expect(getStorageProvider()).toBeTruthy();
  });
});
