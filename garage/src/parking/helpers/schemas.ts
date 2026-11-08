import { z } from "zod";
import { normalizePlate } from "./plate.js";

export const plateSchema = z.string().transform((value, context) => {
  const normalized = normalizePlate(value);
  if (!normalized) {
    context.addIssue({ code: "custom", message: "Invalid plate" });
    return z.NEVER;
  }
  return normalized;
});

export const checkInSchema = z.strictObject({
  vehicleType: z.enum(["CAR", "MOTOR"]),
  isResident: z.boolean(),
  licensePlate: plateSchema,
});

// Check the shape before values to preserve error precedence.
export const residentBodyShape = z
  .strictObject({
    buildingCode: z.unknown().optional(),
    licensePlate: z.unknown(),
  })
  .refine((body) => Object.hasOwn(body, "licensePlate"));

export const residentQuerySchema = z.strictObject({ buildingCode: z.string() });
export const requestIdSchema = z.uuid();
