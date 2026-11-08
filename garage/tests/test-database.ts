import pg from "pg";

// Do not pass the original URL to pg: connection-string query parameters can
// override its host, database and user. Only the password is taken from it.
export function testDatabaseConfig(url: string | undefined): pg.ClientConfig {
  const message =
    "TEST_DATABASE_URL must target the isolated local test database without query parameters or fragments";
  if (!url) {
    throw new Error("TEST_DATABASE_URL is required; see README");
  }
  try {
    const parsed = new URL(url);
    if (
      !["postgres:", "postgresql:"].includes(parsed.protocol) ||
      !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
      parsed.port !== "55433" ||
      parsed.pathname !== "/garage_test" ||
      parsed.username !== "garage_test" ||
      !parsed.password ||
      url.includes("?") ||
      url.includes("#")
    ) {
      throw new Error();
    }
    return {
      host: "127.0.0.1",
      port: 55433,
      database: "garage_test",
      user: "garage_test",
      password: decodeURIComponent(parsed.password),
      ssl: false,
      options: "-c search_path=public",
    };
  } catch {
    throw new Error(message);
  }
}
