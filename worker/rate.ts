// Exact rolling windows. Changing configuration applies on the next request.
export function takeLimit(
  times: number[],
  limit: number,
  burst: number,
  now: number,
) {
  const recent = times.filter((t) => t > now - 3_600_000);
  if (
    !limit ||
    recent.length >= limit ||
    recent.filter((t) => t > now - 60_000).length >= burst
  )
    throw new Error("RATE_LIMITED");
  return [...recent, now];
}
