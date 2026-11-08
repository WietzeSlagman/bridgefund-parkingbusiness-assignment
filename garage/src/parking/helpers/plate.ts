/** Normalize the pilot's ASCII-only plate format, or reject invalid input. */
export function normalizePlate(value: unknown): string | undefined {
  if (typeof value !== "string" || /[^A-Za-z0-9 -]/.test(value)) {
    return undefined;
  }
  const normalized = value.replace(/[ -]/g, "").toUpperCase();
  return normalized.length >= 1 && normalized.length <= 16
    ? normalized
    : undefined;
}
