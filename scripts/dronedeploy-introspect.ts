/**
 * Prints the real shape of the DroneDeploy GraphQL types auto-import uses.
 *
 * Same reason as matterport-introspect.ts: the client's queries were written
 * from DroneDeploy's public docs, and the environment this repo is developed
 * in cannot reach DroneDeploy to check them. GraphQL rejects a whole query for
 * one wrong field, so check before trusting a first live run.
 *
 *   DRONEDEPLOY_API_KEY=... npm run dronedeploy:introspect
 *
 * Input objects and enums are printed too: `createExport`'s layer values are
 * the part of the contract the public docs say least about.
 */
const API_URL = process.env.DRONEDEPLOY_API_URL ?? "https://www.dronedeploy.com/graphql";

const TYPES = ["Viewer", "Organization", "MapPlan", "Export", "ExportParameters", "CreateExportInput", "ExportLayer"];

type TypeRef = { kind: string; name: string | null; ofType?: TypeRef | null };

function renderType(t: TypeRef): string {
  if (t.name) return t.name;
  if (!t.ofType) return t.kind;
  const inner = renderType(t.ofType);
  if (t.kind === "NON_NULL") return `${inner}!`;
  if (t.kind === "LIST") return `[${inner}]`;
  return inner;
}

const TYPE_REF = "kind name ofType { kind name ofType { kind name ofType { kind name } } }";

async function introspect(typeName: string, apiKey: string): Promise<void> {
  const query = `
    query Introspect($name: String!) {
      __type(name: $name) {
        name kind
        fields { name args { name type { ${TYPE_REF} } } type { ${TYPE_REF} } }
        inputFields { name type { ${TYPE_REF} } }
        enumValues { name }
      }
    }`;
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, variables: { name: typeName } }),
  });
  if (!res.ok) {
    console.error(`\n${typeName}: HTTP ${res.status} — ${(await res.text()).slice(0, 300)}`);
    return;
  }
  const json = (await res.json()) as {
    data?: {
      __type: {
        name: string;
        kind: string;
        fields: Array<{ name: string; args: Array<{ name: string; type: TypeRef }>; type: TypeRef }> | null;
        inputFields: Array<{ name: string; type: TypeRef }> | null;
        enumValues: Array<{ name: string }> | null;
      } | null;
    };
    errors?: Array<{ message: string }>;
  };
  if (json.errors?.length) {
    console.error(`\n${typeName}: ${json.errors.map((e) => e.message).join("; ")}`);
    return;
  }
  const type = json.data?.__type;
  if (!type) {
    console.log(`\n${typeName}: not present in this schema`);
    return;
  }
  console.log(`\n=== ${type.name} (${type.kind}) ===`);
  for (const f of type.fields ?? []) {
    const args = f.args.length ? `(${f.args.map((a) => `${a.name}: ${renderType(a.type)}`).join(", ")})` : "";
    console.log(`  ${f.name}${args}: ${renderType(f.type)}`);
  }
  for (const f of type.inputFields ?? []) console.log(`  ${f.name}: ${renderType(f.type)}`);
  for (const v of type.enumValues ?? []) console.log(`  ${v.name}`);
}

async function main(): Promise<void> {
  const apiKey = process.env.DRONEDEPLOY_API_KEY;
  if (!apiKey) {
    console.error("DRONEDEPLOY_API_KEY must be set.");
    process.exit(1);
  }
  console.log(`Introspecting ${API_URL}`);
  for (const typeName of TYPES) await introspect(typeName, apiKey);
  console.log("\nCompare against src/lib/integrations/dronedeploy-client.ts and adjust its selection sets to match.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

// A module, so its top-level names do not collide with the other scripts'.
export {};
