export type Bucket = {
  id: string;
  limit: number;
  used: number;
  reserved: number;
};
export function reserve(buckets: Bucket[], amount: number): Bucket[] {
  if (!Number.isSafeInteger(amount) || amount <= 0 || !buckets.length)
    throw new Error("INVALID_RESERVATION");
  if (
    buckets.some(
      (b) =>
        !Number.isSafeInteger(b.limit) ||
        !Number.isSafeInteger(b.used) ||
        !Number.isSafeInteger(b.reserved) ||
        b.used < 0 ||
        b.reserved < 0 ||
        b.used + b.reserved + amount > b.limit,
    )
  )
    throw new Error("BUDGET_EXHAUSTED");
  return buckets.map((b) => ({ ...b, reserved: b.reserved + amount }));
}
export function settle(
  buckets: Bucket[],
  reserved: number,
  actual: number,
): Bucket[] {
  if (!Number.isSafeInteger(actual) || actual < 0 || actual > reserved)
    throw new Error("UNEXPECTED_PROVIDER_OVERAGE");
  if (buckets.some((b) => b.reserved < reserved))
    throw new Error("INVALID_SETTLEMENT");
  return buckets.map((b) => ({
    ...b,
    used: b.used + actual,
    reserved: b.reserved - reserved,
  }));
}
