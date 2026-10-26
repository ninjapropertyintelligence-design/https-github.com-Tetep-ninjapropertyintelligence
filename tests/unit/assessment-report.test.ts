import { describe, expect, it } from "vitest";
import { embeddableImageKind } from "@/lib/reports/assessment-report";

describe("embeddableImageKind", () => {
  it("recognises JPEG and PNG by their bytes, whatever the file claims to be", () => {
    expect(embeddableImageKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe("jpeg");
    expect(embeddableImageKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("png");
    expect(embeddableImageKind(Buffer.from("RIFF....WEBP"))).toBeNull();
    expect(embeddableImageKind(Buffer.alloc(0))).toBeNull();
  });
});
