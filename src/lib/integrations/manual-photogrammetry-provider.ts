import { prisma } from "@/lib/prisma";
import {
  PhotogrammetryJobStatus,
  PhotogrammetryOutputResult,
  PhotogrammetryProvider,
  PhotogrammetryProviderError,
} from "@/lib/integrations/photogrammetry-provider";
import { logEvent } from "@/lib/observability";

/**
 * The provider actually in use today (spec §5: "manual drone output
 * import first, before PIX4D automation"). It does no computation of its
 * own — a human runs photogrammetry software out-of-band and uploads the
 * resulting orthomosaic/point-cloud/mesh outputs directly via
 * `registerDroneOutput()`. This provider's job is only to track that
 * lifecycle through the same `PhotogrammetryProvider` contract a real
 * automated processor (PIX4D) would use, so swapping one in later means
 * adding a new class, not redesigning `drone-service.ts`.
 */
export class ManualUploadPhotogrammetryProvider implements PhotogrammetryProvider {
  readonly name = "manual";

  isConfigured(): boolean {
    // No credentials needed — this provider is always available.
    return true;
  }

  async createJob(params: { datasetId: string; captureId: string }): Promise<{ providerJobId: string }> {
    const job = await prisma.droneProcessingJob.create({
      data: { datasetId: params.datasetId, status: "CREATED" },
    });
    logEvent("drone.processing_job", { ok: true, provider: this.name, jobStage: "created", providerJobId: job.id, captureId: params.captureId });
    return { providerJobId: job.id };
  }

  async uploadImages(params: { providerJobId: string; imageStorageKeys: string[] }): Promise<void> {
    // Images already landed in storage via direct signed upload (spec
    // §36) and are registered as DroneImage rows by drone-service.ts —
    // there is nothing left for the provider to transfer. This just
    // reflects that upload activity happened against the job's status.
    await prisma.droneProcessingJob.update({
      where: { id: params.providerJobId },
      data: { status: "UPLOADING" },
    });
  }

  async startProcessing(params: { providerJobId: string }): Promise<void> {
    // "Processing" for the manual provider is the human having already
    // uploaded outputs via registerDroneOutput() — there is no async
    // computation to wait for, so the job completes immediately.
    const job = await prisma.droneProcessingJob.findUnique({ where: { id: params.providerJobId } });
    if (!job) throw new PhotogrammetryProviderError(this.name, "Processing job not found");
    await prisma.droneProcessingJob.update({
      where: { id: job.id },
      data: { status: "READY", startedAt: job.startedAt ?? new Date(), completedAt: new Date() },
    });
    logEvent("drone.processing_job", {
      ok: true,
      provider: this.name,
      jobStage: "completed",
      providerJobId: job.id,
      durationMs: job.startedAt ? Date.now() - job.startedAt.getTime() : undefined,
    });
  }

  async getStatus(params: { providerJobId: string }): Promise<PhotogrammetryJobStatus> {
    const job = await prisma.droneProcessingJob.findUnique({ where: { id: params.providerJobId } });
    if (!job) throw new PhotogrammetryProviderError(this.name, "Processing job not found");
    return { status: job.status, errorMessage: job.errorMessage ?? undefined };
  }

  async getOutputs(params: { providerJobId: string }): Promise<PhotogrammetryOutputResult[]> {
    const job = await prisma.droneProcessingJob.findUnique({ where: { id: params.providerJobId } });
    if (!job) throw new PhotogrammetryProviderError(this.name, "Processing job not found");
    const outputs = await prisma.droneOutput.findMany({ where: { datasetId: job.datasetId } });
    return outputs.map((o) => ({
      outputType: o.outputType,
      storageKey: o.storageKey,
      mimeType: o.mimeType ?? undefined,
      sizeBytes: o.sizeBytes ?? undefined,
      checksum: o.checksum ?? undefined,
      metadata: (o.metadata as Record<string, unknown>) ?? undefined,
    }));
  }

  async cancelJob(params: { providerJobId: string }): Promise<void> {
    await prisma.droneProcessingJob.update({
      where: { id: params.providerJobId },
      data: { status: "FAILED", errorMessage: "Cancelled by user", completedAt: new Date() },
    });
  }
}

let cached: ManualUploadPhotogrammetryProvider | null = null;

/**
 * Singleton reading `PHOTOGRAMMETRY_PROVIDER` (default "manual"). Only
 * "manual" exists today; a `PIX4D_API_KEY`-backed provider would slot in
 * here behind the same `PhotogrammetryProvider` interface without
 * touching `drone-service.ts`.
 */
export function getPhotogrammetryProvider(): PhotogrammetryProvider {
  const kind = process.env.PHOTOGRAMMETRY_PROVIDER ?? "manual";
  if (kind !== "manual") {
    throw new PhotogrammetryProviderError(
      kind,
      `Photogrammetry provider "${kind}" is not implemented yet — only "manual" is available. Add a class implementing PhotogrammetryProvider to enable it.`,
    );
  }
  if (cached) return cached;
  cached = new ManualUploadPhotogrammetryProvider();
  return cached;
}
