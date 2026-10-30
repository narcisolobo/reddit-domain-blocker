export const STATS_PREFIX = "stats:";

export function statsKey(domain) {
  return STATS_PREFIX + domain;
}

export function parseStats(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const { blockedCount, lastBlockedAt } = value;
  if (!Number.isSafeInteger(blockedCount) || blockedCount < 0) return null;
  if (lastBlockedAt !== null && !Number.isFinite(lastBlockedAt)) return null;
  return { blockedCount, lastBlockedAt };
}

export function statsFromItems(items) {
  const stats = new Map();
  for (const [key, value] of Object.entries(items ?? {})) {
    if (!key.startsWith(STATS_PREFIX)) continue;
    const parsed = parseStats(value);
    if (parsed) stats.set(key.slice(STATS_PREFIX.length), parsed);
  }
  return stats;
}
