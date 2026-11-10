import { z } from "zod";
import { checkInSchema } from "../parking/helpers/schemas.js";
import { checkOutSchema } from "../parking/routers/check-out.js";
import { payloadSchema } from "../parking/routers/payments.js";

// Describe the wire input, not transformed values. Custom refinements are
// documented separately because JSON Schema cannot express all of them.
function input(schema: z.ZodType) {
  const result = z.toJSONSchema(schema, { io: "input" });
  delete result.$schema;
  return result;
}
const uuid = { type: "string", format: "uuid" };
const plate = {
  type: "string",
  description:
    "ASCII letters, digits, spaces and hyphens; after removing spaces and hyphens, 1–16 alphanumeric characters. Normalized to uppercase.",
};
const json = (schema: object) => ({ "application/json": { schema } });
const body = (schema: object) => ({ required: true, content: json(schema) });
const error = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message"],
      properties: { code: { type: "string" }, message: { type: "string" } },
    },
  },
};
const occupancyInternalError = {
  oneOf: [
    error,
    {
      type: "object",
      required: ["error"],
      properties: { error: { const: "Internal server error" } },
      additionalProperties: false,
    },
  ],
};
const response = (description: string, schema?: object, headers?: object) => ({
  description,
  ...(schema ? { content: json(schema) } : {}),
  ...(headers ? { headers } : {}),
});
const noStore = {
  "Cache-Control": {
    schema: { type: "string", enum: ["no-store"] },
    description: "Do not cache.",
  },
};
const errors = (codes: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(codes).map(([code, description]) => [
      code,
      response(description, error),
    ]),
  );
