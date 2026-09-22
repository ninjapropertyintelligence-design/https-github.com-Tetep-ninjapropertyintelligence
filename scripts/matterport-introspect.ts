/**
 * Prints the real field set of Matterport's Model API types.
 *
 * Why this exists: the provider's queries were written from documentation and
 * could not be verified, because the environment this repo is developed in
 * cannot reach `api.matterport.com` — its egress policy refuses the host. The
 * first live call failed validation in a way that cost a deploy to discover:
 *
 *   Unknown field argument 'first'
 *   Field 'edges' in type 'ModelSearchResultList' is undefined
 *
 * GraphQL validates the WHOLE query, so a single wrong field name returns
 * nothing at all rather than a partial result. That makes guessing expensive
 * and introspection cheap. Run this from any machine that can reach the API,
 * then widen the provider's selection sets to match what it prints.
 *
 *   npm run matterport:introspect
 *
 * Reads MATTERPORT_API_TOKEN and MATTERPORT_API_SECRET from the environment.
 */
const API_URL = process.env.MATTERPORT_API_BASE_URL ?? "https://api.matterport.com/api/models/graph";

/** Types worth knowing the shape of, in the order they matter to the provider. */
const TYPES = ["Query", "ModelSearchResultList", "ModelSearchResult", "Model"];

interface IntrospectedField {
  name: string;
  description: string | null;
  args: Array<{ name: string; type: { name: string | null; kind: string; ofType?: { name: string | null } | null } }>;
  type: { name: string | null; kind: string; ofType?: { name: string | null; kind: string; ofType?: { name: string | null } | null } | null };
}

/** Unwraps NON_NULL / LIST wrappers into something readable. */
function renderType(type: IntrospectedField["type"] | IntrospectedField["args"][number]["type"]): string {
  const t = type as { name: string | null; kind: string; ofType?: unknown };
  if (t.name) return t.name;
  const inner = t.ofType as IntrospectedField["type"] | undefined;
  if (!inner) return t.kind;
  const rendered = renderType(inner);
  if (t.kind === "NON_NULL") return `${rendered}!`;
  if (t.kind === "LIST") return `[${rendered}]`;
  return rendered;
}

async function introspect(typeName: string, auth: string): Promise<void> {
  const query = `
    query Introspect($name: String!) {
      __type(name: $name) {
        name
        kind
        description
        fields {
          name
          description
          args { name type { kind name ofType { kind name ofType { kind name } } } }
          type { kind name ofType { kind name ofType { kind name } } }
        }
      }
    }
  `;

  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: auth },
    body: JSON.stringify({ query, variables: { name: typeName } }),
  });

  if (!res.ok) {
    console.error(`\n${typeName}: HTTP ${res.status} — ${(await res.text()).slice(0, 300)}`);
    return;
  }

  const json = (await res.json()) as {
    data?: { __type: { name: string; kind: string; description: string | null; fields: IntrospectedField[] | null } | null };
    errors?: Array<{ message: string }>;
  };

  if (json.errors?.length) {
    // Introspection is disabled on some deployments. Say so plainly rather
    // than printing an empty section that reads like "this type has no fields".
    console.error(`\n${typeName}: ${json.errors.map((e) => e.message).join("; ")}`);
    return;
  }

  const type = json.data?.__type;
  if (!type) {
    console.log(`\n${typeName}: not present in this schema`);
    return;
  }

  console.log(`\n=== ${type.name} (${type.kind}) ===`);
  if (type.description) console.log(`    ${type.description}`);
  for (const field of type.fields ?? []) {
    const args = field.args.length
      ? `(${field.args.map((a) => `${a.name}: ${renderType(a.type)}`).join(", ")})`
      : "";
    console.log(`  ${field.name}${args}: ${renderType(field.type)}`);
    if (field.description) console.log(`      ${field.description}`);
  }
}

async function main(): Promise<void> {
  const token = process.env.MATTERPORT_API_TOKEN;
  const secret = process.env.MATTERPORT_API_SECRET;
  if (!token || !secret) {
    console.error("MATTERPORT_API_TOKEN and MATTERPORT_API_SECRET must both be set.");
    process.exit(1);
  }

  const auth = "Basic " + Buffer.from(`${token}:${secret}`).toString("base64");
  console.log(`Introspecting ${API_URL}`);
  for (const typeName of TYPES) {
    await introspect(typeName, auth);
  }
  console.log("\nPaste the output back so the provider's selection sets can be widened accurately.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
