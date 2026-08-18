import {
  InteriorCaptureProvider,
  InteriorConnectResult,
  InteriorSpaceSummary,
  InteriorViewerConfig,
} from "@/lib/integrations/interior-capture-provider";
import { withObservability } from "@/lib/observability";

/**
 * Real Matterport integration using the Model API (GraphQL, enterprise/
 * partner accounts) for metadata, and the public Showcase embed URL scheme
 * for the viewer iframe.
 *
 * IMPORTANT: the exact GraphQL query/field names below follow Matterport's
 * documented Model API shape as of this integration's authoring, but
 * nothing in this environment holds real Matterport credentials to verify
 * a live round trip against. Before pointing this at a production
 * Matterport account, confirm the query against the current Model API
 * reference (https://matterport.github.io/showcase-sdk/) and adjust field
 * names if the schema has moved on. The transport, auth scheme (Basic
 * auth with API token as username / API secret as password — Matterport's
 * documented pattern), error handling, and connection-state machine are
 * all real and exercised by tests with a mocked fetch.
 */
export class MatterportProvider implements InteriorCaptureProvider {
  readonly name = "matterport";

  constructor(
    private token: string | undefined,
    private secret: string | undefined,
    private sdkKey: string | undefined,
    private apiBaseUrl: string = process.env.MATTERPORT_API_BASE_URL ?? "https://api.matterport.com/api/models/graph",
  ) {}

  isConfigured(): boolean {
    return !!this.token && !!this.secret;
  }

  private authHeader(): string {
    return "Basic " + Buffer.from(`${this.token}:${this.secret}`).toString("base64");
  }

  private async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    return withObservability("matterport.api_call", { provider: "matterport" }, async () => {
      const res = await fetch(this.apiBaseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: this.authHeader(),
        },
        body: JSON.stringify({ query, variables }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Matterport API returned ${res.status}: ${body.slice(0, 500)}`);
      }
      const json = await res.json();
      if (json.errors?.length) {
        throw new Error(`Matterport API error: ${json.errors.map((e: { message: string }) => e.message).join("; ")}`);
      }
      return json.data as T;
    });
  }

  async connect(): Promise<InteriorConnectResult> {
    if (!this.isConfigured()) {
      return { status: "NOT_CONFIGURED" };
    }
    try {
      // A cheap, read-only call to confirm the credentials actually work
      // before marking the connection CONNECTED.
      await this.listSpaces();
      return { status: "CONNECTED" };
    } catch (err) {
      return { status: "ERROR", errorMessage: err instanceof Error ? err.message : "Unknown Matterport connection error" };
    }
  }

  async disconnect(): Promise<void> {
    // No remote-side action needed for the Model API (token-scoped, not
    // session-scoped) — disconnect only clears local connection state,
    // handled by the caller (does not delete the Property).
  }

  async listSpaces(): Promise<InteriorSpaceSummary[]> {
    if (!this.isConfigured()) {
      throw new Error("Matterport is not configured");
    }
    const data = await this.graphql<{
      models: { edges: Array<{ node: { id: string; name: string | null; status: string; visibility: string } }> };
    }>(
      `query ListModels { models(first: 100) { edges { node { id name status visibility } } } }`,
    );
    return (data.models?.edges ?? []).map((edge) => ({
      externalSpaceId: edge.node.id,
      name: edge.node.name,
      status: this.mapStatus(edge.node.status),
      capturedAt: null, // Model API doesn't expose capture date on this query; populated on sync via getSpace if available.
    }));
  }

  async getSpace(externalSpaceId: string): Promise<InteriorSpaceSummary | null> {
    if (!this.isConfigured()) {
      throw new Error("Matterport is not configured");
    }
    const data = await this.graphql<{
      model: { id: string; name: string | null; status: string } | null;
    }>(`query GetModel($id: ID!) { model(id: $id) { id name status } }`, { id: externalSpaceId });
    if (!data.model) return null;
    return {
      externalSpaceId: data.model.id,
      name: data.model.name,
      status: this.mapStatus(data.model.status),
      capturedAt: null,
    };
  }

  async syncSpace(externalSpaceId: string): Promise<InteriorSpaceSummary | null> {
    // Re-fetching is the "sync" — the Model API has no separate
    // resync/refresh mutation to trigger; metadata is authoritative live.
    return this.getSpace(externalSpaceId);
  }

  getViewerConfig(externalSpaceId: string): InteriorViewerConfig {
    if (!externalSpaceId) return { embedUrl: null, usesSdk: false };
    if (this.sdkKey) {
      return {
        embedUrl: `https://my.matterport.com/show/?m=${encodeURIComponent(externalSpaceId)}&mpsk=${encodeURIComponent(this.sdkKey)}&play=1&qs=1`,
        usesSdk: true,
      };
    }
    // Public share embed — works for spaces with public/unlisted visibility, no SDK key required.
    return {
      embedUrl: `https://my.matterport.com/show/?m=${encodeURIComponent(externalSpaceId)}&play=1&qs=1`,
      usesSdk: false,
    };
  }

  private mapStatus(matterportStatus: string): InteriorSpaceSummary["status"] {
    const normalized = matterportStatus?.toUpperCase() ?? "";
    if (normalized.includes("PROCESS") || normalized === "PENDING") return "SYNCING";
    if (normalized === "ERROR" || normalized === "FAILED") return "ERROR";
    return "READY";
  }
}

let cached: MatterportProvider | null = null;

/** Singleton reading env-configured platform-level Matterport credentials. */
export function getMatterportProvider(): MatterportProvider {
  if (cached) return cached;
  cached = new MatterportProvider(
    process.env.MATTERPORT_API_TOKEN,
    process.env.MATTERPORT_API_SECRET,
    process.env.MATTERPORT_SDK_KEY,
  );
  return cached;
}
