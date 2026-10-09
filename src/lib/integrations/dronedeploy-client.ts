import { withObservability } from "@/lib/observability";

/**
 * DroneDeploy GraphQL API (https://www.dronedeploy.com/graphql, Bearer API
 * key). DroneDeploy does the photogrammetry; this client only finds finished
 * maps and asks for their files, which is all auto-import needs.
 *
 * IMPORTANT: same caveat as the Matterport provider. The operations below
 * follow DroneDeploy's public developer docs — `viewer.organization.plans`
 * as a Relay connection, `createExport(input: { planId, parameters: { layer } })`,
 * and `node(id)` resolved `... on Export` for `status` / `downloadPath` —
 * but this environment cannot reach DroneDeploy to verify a live round trip,
 * and the full schema sits behind their Enterprise GraphiQL console.
 *
 * GraphQL validates the whole query, so one wrong field returns nothing.
 * Selection sets are therefore kept to the fields the docs show and nothing
 * more; `npm run dronedeploy:introspect` prints the real shape from a machine
 * that can reach the API, and is the way to widen them.
 */

export interface DroneDeployPlan {
  /** e.g. "MapPlan:5a0ddee5a6b7d90f8ec3b6d8" — opaque, passed back unchanged. */
  id: string;
  name: string | null;
  createdAt: Date | null;
  latitude: number | null;
  longitude: number | null;
}

export type DroneDeployExportState =
  | { state: "PENDING" }
  | { state: "COMPLETE"; downloadUrl: string }
  | { state: "FAILED"; reason: string };

export class DroneDeployApiError extends Error {
  constructor(
    message: string,
    /** True for a rejected key — retrying will not help until it is replaced. */
    public readonly unauthorized = false,
  ) {
    super(message);
    this.name = "DroneDeployApiError";
  }
}

const DEFAULT_ENDPOINT = "https://www.dronedeploy.com/graphql";

/** Upper bound on pages read per poll, so a huge account cannot stall a run. */
const MAX_PLAN_PAGES = 10;
const PLAN_PAGE_SIZE = 50;

export class DroneDeployClient {
  constructor(
    private readonly apiKey: string,
    private readonly endpoint: string = process.env.DRONEDEPLOY_API_URL ?? DEFAULT_ENDPOINT,
  ) {}

  private async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    return withObservability("dronedeploy.api_call", { provider: "dronedeploy" }, async () => {
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ query, variables }),
      });
      if (res.status === 401 || res.status === 403) {
        throw new DroneDeployApiError("DroneDeploy rejected the API key", true);
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new DroneDeployApiError(`DroneDeploy API returned ${res.status}: ${body.slice(0, 500)}`);
      }
      const json = await res.json();
      if (json.errors?.length) {
        throw new DroneDeployApiError(
          `DroneDeploy API error: ${json.errors.map((e: { message: string }) => e.message).join("; ")}`,
        );
      }
      return json.data as T;
    });
  }

  /** Cheapest call that proves the key works. */
  async verify(): Promise<{ username: string | null }> {
    const data = await this.graphql<{ viewer: { username: string | null } | null }>(
      `query Viewer { viewer { username } }`,
    );
    if (!data.viewer) throw new DroneDeployApiError("DroneDeploy returned no user for this API key", true);
    return { username: data.viewer.username };
  }

  /** Every map in the account, newest pages first as DroneDeploy orders them. */
  async listPlans(): Promise<DroneDeployPlan[]> {
    const plans: DroneDeployPlan[] = [];
    let after: string | null = null;
    for (let page = 0; page < MAX_PLAN_PAGES; page++) {
      const data: PlansPage = await this.graphql<PlansPage>(
        `query Plans($first: Int!, $after: String) {
          viewer { organization { plans(first: $first, after: $after) {
            pageInfo { hasNextPage endCursor }
            edges { node { id name dateCreation location { lat lng } } }
          } } }
        }`,
        { first: PLAN_PAGE_SIZE, after },
      );
      const connection = data.viewer?.organization?.plans;
      if (!connection) break;
      for (const edge of connection.edges ?? []) {
        if (!edge?.node) continue;
        plans.push(toPlan(edge.node));
      }
      if (!connection.pageInfo?.hasNextPage || !connection.pageInfo.endCursor) break;
      after = connection.pageInfo.endCursor;
    }
    return plans;
  }

  /**
   * Asks DroneDeploy to build one layer's file. Only `layer` is passed: it is
   * the one parameter the docs mark required, and an optional field with a
   * guessed enum value would fail the whole mutation.
   */
  async createExport(planId: string, layer: string): Promise<{ exportId: string }> {
    // `layer` is an enum, so it is inlined rather than sent as a variable of a
    // type whose name the docs do not give. It comes from our own allow-list,
    // never from user input — see EXPORT_LAYERS.
    if (!/^[A-Z_]+$/.test(layer)) throw new DroneDeployApiError(`Invalid export layer "${layer}"`);
    const data = await this.graphql<{ createExport: { export: { id: string } | null } | null }>(
      `mutation CreateExport($planId: ID!) {
        createExport(input: { planId: $planId, parameters: { layer: ${layer} } }) { export { id } }
      }`,
      { planId },
    );
    const id = data.createExport?.export?.id;
    if (!id) throw new DroneDeployApiError("DroneDeploy did not return an export id");
    return { exportId: id };
  }

  async getExport(exportId: string): Promise<DroneDeployExportState> {
    const data = await this.graphql<{ node: { status: string | null; downloadPath: string | null } | null }>(
      `query GetExport($id: ID!) { node(id: $id) { ... on Export { status downloadPath } } }`,
      { id: exportId },
    );
    if (!data.node) return { state: "FAILED", reason: "DroneDeploy no longer has this export" };
    const status = (data.node.status ?? "").toUpperCase();
    if (status === "COMPLETE") {
      if (!data.node.downloadPath) return { state: "PENDING" };
      return { state: "COMPLETE", downloadUrl: data.node.downloadPath };
    }
    if (status === "FAILED" || status === "ERROR" || status === "CANCELLED") {
      return { state: "FAILED", reason: `DroneDeploy reported the export as ${status}` };
    }
    return { state: "PENDING" };
  }
}

interface PlanNode {
  id: string;
  name?: string | null;
  dateCreation?: string | number | null;
  location?: { lat?: number | null; lng?: number | null } | null;
}

interface PlansPage {
  viewer: {
    organization: {
      plans: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null } | null;
        edges: Array<{ node: PlanNode | null } | null> | null;
      } | null;
    } | null;
  } | null;
}

function toPlan(node: PlanNode): DroneDeployPlan {
  let createdAt: Date | null = null;
  if (node.dateCreation !== null && node.dateCreation !== undefined) {
    const parsed = new Date(node.dateCreation);
    createdAt = Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const lat = node.location?.lat;
  const lng = node.location?.lng;
  // 0,0 is what an unset location serialises to far more often than it is a
  // real flight in the Gulf of Guinea; treating it as unknown keeps such a map
  // from being filed against whatever property happens to be nearest to it.
  const hasLocation = typeof lat === "number" && typeof lng === "number" && !(lat === 0 && lng === 0);
  return {
    id: node.id,
    name: node.name ?? null,
    createdAt,
    latitude: hasLocation ? lat : null,
    longitude: hasLocation ? lng : null,
  };
}
