import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

export type Identity =
  { role: "entrance" | "exit"; gateId: string } | { role: "admin" };

export type Credential = { key: string; identity: Identity };

/** Validate credentials once at startup, including keys in a rotation overlap. */
export function createAuthenticator(credentials: Credential[]) {
  const keys = new Set<string>();
  for (const { key } of credentials) {
    if (!key || /\s/.test(key) || keys.has(key)) {
      throw new Error("Invalid or duplicate configured credential");
    }
    keys.add(key);
  }
  const entries = credentials.map(({ key, identity }) => ({
    key: Buffer.from(key),
    identity,
  }));

  return (header: string | undefined): Identity | undefined => {
    const match = header?.match(/^Bearer ([^\s]+)$/i);
    if (!match) {
      return undefined;
    }
    const supplied = Buffer.from(match[1]);
    return entries.find(
      (entry) =>
        entry.key.length === supplied.length &&
        timingSafeEqual(entry.key, supplied),
    )?.identity;
  };
}

/** Enforce a role without exposing whether an unknown key resembles a valid one. */
export function requireRole(
  authenticate: ReturnType<typeof createAuthenticator>,
  role: Identity["role"],
): RequestHandler {
  return (req, res, next) => {
    // Node can combine duplicate headers; reject duplicates explicitly.
    const count = req.rawHeaders.filter(
      (_, index) =>
        index % 2 === 0 &&
        req.rawHeaders[index].toLowerCase() === "authorization",
    ).length;
    const identity =
      count === 1 ? authenticate(req.get("authorization")) : undefined;
    if (!identity) {
      res
        .status(401)
        .json({ error: { code: "UNAUTHORIZED", message: "Unauthorized" } });
      return;
    }
    if (identity.role !== role) {
      res
        .status(403)
        .json({ error: { code: "FORBIDDEN", message: "Forbidden" } });
      return;
    }
    res.locals.identity = identity;
    next();
  };
}
