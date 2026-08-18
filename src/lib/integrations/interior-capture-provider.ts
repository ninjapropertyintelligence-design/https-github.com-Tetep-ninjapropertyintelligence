/**
 * Interior capture provider abstraction (spec Phase 2 §2). Matterport is
 * the first implementation; the rest of the app (Interior tab, property
 * onboarding, data confidence) talks to this interface, never to
 * Matterport specifics directly, so a second interior-capture vendor can
 * plug in later without touching callers.
 */

export interface InteriorSpaceSummary {
  externalSpaceId: string;
  name: string | null;
  status: "SYNCING" | "READY" | "ERROR";
  capturedAt: Date | null;
}

export interface InteriorViewerConfig {
  /** Iframe-embeddable URL for the Interior tab. Null when the space isn't viewable (e.g. connection error). */
  embedUrl: string | null;
  /** Whether this used the SDK key (full interactive Showcase) vs. a public share link fallback. */
  usesSdk: boolean;
}

export type InteriorConnectionStatus = "NOT_CONFIGURED" | "CONNECTED" | "ERROR";

export interface InteriorConnectResult {
  status: InteriorConnectionStatus;
  errorMessage?: string;
}

export interface InteriorCaptureProvider {
  readonly name: string;
  /** True only when the environment/org actually has credentials configured — never attempts network calls otherwise. */
  isConfigured(): boolean;
  connect(): Promise<InteriorConnectResult>;
  disconnect(): Promise<void>;
  listSpaces(): Promise<InteriorSpaceSummary[]>;
  getSpace(externalSpaceId: string): Promise<InteriorSpaceSummary | null>;
  syncSpace(externalSpaceId: string): Promise<InteriorSpaceSummary | null>;
  getViewerConfig(externalSpaceId: string): InteriorViewerConfig;
}

export class InteriorProviderError extends Error {
  constructor(
    public providerName: string,
    message: string,
  ) {
    super(message);
    this.name = "InteriorProviderError";
  }
}