const common = {
  "500": "Internal error",
  "503": "Service unavailable or deadline exceeded",
};
const auth = { "401": "Missing or invalid credential", "403": "Wrong role" };
const invalid = { "400": "Invalid request", "415": "Unsupported media type" };
const gateSecurity = [{ bearerAuth: [] }];
const requestId = {
  in: "header",
  name: "X-Request-Id",
  required: true,
  schema: uuid,
  description: "Exactly one UUID per gate event; reuse for retries.",
};
const building = {
  in: "path",
  name: "building",
  required: true,
  schema: { type: "string" },
};
const buildingQuery = {
  in: "query",
  name: "buildingCode",
  required: true,
  schema: { type: "string" },
};
const object = (properties: Record<string, object>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const money = object({
  value: { type: "integer" },
  currency: { const: "EUR" },
});
const checkout = object({
  parkingSpaceId: { type: "integer" },
  sessionLengthInMinutes: { type: "integer" },
  amountDue: money,
});
const resident = object({
  buildingCode: { type: "string" },
  licensePlate: plate,
});
const occupancy = {
  type: "array",
  items: object({
    parkingSpaceId: { type: "integer" },
    category: { enum: ["RESIDENT", "CAR", "MOTOR"] },
    eligibleVehicleTypes: { type: "array", items: { enum: ["CAR", "MOTOR"] } },
    isOccupied: { type: "boolean" },
  }),
};

export function openApiContract() {
  return {
    openapi: "3.1.0",
    info: {
      title: "ParkingBusiness pilot API",
      version: "1.0.0",
      description:
        "Artifact version only; paths are not version-prefixed. Recorded occupancy is not physical presence. Gate 402/recheck behavior and delayed payment attribution remain deployment assumptions.",
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description:
            "One configured credential, scoped to entrance, exit or admin role.",
        },
        paymentSignature: {
          type: "apiKey",
          in: "header",
          name: "X-Signature",
          description:
            "Exactly one lowercase hex HMAC-SHA256 over the exact raw request bytes. Unsigned X-Terminal-Compat is not accepted.",
        },
      },
    },
    paths: {
      "/check-in": {
        post: {
          operationId: "checkIn",
          summary: "Check in at an entrance gate",
          security: gateSecurity,
          parameters: [requestId],
          requestBody: body(input(checkInSchema)),
          description: `Plate: ${plate.description} Authentication precedes JSON validation. Same gate and event ID replays an active success; changed content conflicts.`,
          responses: {
            "201": response(
              "Allocation committed",
              object({
                parkingSessionId: uuid,
                parkingSpaceId: { type: "integer" },
              }),
            ),
            ...errors({
              ...invalid,
              ...auth,
              "409":
                "REQUEST_ID_CONFLICT, EVENT_CLOSED, RESIDENT_NOT_REGISTERED, ACTIVE_SESSION_EXISTS or CATEGORY_FULL",
              ...common,
            }),
          },
        },
      },
      "/check-out": {
        post: {
          operationId: "checkOut",
          summary: "Check out at an exit gate",
          security: gateSecurity,
          parameters: [requestId],
          requestBody: body(input(checkOutSchema)),
          description:
            "A 200 authorizes exit and releases the recorded space; a 402 is a fixed outstanding quote and does not authorize exit. After 402, the gate rechecks using the same gate, request ID and body until 200; repeated 402s do not themselves start another payment. A later payable interaction with a new request ID replaces the current quote; a retry of the superseded interaction returns 409 CHECKOUT_SUPERSEDED while the session is active. After closure EVENT_CLOSED takes precedence for a non-successful binding. Changed content for a bound ID conflicts before session-state evaluation. A committed 200 replays unchanged for its original gate, ID and body. The first recording of a valid payment starts a 15-minute grace period, inclusive at its start and exclusive at its end; duplicate payment delivery does not extend it. During grace checkout can authorize; after expiry it recalculates the tariff less valid payments or retains an uncovered current quote. Residency in the request does not change entitlement. Gate handling of 402, continued rechecks, supersession and late responses remains unconfirmed by the vendor.",
          responses: {
            "200": response("Exit authorized", checkout),
            "402": response("Payment required", checkout),
            ...errors({
              ...invalid,
              ...auth,
              "404": "SESSION_NOT_FOUND",
              "409": "REQUEST_ID_CONFLICT, EVENT_CLOSED or CHECKOUT_SUPERSEDED",
              ...common,
            }),
          },
        },
      },
      "/admin/residents": {
        post: {
          operationId: "registerResident",
          security: gateSecurity,
          description:
            "Admin only. Building validation precedes plate validation.",
          requestBody: body(resident),
          responses: {
            "201": response("Resident registered", resident),
            ...errors({
              ...invalid,
              ...auth,
              "409": "RESIDENT_ALREADY_REGISTERED or REGISTRY_FULL",
              ...common,
            }),
          },
        },
        get: {
          operationId: "listResidents",
          security: gateSecurity,
          parameters: [buildingQuery],
          description: "Admin only; normalized plates sorted ascending.",
          responses: {
            "200": response(
              "Residents",
              object({
                buildingCode: { type: "string" },
                licensePlates: { type: "array", items: plate },
              }),
              noStore,
            ),
            ...errors({
              "400": "INVALID_BUILDING or INVALID_REQUEST",
              ...auth,
              ...common,
            }),
          },
        },
      },
      "/admin/residents/{plate}": {
        delete: {
          operationId: "removeResident",
          security: gateSecurity,
          parameters: [
            { in: "path", name: "plate", required: true, schema: plate },
            buildingQuery,
          ],
          description:
            "Admin only. Authentication precedes path decoding and validation.",
          responses: {
            "204": response("Removed"),
            ...errors({
              "400": "INVALID_BUILDING or INVALID_REQUEST",
              ...auth,
              "404": "RESIDENT_NOT_FOUND",
              "409": "RESIDENT_HAS_ACTIVE_SESSION",
              ...common,
            }),
          },
        },
      },
      "/occupancy/{building}": {
        get: {
          operationId: "getOccupancy",
          security: [],
          parameters: [building],
          description:
            "Public snapshot of recorded allocations, not physical presence.",
          responses: {
            "200": response(
              "Spaces ordered by physical number",
              occupancy,
              noStore,
            ),
            ...errors({ "404": "BUILDING_NOT_FOUND", ...common }),
            "500": response(
              "Internal error: coded occupancy error, or a generic error when routing fails before the handler, including malformed percent-encoding. The generic error may omit Cache-Control.",
              occupancyInternalError,
            ),
          },
        },
      },
      "/occupancy/{building}/availability": {
        get: {
          operationId: "getAvailability",
          security: [],
          parameters: [building],
          description:
            "Public point-in-time count of free spaces; resident spaces are counted separately.",
          responses: {
            "200": response(
              "Free spaces",
              object({
                resident: { type: "integer" },
                car: { type: "integer" },
                motorcycle: { type: "integer" },
              }),
              noStore,
            ),
            ...errors({ "404": "BUILDING_NOT_FOUND", ...common }),
            "500": response(
              "Internal error: coded occupancy error, or a generic error when routing fails before the handler, including malformed percent-encoding. The generic error may omit Cache-Control.",
              occupancyInternalError,
            ),
          },
        },
      },
      "/webhooks/payments": {
        post: {
          operationId: "confirmPayment",
          security: [{ paymentSignature: [] }],
          description:
            "Available only when a webhook secret is configured. Verify the signature over raw bytes before UTF-8, JSON and payload validation. No content encoding; maximum body 16 KiB. paymentId is nonempty, at most 255 characters and excludes control characters. Successful IDs are deduplicated; FAILED is logged but not persisted. A payment does not release a space.",
          requestBody: body(input(payloadSchema)),
          responses: {
            "204": response("Accepted or replayed"),
            ...errors({
              ...invalid,
              "401": "Invalid or missing signature",
              "404": "SESSION_NOT_FOUND",
              "409":
                "PAYMENT_ID_CONFLICT, PAYMENT_SESSION_CLOSED or PAYMENT_AMOUNT_MISMATCH",
              ...common,
            }),
          },
        },
      },
    },
  };
}
