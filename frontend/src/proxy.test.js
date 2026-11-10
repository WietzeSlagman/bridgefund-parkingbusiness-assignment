// @vitest-environment node
import { createServer as createHttpServer } from "node:http";
import { createServer as createViteServer } from "vite";
import { describe, expect, it } from "vitest";
import { createConfig } from "../vite.config.js";

describe("development proxy", () => {
  it("defaults to the documented backend and allows an explicit local target", () => {
    expect(createConfig({}).server.proxy["/occupancy"]).toBe(
      "http://127.0.0.1:3000",
    );
    expect(
      createConfig({ DISPLAY_API_TARGET: "http://127.0.0.1:3301" }).server
        .proxy["/occupancy"],
    ).toBe("http://127.0.0.1:3301");
  });

  it("forwards the availability path and response through Vite", async () => {
    let path;
    const backend = createHttpServer((req, res) => {
      path = req.url;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ resident: 50, car: 80, motorcycle: 20 }));
    });
    await new Promise((resolve) => backend.listen(0, "127.0.0.1", resolve));
    let vite;
    try {
      const config = createConfig({
        DISPLAY_API_TARGET: `http://127.0.0.1:${backend.address().port}`,
      });
      vite = await createViteServer({
        ...config,
        configFile: false,
        logLevel: "silent",
        server: { ...config.server, host: "127.0.0.1", port: 0 },
      });
      await vite.listen();
      const response = await fetch(
        `http://127.0.0.1:${vite.httpServer.address().port}/occupancy/PB-AMS-2M8D/availability`,
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        resident: 50,
        car: 80,
        motorcycle: 20,
      });
      expect(path).toBe("/occupancy/PB-AMS-2M8D/availability");
    } finally {
      await vite?.close();
      await new Promise((resolve, reject) =>
        backend.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
