import { describe, expect, it } from "vitest";
import { allRenditionKeys } from "@/lib/media-renditions";

/**
 * Supabase Storage only accepts these characters in an object key and answers
 * anything else with HTTP 400. A `~` in the derived keys broke every
 * thumbnail and panorama strip in production, so every derived key is held
 * to the same rule.
 */
const SUPABASE_KEY = /^(\w|\/|!|-|\.|\*|'|\(|\)| |&|\$|@|=|;|:|\+|,|\?)*$/;

describe("derived storage keys", () => {
  it("only use characters Supabase Storage accepts", () => {
    const keys = allRenditionKeys("org123/0c8f-uuid-original__3_.jpg", 11 * 1024 * 1024);
    expect(keys.length).toBeGreaterThan(2);
    for (const key of keys) expect(key).toMatch(SUPABASE_KEY);
  });
});
