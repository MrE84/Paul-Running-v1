export interface FallbackRoutePoint {
  lat: number;
  lon: number;
  segment: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface ScreenRoutePath {
  segment: number;
  d: string;
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
