/**
 * Split out from api-utils.ts so pure service/domain modules (matterport-
 * service, drone-service, reports, admin-service, etc.) can throw/catch
 * ApiError without pulling in next-auth's request-bound machinery — the
 * same reasoning as the tenant-scope.ts split in Phase 1. This lets those
 * modules be integration-tested directly against Postgres without dragging
 * in `next/headers` / next-auth.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
