import { createAuthenticator, type Credential } from "./auth.js";
import { PILOT } from "./pilot.js";

export type ParkingConfig = {
  buildings: Record<string, number>;
  credentials: Credential[];
};

/** Separate from database tooling: startup requires explicit parking configuration. */
export function loadParkingConfig(env: NodeJS.ProcessEnv): ParkingConfig {
  let buildings: Record<string, number>;
  let keys: Record<string, unknown>;
  try {
    buildings = JSON.parse(env.PARKING_BUILDINGS ?? "") as Record<
      string,
      number
    >;
    keys = JSON.parse(env.PARKING_KEYS ?? "") as Record<string, unknown>;
  } catch {
    throw new Error("Invalid parking configuration");
  }
  if (
    !buildings ||
    typeof buildings !== "object" ||
    Array.isArray(buildings) ||
    buildings[PILOT.code] !== PILOT.registrationLimit ||
    Object.entries(buildings).some(
      ([code, limit]) =>
        !/^[A-Z0-9-]+$/.test(code) || !Number.isSafeInteger(limit) || limit < 0,
    ) ||
    !keys ||
    typeof keys !== "object" ||
    Array.isArray(keys)
  ) {
    throw new Error("Invalid parking configuration");
  }
  const identities = [
    "entrance-1",
    "entrance-2",
    "exit-1",
    "exit-2",
    "admin",
  ] as const;
  if (Object.keys(keys).length !== identities.length) {
    throw new Error("Invalid parking configuration");
  }
  const credentials: Credential[] = [];
  for (const id of identities) {
    const values = keys[id];
    if (
      !Array.isArray(values) ||
      values.length === 0 ||
      values.some(
        (key) =>
          typeof key !== "string" ||
          key.startsWith("CHANGE_ME") ||
          key === "<key>",
      )
    ) {
      throw new Error("Invalid parking configuration");
    }
    for (const key of values as string[]) {
      credentials.push({
        key,
        identity:
          id === "admin"
            ? { role: "admin" }
            : {
                role: id.startsWith("entrance") ? "entrance" : "exit",
                gateId: id,
              },
      });
    }
  }
  createAuthenticator(credentials);
  return { buildings, credentials };
}
