import { describe, expect, it } from "vitest";
import { __toGeminiSchemaForTest as toGeminiSchema } from "@/lib/ai/providers/gemini-provider";
import type { JSONSchemaObject } from "@/lib/ai/provider";

/**
 * Gemini accepts a SUBSET of JSON Schema and rejects the whole request on
 * fields it does not recognise — `additionalProperties` among them. The tool
 * definitions in this codebase are deliberately plain JSON Schema so no vendor
 * leaks into that layer, which means the trimming has to happen here.
 *
 * This fails as an opaque 400 from Google at runtime, so it is worth pinning:
 * nothing about the type system prevents `additionalProperties` reappearing.
 */
describe("toGeminiSchema", () => {
  it("removes additionalProperties, which Gemini rejects", () => {
    const schema: JSONSchemaObject = {
      type: "object",
      properties: { propertyId: { type: "string" } },
      required: ["propertyId"],
      additionalProperties: false,
    };
    expect(toGeminiSchema(schema)).toEqual({
      type: "object",
      properties: { propertyId: { type: "string" } },
      required: ["propertyId"],
    });
  });

  it("removes it from NESTED objects too, not just the top level", () => {
    // A top-level-only strip would pass the simple case above and still fail
    // for any tool taking a structured argument.
    const schema = {
      type: "object",
      properties: {
        filter: {
          type: "object",
          properties: { band: { type: "string" } },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    } as unknown as JSONSchemaObject;

    const out = JSON.stringify(toGeminiSchema(schema));
    expect(out).not.toContain("additionalProperties");
    expect(out).toContain("band");
  });

  it("reaches inside arrays", () => {
    const schema = {
      type: "object",
      properties: {
        anyOf: [{ type: "object", properties: {}, additionalProperties: true }],
      },
    } as unknown as JSONSchemaObject;
    expect(JSON.stringify(toGeminiSchema(schema))).not.toContain("additionalProperties");
  });

  it("keeps everything else intact", () => {
    const schema: JSONSchemaObject = {
      type: "object",
      properties: {
        propertyId: { type: "string", description: "The property id" },
        limit: { type: "number" },
      },
      required: ["propertyId"],
    };
    expect(toGeminiSchema(schema)).toEqual(schema);
  });

  it("strips $schema, which is equally unrecognised", () => {
    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {},
    } as unknown as JSONSchemaObject;
    expect(toGeminiSchema(schema)).toEqual({ type: "object", properties: {} });
  });
});
