import type { z } from "zod";
import { checkInSchema } from "./schemas.js";

export type CheckInRequest = z.infer<typeof checkInSchema>;

/** Validate the complete body and return the canonical request identity. */
export function parseCheckInRequest(body: unknown): CheckInRequest | undefined {
  const result = checkInSchema.safeParse(body);
  return result.success ? result.data : undefined;
}
