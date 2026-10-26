import { z } from "zod";

/**
 * An id a capturing device makes up for a record before the server has seen
 * it — a UUID in practice. Sent again on a retry, it lets the server return
 * the record it already made instead of a duplicate. Shape-checked only: it
 * means nothing beyond "the same thing as last time".
 */
export const clientIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,64}$/, "clientId must be 8-64 letters, digits, dashes or underscores");
