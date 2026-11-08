import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createAuthenticator, requireRole } from "../../src/parking/auth.js";

const credentials = [
  {
    key: "first-key",
    identity: { role: "entrance" as const, gateId: "entrance-1" },
  },
  {
    key: "rotated-key",
    identity: { role: "entrance" as const, gateId: "entrance-1" },
  },
  { key: "exit-key", identity: { role: "exit" as const, gateId: "exit-1" } },
  { key: "admin-key", identity: { role: "admin" as const } },
];

describe("gate authentication infrastructure", () => {
  it("preserves gate identity through rotation and rejects ambiguous keys", () => {
    const authenticate = createAuthenticator(credentials);
    expect(authenticate("Bearer first-key")).toEqual(
      authenticate("Bearer rotated-key"),
    );
    expect(authenticate("Bearer first-key extra")).toBeUndefined();
    expect(() => createAuthenticator([...credentials, credentials[0]])).toThrow(
      "Invalid or duplicate configured credential",
    );
    expect(() =>
      createAuthenticator([{ key: "bad key", identity: { role: "admin" } }]),
    ).toThrow();
  });

  it("distinguishes unknown credentials from valid wrong-role credentials", async () => {
    const app = express();
    app.get(
      "/",
      requireRole(createAuthenticator(credentials), "entrance"),
      (_req, res) => {
        res.json(res.locals.identity);
      },
    );
    expect((await request(app).get("/")).status).toBe(401);
    expect(
      (await request(app).get("/").set("Authorization", "Bearer unknown"))
        .status,
    ).toBe(401);
    expect(
      (await request(app).get("/").set("Authorization", "Bearer admin-key"))
        .status,
    ).toBe(403);
    expect(
      (await request(app).get("/").set("Authorization", "Bearer exit-key"))
        .status,
    ).toBe(403);
    const success = await request(app)
      .get("/")
      .set("Authorization", "Bearer rotated-key");
    expect(success.status).toBe(200);
    expect(success.body).toEqual({ role: "entrance", gateId: "entrance-1" });
  });
});
