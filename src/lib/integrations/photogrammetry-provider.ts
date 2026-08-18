import { DroneCaptureStatus, DroneOutputType } from "@/generated/prisma/client";

/**
 * Drone processing provider abstraction (spec §17 "Drone Provider Adapter").
 * The rest of the app (drone-service.ts, the Exterior tab, admin retry
 * tooling) talks to this interface, never to a specific processor
 * directly, so PIX4D (or any other photogrammetry engine) can plug in
 * later without touching callers — the same pattern already used for
 * `InteriorCaptureProvider`/Matterport and `StorageProvider`/local disk.
 *
 * IMPORTANT: this repo's actual upload path is direct-to-storage via
 * signed URLs (spec §36 — large files never proxy through the app
 * server), so `uploadImages()` below does not transfer bytes itself; it
 * hands the provider references to files that already exist in
 * `StorageProvider`. A provider that needs the bytes (e.g. PIX4D) reads
 * them from storage using those keys when it actually submits the job.
 *
 * `DroneCaptureStatus` (CREATED/UPLOADING/PROCESSING/READY/FAILED) is
 * reused as the job status vocabulary rather than inventing a separate
 * QUEUED/COMPLETED/CANCELLED set — READY stands in for "completed", and
 * a cancelled job is represented as FAILED with an explanatory
 * `errorMessage` — to avoid a schema migration for this adapter pass.
 * A future provider needing genuinely distinct states is a real reason
 * to revisit that enum.
 */

export interface PhotogrammetryJobStatus {
  status: DroneCaptureStatus;
  progressPercent?: number;
  errorMessage?: string;
}

export interface PhotogrammetryOutputResult {
  outputType: DroneOutputType;
  storageKey: string;
  mimeType?: string;
  sizeBytes?: number;
  checksum?: string;
  metadata?: Record<string, unknown>;
}

export interface PhotogrammetryProvider {
  readonly name: string;
  /** True only when the environment/org actually has credentials configured for this provider. */
  isConfigured(): boolean;
  /** Registers a new processing job for a capture's dataset. Returns the provider's job identifier. */
  createJob(params: { datasetId: string; captureId: string }): Promise<{ providerJobId: string }>;
  /** Hands the provider references to already-uploaded raw images (storage keys), not bytes. */
  uploadImages(params: { providerJobId: string; imageStorageKeys: string[] }): Promise<void>;
  /** Kicks off processing for a job that has its images registered. */
  startProcessing(params: { providerJobId: string }): Promise<void>;
  getStatus(params: { providerJobId: string }): Promise<PhotogrammetryJobStatus>;
  /** Only meaningful once status is READY — returns the produced outputs (orthomosaic, point cloud, etc.). */
  getOutputs(params: { providerJobId: string }): Promise<PhotogrammetryOutputResult[]>;
  cancelJob(params: { providerJobId: string }): Promise<void>;
}

export class PhotogrammetryProviderError extends Error {
  constructor(
    public providerName: string,
    message: string,
  ) {
    super(message);
    this.name = "PhotogrammetryProviderError";
  }
}
