"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as LibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
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
const emptyCollection = { type: "FeatureCollection" as const, features: [] };

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

export default memo(function AnalysisMap({ projection, hover, selection, onHover, onSelect, units, privacy, onPrivacyChange }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<LibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [metric, setMetric] = useState<Channel>(projection.streams.channels.heart_rate ? "heart_rate" : "pace");
  const [colourMode, setColourMode] = useState("intensity");
  const [density, setDensity] = useState(2000);
  const [tiles, setTiles] = useState(projection.source.origin === "backend");
  const radius = privacy.endpointRadius;
  const regions = privacy.regions;
  const latest = useRef({ onHover, onSelect }); latest.current = { onHover, onSelect };
  const points = useMemo(() => routeSamples(projection, radius, regions, density), [projection, radius, regions, density]);
  const pointIndices = useMemo(() => new Set(points.map(p => p.index)), [points]);
  const gpsSamples = useMemo(() => projection.streams.latitude.reduce((count, lat, index) => count + (lat !== null && projection.streams.longitude[index] !== null ? 1 : 0), 0), [projection]);
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
  const routeData = useRef({ features, markers, points });
  routeData.current = { features, markers, points };

  useEffect(() => {
    if (!container.current || !projection.streams.latitude.some(v => v !== null)) return;
    setReady(false);
    setError("");
    let instance: LibreMap;
    try {
      instance = new maplibregl.Map({ container: container.current, attributionControl: false,
        style: { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#122033" } }] },
        center: [0, 0], zoom: 1,
      });
    } catch { setError("The map needs WebGL. Try another browser; all charts and lap analysis remain available."); return; }
    map.current = instance;
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    instance.addControl(new maplibregl.FullscreenControl(), "top-right");
    instance.addControl(new maplibregl.AttributionControl({ compact: false }), "bottom-right");
    instance.on("load", () => {
      try {
        const current = routeData.current;
        instance.addSource("route", { type: "geojson", data: current.features });
        instance.addLayer({ id: "route-hit", type: "line", source: "route", paint: { "line-width": 20, "line-opacity": 0 } });
        instance.addLayer({ id: "route-line", type: "line", source: "route", paint: { "line-color": ["get", "color"], "line-width": 4 }, layout: { "line-cap": "round" } });
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
      } catch (loadError) {
        const detail = loadError instanceof Error ? `: ${loadError.message}` : "";
        setError(`The route map could not initialise${detail}`);
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
    instance.on("error", () => setError("Some map tiles or layers could not load. The recorded route data is still available below."));
    const observer = new ResizeObserver(() => instance.resize()); observer.observe(container.current);
    return () => { observer.disconnect(); instance.remove(); map.current = null; };
  }, [projection.activity.id]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !m.isStyleLoaded()) return;
    if (tiles && !m.getSource("basemap")) {
      m.addSource("basemap", { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>' });
      m.addLayer({ id: "basemap", type: "raster", source: "basemap", paint: { "raster-opacity": .7, "raster-saturation": -.75, "raster-brightness-max": .8 } }, "route-hit");
    } else if (!tiles && m.getSource("basemap")) { m.removeLayer("basemap"); m.removeSource("basemap"); }
  }, [tiles, ready]);

  function fitRoute() {
    const m = map.current;
    if (!m) return;
    fitPoints(m, points);
  }
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !m.isStyleLoaded()) return;
    const routeSource = m.getSource("route") as GeoJSONSource | undefined;
    const markerSource = m.getSource("markers") as GeoJSONSource | undefined;
    if (!routeSource || !markerSource) return;
    routeSource.setData(features);
    markerSource.setData(markers);
  }, [features, markers, ready]);
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
    const m = map.current;
    if (!m || !ready || !m.isStyleLoaded()) return;
    const cursorSource = m.getSource("cursor") as GeoJSONSource | undefined;
    if (!cursorSource) return;
    // Reapply the privacy predicate at full resolution, never snap a hidden point onto the map.
    const lat = hover === null ? null : projection.streams.latitude[hover], lon = hover === null ? null : projection.streams.longitude[hover];
    const visible = hover !== null && (pointIndices.has(hover) || routeSamples(projection, radius, regions, Number.MAX_SAFE_INTEGER).some(p => p.index === hover));
    cursorSource.setData({ type: "FeatureCollection", features: visible && lat != null && lon != null ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [lon, lat] } }] : [] });
  }, [hover, ready, projection, radius, regions, pointIndices]);

  if (!projection.streams.latitude.some(v => v !== null)) return <section className={styles.panel}><h3>Indoor activity</h3><p className={styles.empty}>No GPS was recorded. Explore your pace, heart rate and laps in the timeline.</p></section>;
  return <section className={styles.panel} aria-label="Route analysis">
    <div className={styles.panelHeading}><div><span className={styles.eyebrow}>THE ROUTE</span><h3>Every turn, in context</h3></div><button onClick={fitRoute}>Fit route</button></div>
    <div className={styles.toolbar}>
      <label>Colour by<select aria-label="Route colour metric" value={metric} onChange={e => setMetric(e.target.value as Channel)}>{(["heart_rate", "pace", "power", "cadence", "grade"] as Channel[]).filter(k => projection.streams.channels[k]).map(k => <option key={k} value={k}>{CHANNELS[k].label}</option>)}</select></label>
      <label>Scale<select value={colourMode} onChange={e => setColourMode(e.target.value)}><option value="intensity">Intensity</option><option value="zones" disabled={!projection.zones[metric]?.length}>Configured zones</option></select></label>
      <label>Start / finish privacy<select aria-label="Endpoint privacy radius" value={radius} onChange={e => onPrivacyChange({ ...privacy, endpointRadius: Number(e.target.value) })}>{[0, 100, 200, 500, 1000].map(v => <option key={v} value={v}>{v ? `${v} m` : "Off"}</option>)}</select></label>
      <label className={styles.check}><input type="checkbox" checked={tiles} onChange={e => setTiles(e.target.checked)} />Street map</label>
    </div>
    <div ref={container} className={styles.map} aria-label="Interactive activity map" />
    {error && <p role="status" className={styles.quiet}>{error}</p>}
    {!points.length && <p className={styles.quiet}>No route points are currently visible. Set start / finish privacy to Off or clear custom masks.</p>}
    <p className={styles.quiet}>GPS samples {gpsSamples.toLocaleString()} · visible route points {points.length.toLocaleString()} · rendered line segments {features.features.length.toLocaleString()}</p>
    <div className={styles.mapLegend}><span>{formatChannel(metric, limits.min, units)}</span><i /><span>{formatChannel(metric, limits.max, units)}</span></div>
    <p className={styles.quiet}>Start <span style={{ color: "#6ee7b7" }}>●</span> · Finish <span style={{ color: "#fb7185" }}>●</span>{projection.weather?.status === "available" ? " · Blue arrows show wind direction" : ""} · Click a lap marker to select it.</p>
    <details className={styles.details}><summary>Map privacy & detail <span>{radius ? `${radius} m masked` : "Mask off"}</span></summary>
      <div className={styles.toolbar}><label>Route detail<select value={density} onChange={e => setDensity(Number(e.target.value))}><option value={1000}>Light</option><option value={2000}>Balanced</option><option value={10000}>Detailed</option></select></label></div>
      <p className={styles.quiet}>Hover a route point, then mask it below to hide a 200 m home region for this session. Masks hide points and connecting segments; original data and raw exports remain complete.</p>
      <button disabled={hover === null || projection.streams.latitude[hover] === null} onClick={() => {
        if (hover !== null && projection.streams.latitude[hover] !== null && projection.streams.longitude[hover] !== null) onPrivacyChange({ ...privacy, regions: [...regions, { latitude: projection.streams.latitude[hover]!, longitude: projection.streams.longitude[hover]!, radius: 200 }] });
      }}>Mask inspected location</button>{regions.length > 0 && <button onClick={() => onPrivacyChange({ ...privacy, regions: [] })}>Clear {regions.length} home masks</button>}
      <p className={styles.quiet}>Street tiles are supplied by OpenStreetMap and reveal the viewed map area to that provider. Local FIT files start with street tiles off.</p>
    </details>
  </section>;
});