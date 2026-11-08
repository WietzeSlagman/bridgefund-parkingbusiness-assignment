import { describe, expect, it } from "vitest";
import request from "supertest";
import express from "express";
import { createApp, errorHandler } from "../../src/app.js";
import { loadConfig } from "../../src/config/index.js";

describe("foundation", () => {
  it("returns a safe JSON 404 over HTTP", async () => {
    const response = await request(createApp()).get("/missing");
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Not found" });
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });
  it("validates configuration without exposing credentials", () => {
    expect(() => loadConfig({})).toThrow("DATABASE_URL is required");
    expect(() => loadConfig({ DATABASE_URL: "https://secret" })).toThrow(
      "DATABASE_URL must",
    );
    expect(() =>
      loadConfig({ DATABASE_URL: "postgresql://user@localhost" }),
    ).toThrow("DATABASE_URL must");
    expect(() =>
      loadConfig({ DATABASE_URL: "postgresql://user@localhost/" }),
    ).toThrow("DATABASE_URL must");
    expect(() =>
      loadConfig({
        DATABASE_URL: "postgres://user:secret@localhost/db",
        PORT: "0",
      }),
    ).toThrow("PORT must");
    expect(
      loadConfig({ DATABASE_URL: "postgres://user:secret@localhost/db" }).port,
    ).toBe(3000);
  });
  it("does not disclose internal errors", async () => {
    const app = express();
    app.get("/", () => {
      throw new Error("sensitive internal detail");
    });
    app.use(errorHandler);
    const response = await request(app).get("/");
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "Internal server error" });
  });
});
