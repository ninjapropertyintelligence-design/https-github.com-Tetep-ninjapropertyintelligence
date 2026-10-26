import { describe, expect, it } from "vitest";
import { formatHeading } from "@/lib/format";
import { PROPERTY_FIELDS } from "@/lib/import/fields";

describe("formatHeading", () => {
  it("shows degrees with the nearest compass point", () => {
    expect(formatHeading(0)).toBe("0° (N)");
    expect(formatHeading(135)).toBe("135° (SE)");
    expect(formatHeading(350)).toBe("350° (N)");
    expect(formatHeading(360)).toBe("0° (N)");
    expect(formatHeading(null)).toBe("—");
  });
});

describe("heading on property import", () => {
  const field = PROPERTY_FIELDS.find((f) => f.key === "heading")!;

  it("is recognised under its usual column names", () => {
    expect(field.aliases).toEqual(expect.arrayContaining(["heading", "bearing", "orientation"]));
  });

  it("accepts 0-360 and refuses anything else", () => {
    expect(field.coerce("172.5")).toMatchObject({ ok: true, value: 172.5 });
    expect(field.coerce("400")).toMatchObject({ ok: false });
  });
});
