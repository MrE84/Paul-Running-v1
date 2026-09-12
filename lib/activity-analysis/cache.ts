import type { ActivitySource, DecodedFit } from "./contracts";
import { buildActivityAnalysisProjection, projectionCacheKey, type ActivityAnalysisProjection } from "./projection";

const MAX_CACHE_ENTRIES = 24;
const projectionCache = new Map<string, ActivityAnalysisProjection>();

export function getCachedActivityAnalysisProjection(
  source: ActivitySource,
  decoded: DecodedFit,
): ActivityAnalysisProjection {
  const key = projectionCacheKey(source.id);
  const cached = projectionCache.get(key);
  if (cached) {
    projectionCache.delete(key);
    projectionCache.set(key, cached);
    return cached;
  }

  const projection = buildActivityAnalysisProjection(source, decoded);
  projectionCache.set(key, projection);
  while (projectionCache.size > MAX_CACHE_ENTRIES) {
    const oldest = projectionCache.keys().next().value as string | undefined;
    if (!oldest) break;
    projectionCache.delete(oldest);
  }
  return projection;
}

export function clearActivityAnalysisProjectionCache(sourceId?: string): void {
  if (!sourceId) {
    projectionCache.clear();
    return;
  }
  for (const key of projectionCache.keys()) {
    if (key.startsWith(`${sourceId}:`)) projectionCache.delete(key);
  }
}

export function activityAnalysisProjectionCacheSize(): number {
  return projectionCache.size;
}
