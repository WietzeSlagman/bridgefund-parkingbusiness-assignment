export function isUnavailableCode(error: unknown): boolean {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : "";
  return /^(08|53|57|55P03|57014|ECONN|ETIMEDOUT)/.test(code);
}
