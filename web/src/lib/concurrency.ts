// Runs `resolver` over `items` with limited concurrency instead of firing
// every request at once — used for per-item lookups against third-party
// APIs (Hubstaff user info, Aircall contact search) that would otherwise
// get rate-limited by a burst of simultaneous requests.
export async function batchMap<T, R>(
  items: T[],
  resolver: (item: T) => Promise<R>,
  concurrency = 5
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    results.push(...(await Promise.all(batch.map(resolver))));
  }
  return results;
}
