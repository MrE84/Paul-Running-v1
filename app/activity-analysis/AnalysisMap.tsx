"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as LibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { osmTileLayout, projectRoutePaths, resolveRunnerPosition, type OsmTile, type ScreenRoutePath } from "../../lib/activity-analysis/map-fallback";
import { CHANNELS, type AnalysisProjection, type Channel, type IndexRange } from "../../lib/activity-analysis/projection";
import { formatChannel, routeSamples, type PrivacyRegion } from "../../lib/activity-analysis/selection";
import type { UnitSystem } from "../../lib/activity-analysis/contracts";
import styles from "./analysis.module.css";

interface Props {
  projection: AnalysisProjection; hover: number | null; selection: IndexRange | null;
  onHover: (index: number | null) => void; onSelect: (range: IndexRange | null) => void; units: UnitSystem;
  privacy: { endpointRadius: number; regions: PrivacyRegion[] };
  onPrivacyChange: (privacy: { endpointRadius: number; regions: PrivacyRegion[] }) => void;
}

type OverlayLine = { key: string; x1: number; y1: number; x2: number; y2: number; color: string };
type OverlayMarker = { kind: "start" | "finish"; x: number; y: number };
type OverlayRunner = { x: number; y: number; bearing: number; index: number };
type BrowserOverlay = { paths: ScreenRoutePath[]; lines: OverlayLine[]; markers: OverlayMarker[]; runner: OverlayRunner | null; tiles: OsmTile[] };

const emptyCollection = { type: "FeatureCollection" as const, features: [] };
const emptyOverlay: BrowserOverlay = { paths: [], lines: [], markers: [], runner: null, tiles: [] };

function moveCoordinate(longitude: number, latitude: number, bearing: number, distanceDegrees: number): [number, number] {
  const angle = bearing * Math.PI / 180;
  return [longitude + Math.sin(angle) * distanceDegrees / Math.max(.2, Math.cos(latitude * Math.PI / 180)), latitude + Math.cos(angle) * distanceDegrees];
}

function fitPoints(instance: LibreMap, points: Array<{ lat: number; lon: number }>) {
  if (!points.length) return;
  const bounds = new maplibregl.LngLatBounds();
  points.forEach(point => bounds.extend([point.lon, point.lat]));
  instance.fitBounds(bounds, { padding: 45, maxZoom: 15, duration: 0 });
}

function baseRouteCollection(points: Array<{ lat: number; lon: number; segment: number }>) {
  const segments = new Map<number, Array<[number, number]>>();
  for (const point of points) {
    const coordinates = segments.get(point.segment) ?? [];
    coordinates.push([point.lon, point.lat]);
    segments.set(point.segment, coordinates);
  }
  return {
    type: "FeatureCollection" as const,
    features: [...segments.entries()].flatMap(([segment, coordinates]) => coordinates.length > 1 ? [{
      type: "Feature" as const,
      properties: { segment },
      geometry: { type: "LineString" as const, coordinates },
    }] : []),
  };
}

