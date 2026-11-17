import { describe, expect, it } from "vitest";
import { templateDefinitionSchema } from "@/lib/template-service";
import {
  KITCHEN_AUDIT_SCORES,
  KITCHEN_ZONES,
  findKitchenEquipment,
  kitchenAuditTemplateDefinition,
} from "@/lib/restaurant-kitchen";

describe("restaurant kitchen catalog", () => {
  it("walks six zones in order, back of house to bar", () => {
    expect(KITCHEN_ZONES.map((z) => z.name.split(".")[0])).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("gives every piece of equipment a unique type, so an asset finds its own checkpoints", () => {
    const types = KITCHEN_ZONES.flatMap((z) => z.equipment.map((e) => e.assetType));
    expect(new Set(types).size).toBe(types.length);
    for (const type of types) expect(findKitchenEquipment(type)?.item.assetType).toBe(type);
    expect(findKitchenEquipment("Rooftop HVAC")).toBeNull();
  });

  it("keeps criticality on the asset's 1–5 scale and every item checkable", () => {
    for (const item of KITCHEN_ZONES.flatMap((z) => z.equipment)) {
      expect(item.criticality).toBeGreaterThanOrEqual(1);
      expect(item.criticality).toBeLessThanOrEqual(5);
      expect(item.checkpoints.length).toBeGreaterThan(0);
    }
  });
});

describe("restaurant kitchen audit template", () => {
  it("is a definition the template builder accepts", () => {
    expect(() => templateDefinitionSchema.parse(kitchenAuditTemplateDefinition())).not.toThrow();
  });

  it("has a task per piece of equipment, each asking for a required score", () => {
    const def = templateDefinitionSchema.parse(kitchenAuditTemplateDefinition());
    const tasks = def.sections.flatMap((s) => s.tasks);
    expect(tasks.length).toBe(KITCHEN_ZONES.flatMap((z) => z.equipment).length);
    for (const task of tasks) {
      const score = task.questions.find((q) => q.prompt === "Score");
      expect(score?.isRequired).toBe(true);
      expect(score?.options).toEqual([...KITCHEN_AUDIT_SCORES]);
    }
  });
});
