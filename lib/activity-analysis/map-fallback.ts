export interface FallbackRoutePoint {
  lat: number;
  lon: number;
  segment: number;
}

export interface IndexedFallbackRoutePoint extends FallbackRoutePoint {
  index: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface ScreenRoutePath {
  segment: number;
  d: string;
}

export interface RunnerPosition {
  lat: number;
  lon: number;
  segment: number;
  index: number;
  bearing: number;
}

export interface OsmTile {
  key: string;
  url: string;
  left: number;
  top: number;
  size: number;
}

export interface MapViewport {
  longitude: number;
  latitude: number;
  zoom: number;
  width: number;
  height: number;
}

export function projectRoutePaths(
  points: FallbackRoutePoint[],
  project: (longitude: number, latitude: number) => ScreenPoint,
): ScreenRoutePath[] {
  const segments = new Map<number, string[]>();
  for (const point of points) {
    const screen = project(point.lon, point.lat);
    if (!Number.isFinite(screen.x) || !Number.isFinite(screen.y)) continue;
    const commands = segments.get(point.segment) ?? [];
    commands.push(`${commands.length ? "L" : "M"}${screen.x.toFixed(1)} ${screen.y.toFixed(1)}`);
    segments.set(point.segment, commands);
  }
  return [...segments.entries()].flatMap(([segment, commands]) => commands.length > 1 ? [{ segment, d: commands.join(" ") }] : []);
}

function bearingBetween(a: FallbackRoutePoint, b: FallbackRoutePoint) {
  const meanLatitude = (a.lat + b.lat) * Math.PI / 360;
  const east = (b.lon - a.lon) * Math.cos(meanLatitude);
  const north = b.lat - a.lat;
  if (Math.abs(east) < 1e-12 && Math.abs(north) < 1e-12) return 0;
  return (Math.atan2(east, north) * 180 / Math.PI + 360) % 360;
}

/**
 * Resolve the shared timeline hover index onto the privacy-safe visible GPS route.
 * When FIT physiology samples are denser than GPS, interpolate between the adjacent
 * visible GPS points so chart scrubbing produces smooth map movement. Deliberate
 * route segment breaks (privacy masks or genuine GPS outages) are never bridged.
 */
export function resolveRunnerPosition(
  points: IndexedFallbackRoutePoint[],
  hoverIndex: number | null,
  elapsed?: Array<number | null>,
): RunnerPosition | null {
  if (hoverIndex === null || !Number.isInteger(hoverIndex) || !points.length) return null;

  let lo = 0;
  let hi = points.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const point = points[mid];
    if (point.index === hoverIndex) {
      const previous = mid > 0 && points[mid - 1].segment === point.segment ? points[mid - 1] : null;
      const next = mid + 1 < points.length && points[mid + 1].segment === point.segment ? points[mid + 1] : null;
      const from = previous ?? point;
      const to = next ?? point;
      return { lat: point.lat, lon: point.lon, segment: point.segment, index: hoverIndex, bearing: bearingBetween(from, to) };
    }
    if (point.index < hoverIndex) lo = mid + 1;
    else hi = mid - 1;
  }

  const left = hi >= 0 ? points[hi] : null;
  const right = lo < points.length ? points[lo] : null;
  if (!left && !right) return null;
  if (!left && right) return { ...right, index: hoverIndex, bearing: 0 };
  if (left && !right) return { ...left, index: hoverIndex, bearing: 0 };
  if (!left || !right || left.segment !== right.segment) return null;

  const leftElapsed = elapsed?.[left.index];
  const rightElapsed = elapsed?.[right.index];
  const hoverElapsed = elapsed?.[hoverIndex];
  let fraction = (hoverIndex - left.index) / Math.max(1, right.index - left.index);
  if (
    leftElapsed !== null && leftElapsed !== undefined && Number.isFinite(leftElapsed) &&
    rightElapsed !== null && rightElapsed !== undefined && Number.isFinite(rightElapsed) &&
    hoverElapsed !== null && hoverElapsed !== undefined && Number.isFinite(hoverElapsed) &&
    rightElapsed > leftElapsed
  ) {
    fraction = (hoverElapsed - leftElapsed) / (rightElapsed - leftElapsed);
  }
  fraction = Math.max(0, Math.min(1, fraction));

  return {
    lat: left.lat + (right.lat - left.lat) * fraction,
    lon: left.lon + (right.lon - left.lon) * fraction,
    segment: left.segment,
    index: hoverIndex,
    bearing: bearingBetween(left, right),
  };
}

function latitudeToTile(latitude: number, zoom: number) {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  const radians = clamped * Math.PI / 180;
  const count = 2 ** zoom;
  return (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * count;
}

function longitudeToTile(longitude: number, zoom: number) {
  return (longitude + 180) / 360 * (2 ** zoom);
}

/**
 * Computes ordinary DOM <img> tiles for the current MapLibre camera. This deliberately
 * bypasses MapLibre's raster-source worker path so a browser that can pan/zoom the map
 * but cannot paint MapLibre sources can still display an OpenStreetMap background.
 */
export function osmTileLayout(viewport: MapViewport): OsmTile[] {
  if (viewport.width <= 0 || viewport.height <= 0 || !Number.isFinite(viewport.zoom)) return [];
  const tileZoom = Math.max(0, Math.min(19, Math.floor(viewport.zoom)));
  const tileCount = 2 ** tileZoom;
  const scale = 2 ** (viewport.zoom - tileZoom);
  const size = 256 * scale;
  const centerX = longitudeToTile(viewport.longitude, tileZoom);
  const centerY = latitudeToTile(viewport.latitude, tileZoom);
  const halfColumns = Math.ceil(viewport.width / size / 2) + 1;
  const halfRows = Math.ceil(viewport.height / size / 2) + 1;
  const originX = Math.floor(centerX);
  const originY = Math.floor(centerY);
  const tiles: OsmTile[] = [];

  for (let rawX = originX - halfColumns; rawX <= originX + halfColumns; rawX++) {
    const x = ((rawX % tileCount) + tileCount) % tileCount;
    for (let y = originY - halfRows; y <= originY + halfRows; y++) {
      if (y < 0 || y >= tileCount) continue;
      tiles.push({
        key: `${tileZoom}/${rawX}/${y}`,
        url: `https://tile.openstreetmap.org/${tileZoom}/${x}/${y}.png`,
        left: (rawX - centerX) * size + viewport.width / 2,
        top: (y - centerY) * size + viewport.height / 2,
        size,
      });
    }
  }
  return tiles;
}