export default memo(function AnalysisMap({ projection, hover, selection, onHover, onSelect, units, privacy, onPrivacyChange }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const map = useRef<LibreMap | null>(null);
  const initialPrivacyHandled = useRef(false);
  const refreshOverlayRef = useRef<(() => void) | null>(null);
  const tilesRef = useRef(false);
  const hoverRef = useRef<number | null>(hover);
  hoverRef.current = hover;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [tileError, setTileError] = useState(false);
  const [browserOverlay, setBrowserOverlay] = useState<BrowserOverlay>(emptyOverlay);
  const [metric, setMetric] = useState<Channel>(projection.streams.channels.heart_rate ? "heart_rate" : "pace");
  const [colourMode, setColourMode] = useState("intensity");
  const [density, setDensity] = useState(2000);
  const [tiles, setTiles] = useState(projection.source.origin === "backend");
  tilesRef.current = tiles;
  const radius = privacy.endpointRadius;
  const regions = privacy.regions;
  const latest = useRef({ onHover, onSelect }); latest.current = { onHover, onSelect };
  const points = useMemo(() => routeSamples(projection, radius, regions, density), [projection, radius, regions, density]);
  const runnerPoints = useMemo(() => routeSamples(projection, radius, regions, Number.MAX_SAFE_INTEGER), [projection, radius, regions]);
  const pointIndices = useMemo(() => new Set(points.map(p => p.index)), [points]);
  const gpsSamples = useMemo(() => projection.streams.latitude.reduce<number>((count, lat, index) => count + (lat !== null && projection.streams.longitude[index] !== null ? 1 : 0), 0), [projection]);
  const baseRoute = useMemo(() => baseRouteCollection(points), [points]);
  const limits = useMemo(() => {
    let min = Infinity, max = -Infinity;
    for (const v of projection.streams.channels[metric] ?? []) if (v !== null) { min = Math.min(min, v); max = Math.max(max, v); }
    return { min: Number.isFinite(min) ? min : 0, max: Number.isFinite(max) ? max : 1 };
  }, [projection, metric]);
  const features = useMemo(() => ({ type: "FeatureCollection" as const, features: points.flatMap((p, i) => {
    const next = points[i + 1];
    if (!next || p.segment !== next.segment) return [];
    const value = projection.streams.channels[metric]?.[p.index] ?? null;
    const zone = value === null ? null : projection.zones[metric]?.find(z => (z.lower === null || value >= z.lower) && (z.upper === null || value <= z.upper));
    const fraction = value === null ? 0 : (value - limits.min) / Math.max(.001, limits.max - limits.min);
    const color = colourMode === "zones" ? zone?.color ?? "#94a3b8" : value === null ? "#64748b" : `hsl(${Math.round(210 - (metric === "pace" ? 1 - fraction : fraction) * 205)}, 88%, 63%)`;
    return [{ type: "Feature" as const, properties: { index: p.index, end: next.index, color }, geometry: { type: "LineString" as const, coordinates: [[p.lon, p.lat], [next.lon, next.lat]] } }];
  }) }), [points, projection, metric, colourMode, limits]);
  const markers = useMemo(() => ({ type: "FeatureCollection" as const, features: points.flatMap((p, i) => {
    const lap = projection.laps.find(l => l.start === p.index);
    const kind = i === 0 ? "start" : i === points.length - 1 ? "finish" : lap ? "lap" : null;
    return kind ? [{ type: "Feature" as const, properties: { kind, start: lap?.start, end: lap?.end }, geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] } }] : [];
  }) }), [points, projection.laps]);
  const routeData = useRef({ features, markers, baseRoute, points, runnerPoints });
  routeData.current = { features, markers, baseRoute, points, runnerPoints };

  useEffect(() => {
    if (initialPrivacyHandled.current) return;
    initialPrivacyHandled.current = true;
    if (privacy.endpointRadius === 200 && privacy.regions.length === 0) onPrivacyChange({ ...privacy, endpointRadius: 0 });
  }, [onPrivacyChange, privacy]);

  useEffect(() => {
    if (!container.current || !projection.streams.latitude.some(v => v !== null)) return;
    setReady(false);
    setError("");
    setBrowserOverlay(emptyOverlay);
    let instance: LibreMap;
    let frame = 0;
    try {
      instance = new maplibregl.Map({
        container: container.current,
        attributionControl: false,
        dragRotate: false,
        style: { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "rgba(18,32,51,0)" } }] },
        center: [0, 0],
        zoom: 1,
      });
    } catch {
      setError("The map needs WebGL. Try another browser; all charts and lap analysis remain available.");
      return;
    }
    map.current = instance;
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    const refreshOverlay = () => {
      const current = routeData.current;
      const project = (longitude: number, latitude: number) => {
        const screen = instance.project([longitude, latitude]);
        return { x: screen.x, y: screen.y };
      };
      const paths = projectRoutePaths(current.points, project);
      const lines = current.features.features.flatMap((feature, index): OverlayLine[] => {
        const coordinates = feature.geometry.coordinates;
        if (coordinates.length !== 2) return [];
        const a = project(coordinates[0][0], coordinates[0][1]);
        const b = project(coordinates[1][0], coordinates[1][1]);
        if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return [];
        return [{ key: `${index}-${feature.properties.index}`, x1: a.x, y1: a.y, x2: b.x, y2: b.y, color: String(feature.properties.color ?? "#60a5fa") }];
      });
      const first = current.points[0];
      const last = current.points[current.points.length - 1];
      const overlayMarkers: OverlayMarker[] = [];
      if (first) { const screen = project(first.lon, first.lat); overlayMarkers.push({ kind: "start", x: screen.x, y: screen.y }); }
      if (last) { const screen = project(last.lon, last.lat); overlayMarkers.push({ kind: "finish", x: screen.x, y: screen.y }); }
      const runnerPosition = resolveRunnerPosition(current.runnerPoints, hoverRef.current, projection.streams.elapsed);
      const runner = runnerPosition ? (() => {
        const screen = project(runnerPosition.lon, runnerPosition.lat);
        return Number.isFinite(screen.x) && Number.isFinite(screen.y) ? { x: screen.x, y: screen.y, bearing: runnerPosition.bearing, index: runnerPosition.index } : null;
      })() : null;
      const center = instance.getCenter();
      const mapContainer = instance.getContainer();
      const tileLayout = tilesRef.current ? osmTileLayout({
        longitude: center.lng,
        latitude: center.lat,
        zoom: instance.getZoom(),
        width: mapContainer.clientWidth,
        height: mapContainer.clientHeight,
      }) : [];
      setBrowserOverlay({ paths, lines, markers: overlayMarkers, runner, tiles: tileLayout });
    };
    const scheduleOverlay = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(refreshOverlay);
    };
    refreshOverlayRef.current = scheduleOverlay;
    instance.on("move", scheduleOverlay);
    instance.on("zoom", scheduleOverlay);
    instance.on("resize", scheduleOverlay);

    instance.on("load", () => {
      try {
        const current = routeData.current;
        instance.addSource("route-base", { type: "geojson", data: current.baseRoute });
        instance.addLayer({ id: "route-base-line", type: "line", source: "route-base", paint: { "line-color": "#38bdf8", "line-width": 6, "line-opacity": .9 }, layout: { "line-cap": "round", "line-join": "round" } });
        instance.addSource("route", { type: "geojson", data: current.features });
        instance.addLayer({ id: "route-hit", type: "line", source: "route", paint: { "line-width": 20, "line-opacity": 0 } });
        try {
          instance.addLayer({ id: "route-line", type: "line", source: "route", paint: { "line-color": ["get", "color"], "line-width": 4 }, layout: { "line-cap": "round" } });
        } catch {
          instance.addLayer({ id: "route-line", type: "line", source: "route", paint: { "line-color": "#60a5fa", "line-width": 4 }, layout: { "line-cap": "round" } });
        }
        instance.addLayer({ id: "route-selection", type: "line", source: "route", filter: ["==", ["get", "index"], -1], paint: { "line-color": "#ffffff", "line-width": 7, "line-opacity": .8 } });
        instance.addSource("markers", { type: "geojson", data: current.markers });
        instance.addLayer({ id: "lap-markers", type: "circle", source: "markers", paint: { "circle-radius": ["case", ["==", ["get", "kind"], "lap"], 4, 7], "circle-color": ["match", ["get", "kind"], "start", "#6ee7b7", "finish", "#fb7185", "#94a3b8"], "circle-stroke-color": "#0c1422", "circle-stroke-width": 2 } });
        instance.addSource("weather", { type: "geojson", data: emptyCollection });
        instance.addLayer({ id: "weather-arrows", type: "line", source: "weather", paint: { "line-color": ["case", ["get", "selected"], "#ffffff", "#7dd3fc"], "line-width": ["case", ["get", "selected"], 4, 2], "line-opacity": .9 } });
        instance.addLayer({ id: "weather-markers", type: "circle", source: "weather", paint: { "circle-radius": 3, "circle-color": "#7dd3fc", "circle-stroke-color": "#122033", "circle-stroke-width": 1 } });
        instance.addSource("cursor", { type: "geojson", data: emptyCollection });
        instance.addLayer({ id: "cursor", type: "circle", source: "cursor", paint: { "circle-radius": 8, "circle-color": "#ffffff", "circle-stroke-color": "#60a5fa", "circle-stroke-width": 3 } });
        setReady(true);
        fitPoints(instance, current.points);
        scheduleOverlay();
      } catch (loadError) {
        const detail = loadError instanceof Error ? `: ${loadError.message}` : "";
        setError(`MapLibre source rendering is unavailable${detail}. Browser route fallback is active.`);
        setReady(true);
        fitPoints(instance, routeData.current.points);
        scheduleOverlay();
      }
    });
    instance.on("mousemove", "route-hit", event => {
      const index = Number(event.features?.[0]?.properties?.index);
      if (Number.isInteger(index)) latest.current.onHover(index);
      instance.getCanvas().style.cursor = "crosshair";
    });
    instance.on("mouseleave", "route-hit", () => { instance.getCanvas().style.cursor = ""; latest.current.onHover(null); });
    instance.on("click", "lap-markers", event => {
      const lap = event.features?.[0]?.properties;
      if (lap && lap.kind === "lap") latest.current.onSelect([Number(lap.start), Number(lap.end)]);
    });
    instance.on("error", event => {
      const detail = event.error?.message ? `: ${event.error.message}` : "";
      setError(`MapLibre source warning${detail}. Browser route fallback remains active.`);
    });
    const resize = () => { instance.resize(); scheduleOverlay(); };
    const observer = new ResizeObserver(resize);
    observer.observe(container.current);
    const fullscreenChanged = () => {
      // The full map stack (tiles, route and marker) must be laid out before projection.
      requestAnimationFrame(resize);
    };
    document.addEventListener("fullscreenchange", fullscreenChanged);
    return () => {
      observer.disconnect();
      document.removeEventListener("fullscreenchange", fullscreenChanged);
      if (frame) cancelAnimationFrame(frame);
      refreshOverlayRef.current = null;
      instance.remove();
      map.current = null;
    };
  }, [projection.activity.id]);

  function fitRoute() {
    const m = map.current;
    if (!m) return;
    fitPoints(m, points);
    refreshOverlayRef.current?.();
  }

  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !m.isStyleLoaded()) { refreshOverlayRef.current?.(); return; }
    const baseSource = m.getSource("route-base") as GeoJSONSource | undefined;
    const routeSource = m.getSource("route") as GeoJSONSource | undefined;
    const markerSource = m.getSource("markers") as GeoJSONSource | undefined;
    if (baseSource && routeSource && markerSource) {
      baseSource.setData(baseRoute);
      routeSource.setData(features);
      markerSource.setData(markers);
    }
    refreshOverlayRef.current?.();
  }, [baseRoute, features, markers, ready]);

  useEffect(() => {
    setTileError(false);
    refreshOverlayRef.current?.();
  }, [tiles]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !m.isStyleLoaded()) return;
    const weatherSource = m.getSource("weather") as GeoJSONSource | undefined;
    if (!weatherSource) return;
    const weather = (projection.weather?.samples ?? []).filter(sample => pointIndices.has(sample.index) && sample.windDirectionDegrees !== null).map(sample => {
      const direction = (sample.windDirectionDegrees! + 180) % 360;
      const tip = moveCoordinate(sample.longitude, sample.latitude, direction, .00045);
      const left = moveCoordinate(tip[0], tip[1], direction + 150, .00016);
      const right = moveCoordinate(tip[0], tip[1], direction - 150, .00016);
      return {
        type: "Feature" as const,
        properties: { selected: Boolean(selection && sample.index >= selection[0] && sample.index <= selection[1]), index: sample.index },
        geometry: { type: "MultiLineString" as const, coordinates: [
          [[sample.longitude, sample.latitude], tip], [left, tip], [right, tip],
        ] },
      };
    });
    weatherSource.setData({ type: "FeatureCollection", features: weather });
  }, [projection.weather, ready, pointIndices, selection]);

  useEffect(() => { if (ready) fitRoute(); }, [points, ready]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !m.getLayer("route-selection")) return;
    m.setFilter("route-selection", selection ? ["all", [">=", ["get", "index"], selection[0]], ["<=", ["get", "end"], selection[1]]] : ["==", ["get", "index"], -1]);
  }, [selection, ready]);

  useEffect(() => {
    const runner = resolveRunnerPosition(runnerPoints, hover, projection.streams.elapsed);
    refreshOverlayRef.current?.();
    const m = map.current;
    if (!m || !ready || !m.isStyleLoaded()) return;
    const cursorSource = m.getSource("cursor") as GeoJSONSource | undefined;
    if (!cursorSource) return;
    cursorSource.setData({ type: "FeatureCollection", features: runner ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [runner.lon, runner.lat] } }] : [] });
  }, [hover, ready, projection.streams.elapsed, runnerPoints]);

  if (!projection.streams.latitude.some(v => v !== null)) return <section className={styles.panel}><h3>Indoor activity</h3><p className={styles.empty}>No GPS was recorded. Explore your pace, heart rate and laps in the timeline.</p></section>;

  return <section className={styles.panel} aria-label="Route analysis">
    <div className={styles.panelHeading}><div><span className={styles.eyebrow}>THE ROUTE</span><h3>Every turn, in context</h3></div><div className={styles.mapActions}><button onClick={fitRoute}>Fit route</button><button onClick={() => {
      if (document.fullscreenElement === viewport.current) void document.exitFullscreen();
      else void viewport.current?.requestFullscreen();
    }}>Fullscreen map</button></div></div>
    <div className={styles.toolbar}>
      <label>Colour by<select aria-label="Route colour metric" value={metric} onChange={e => setMetric(e.target.value as Channel)}>{(["heart_rate", "pace", "power", "cadence", "grade"] as Channel[]).filter(k => projection.streams.channels[k]).map(k => <option key={k} value={k}>{CHANNELS[k].label}</option>)}</select></label>
      <label>Scale<select value={colourMode} onChange={e => setColourMode(e.target.value)}><option value="intensity">Intensity</option><option value="zones" disabled={!projection.zones[metric]?.length}>Configured zones</option></select></label>
      <label>Start / finish privacy<select aria-label="Endpoint privacy radius" value={radius} onChange={e => onPrivacyChange({ ...privacy, endpointRadius: Number(e.target.value) })}>{[0, 100, 200, 500, 1000].map(v => <option key={v} value={v}>{v ? `${v} m` : "Off"}</option>)}</select></label>
      <label className={styles.check}><input type="checkbox" checked={tiles} onChange={e => setTiles(e.target.checked)} />Street map</label>
    </div>
    <div ref={viewport} className={styles.mapViewport} aria-label="Resizable route map">
      {tiles && <div aria-hidden="true" style={{ position: "absolute", inset: 1, overflow: "hidden", zIndex: 1, pointerEvents: "none", borderRadius: 11 }}>
        {browserOverlay.tiles.map(tile => <img key={tile.key} src={tile.url} alt="" draggable={false} onError={() => setTileError(true)} style={{ position: "absolute", left: tile.left, top: tile.top, width: tile.size + 1, height: tile.size + 1, maxWidth: "none", opacity: .82, filter: "saturate(.75) brightness(.72)" }} />)}
      </div>}
      <div ref={container} className={styles.map} aria-label="Interactive activity map" style={{ position: "relative", background: "transparent" }} />
      <svg aria-hidden="true" width="100%" height="100%" style={{ position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none" }}>
        {browserOverlay.paths.map(path => <path key={`base-${path.segment}`} d={path.d} fill="none" stroke="#38bdf8" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" opacity=".9" />)}
        {browserOverlay.lines.map(line => <line key={line.key} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke={line.color} strokeWidth="4" strokeLinecap="round" />)}
        {browserOverlay.markers.map(marker => <circle key={marker.kind} cx={marker.x} cy={marker.y} r="7" fill={marker.kind === "start" ? "#6ee7b7" : "#fb7185"} stroke="#0c1422" strokeWidth="2" />)}
        {browserOverlay.runner && <circle cx={browserOverlay.runner.x} cy={browserOverlay.runner.y} r="5.5" fill="#60a5fa" stroke="#ffffff" strokeWidth="2.5" />}
      </svg>
      {tiles && <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" style={{ position: "absolute", right: 4, bottom: 3, zIndex: 6, fontSize: 9, color: "#d8e7f7", background: "rgba(6,17,29,.8)", padding: "2px 4px", borderRadius: 3 }}>© OpenStreetMap contributors</a>}
    </div>
    {error && <p role="status" className={styles.quiet}>{error}</p>}
    {tileError && tiles && <p role="status" className={styles.quiet}>Some OpenStreetMap tile images were blocked or unavailable. The recorded GPS route remains visible independently.</p>}
    {!points.length && <p className={styles.quiet}>No route points are currently visible. Set start / finish privacy to Off or clear custom masks.</p>}
    <p className={styles.quiet}>GPS samples {gpsSamples.toLocaleString()} · visible route points {points.length.toLocaleString()} · base route segments {baseRoute.features.length.toLocaleString()} · coloured segments {features.features.length.toLocaleString()} · position {hover === null ? "waiting for chart scrub" : browserOverlay.runner ? "synced" : "hidden at route gap"} · browser overlay {browserOverlay.paths.length ? "active" : "waiting"} · street tiles {tiles ? browserOverlay.tiles.length.toLocaleString() : "off"} · map {ready ? "ready" : "loading"}</p>
    <div className={styles.mapLegend}><span>{formatChannel(metric, limits.min, units)}</span><i /><span>{formatChannel(metric, limits.max, units)}</span></div>
    <p className={styles.quiet}>Scrub any chart to move the position marker along the same GPS moment. Start <span style={{ color: "#6ee7b7" }}>●</span> · Finish <span style={{ color: "#fb7185" }}>●</span>{projection.weather?.status === "available" ? " · Blue arrows show wind direction" : ""} · Click a lap marker to select it.</p>
    <details className={styles.details}><summary>Map privacy & detail <span>{radius ? `${radius} m masked` : "Mask off"}</span></summary>
      <div className={styles.toolbar}><label>Route detail<select value={density} onChange={e => setDensity(Number(e.target.value))}><option value={1000}>Light</option><option value={2000}>Balanced</option><option value={10000}>Detailed</option></select></label></div>
      <p className={styles.quiet}>Hover a route point, then mask it below to hide a 200 m home region for this session. Masks hide points and connecting segments; original data and raw exports remain complete.</p>
      <button disabled={hover === null || projection.streams.latitude[hover] === null} onClick={() => {
        if (hover !== null && projection.streams.latitude[hover] !== null && projection.streams.longitude[hover] !== null) onPrivacyChange({ ...privacy, regions: [...regions, { latitude: projection.streams.latitude[hover]!, longitude: projection.streams.longitude[hover]!, radius: 200 }] });
      }}>Mask inspected location</button>{regions.length > 0 && <button onClick={() => onPrivacyChange({ ...privacy, regions: [] })}>Clear {regions.length} home masks</button>}
      <p className={styles.quiet}>Street tiles are supplied directly by OpenStreetMap and reveal the viewed map area to that provider. Local FIT files start with street tiles off.</p>
    </details>
  </section>;
});
