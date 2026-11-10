import type { Request } from "express";
import { requestIdSchema } from "./schemas.js";

export function parseRequestId(req: Request): string | undefined {
  const count = req.rawHeaders.filter(
    (_, i) => i % 2 === 0 && req.rawHeaders[i].toLowerCase() === "x-request-id",
  ).length;
  const id = req.get("x-request-id");
  return count === 1 && id && requestIdSchema.safeParse(id).success
    ? id
    : undefined;
}
