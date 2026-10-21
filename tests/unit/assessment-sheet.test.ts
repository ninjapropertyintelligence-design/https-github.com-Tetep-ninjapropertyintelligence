import { describe, expect, it } from "vitest";
import { formatAnswerCell, neutralizeFormula, parseAnswerCell, parseInstance } from "@/lib/assessment-sheet";

describe("neutralizeFormula", () => {
  it("keeps a typed answer from running as a spreadsheet formula", () => {
    expect(neutralizeFormula("=HYPERLINK(\"http://x\")")).toBe("'=HYPERLINK(\"http://x\")");
    expect(neutralizeFormula("+1 555")).toBe("'+1 555");
    expect(neutralizeFormula("Roof ok")).toBe("Roof ok");
  });

  it("is undone on the way back in", () => {
    expect(parseAnswerCell("TEXT", "'=SUM(A1)", [])).toEqual({ ok: true, value: { textValue: "=SUM(A1)" } });
  });
});

describe("answer cells", () => {
  it("round-trips each kind", () => {
    const cases: Array<[Parameters<typeof formatAnswerCell>[0], Parameters<typeof formatAnswerCell>[1], string[]]> = [
      ["YES_NO", { boolValue: false }, []],
      ["NUMBER", { numberValue: 12.5 }, []],
      ["CONDITION", { conditionValue: 40 }, []],
      ["SELECT", { selectValues: ["Blocked"] }, ["Clear", "Blocked"]],
      ["MULTI_SELECT", { selectValues: ["Rust", "Leak, minor"] }, ["Rust", "Leak, minor", "Dent"]],
      ["TEXT", { textValue: "North side" }, []],
    ];
    for (const [type, answer, options] of cases) {
      const cell = formatAnswerCell(type, answer);
      const parsed = parseAnswerCell(type, cell, options);
      expect(parsed.ok, `${type}: ${cell}`).toBe(true);
      expect(formatAnswerCell(type, parsed.ok ? parsed.value : undefined)).toBe(cell);
    }
  });

  it("accepts the ways people write yes and no, and options in any case", () => {
    expect(parseAnswerCell("YES_NO", "y", [])).toEqual({ ok: true, value: { boolValue: true } });
    expect(parseAnswerCell("SELECT", "blocked", ["Clear", "Blocked"])).toEqual({ ok: true, value: { selectValues: ["Blocked"] } });
  });

  it("says what is wrong", () => {
    expect(parseAnswerCell("YES_NO", "maybe", [])).toMatchObject({ ok: false, error: '"maybe" is not Yes or No' });
    expect(parseAnswerCell("CONDITION", "140", [])).toMatchObject({ ok: false, error: "A condition score is 0 to 100" });
    expect(parseAnswerCell("SELECT", "Gone", ["Clear", "Blocked"])).toMatchObject({ ok: false, error: expect.stringMatching(/Not an option: Gone/) });
    expect(parseAnswerCell("PHOTO", "img.jpg", [])).toMatchObject({ ok: false });
  });
});

describe("parseInstance", () => {
  it("reads blank as the first response and refuses nonsense", () => {
    expect(parseInstance("")).toBe(1);
    expect(parseInstance("3")).toBe(3);
    expect(parseInstance("0")).toBeNull();
    expect(parseInstance("two")).toBeNull();
  });
});
