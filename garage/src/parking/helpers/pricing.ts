const HOUR_MS = 60 * 60 * 1000;
const amsterdamDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Amsterdam",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Price elapsed, check-in-anchored blocks by their Amsterdam start date.
 * Midnight does not split a block; DST affects its local date, not its duration.
 */
export function parkingPrice(
  category: "RESIDENT" | "CAR" | "MOTOR",
  checkedInAt: Date,
  evaluatedAt: Date,
): { cents: number; minutes: number } {
  const start = checkedInAt.getTime();
  const elapsed = evaluatedAt.getTime() - start;
  if (!Number.isFinite(start) || !Number.isFinite(elapsed) || elapsed < 0) {
    throw new RangeError("Invalid parking interval");
  }
  const minutes = Math.floor(elapsed / 60_000);
  if (category === "RESIDENT") {
    return { cents: 0, minutes };
  }
  const rate = category === "CAR" ? 500 : 300;
  const cap = rate * 6;
  const days = new Map<string, number>();
  for (let offset = 0; offset < elapsed; offset += HOUR_MS) {
    const date = amsterdamDate.format(start + offset);
    days.set(date, Math.min(cap, (days.get(date) ?? 0) + rate));
  }
  return { cents: [...days.values()].reduce((a, b) => a + b, 0), minutes };
}
