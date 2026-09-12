"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  analyseDecodedFit,
  buildActivityAnalysisProjection,
  formatDistance,
  formatDuration,
  formatPace,
  normaliseDate,
  paceSecondsFromSpeed,
  selectProjectionRange,
  serialisable,
  summarizeProjectionRange,
  type ActivityAnalysisProjection,
  type AnalysisChannelKey,
  type AnalysisStreamPoint,
  type AnalysedActivity,
} from "../../../lib/activity-analysis";
import styles from "./premium-activity.module.css";

type StoredActivity = {
  id: string;
  startedAt: string;
  normalizedData: Record<string, unknown>;
  sourceFileName?: string;
  sourceMetadata: Record<string, unknown>;
};

type ApiEnvelope<T> = { data: T; error?: { message?: string } };
type AxisMode = "time" | "distance";
type DetailTab = "overview" | "timeline" | "laps" | "zones" | "efforts" | "dynamics" | "raw";
type Selection = { start: number; end: number } | null;

type ChannelDefinition = {
  key: AnalysisChannelKey;
  label: string;
  short: string;
  format: (value: number) => string;
  inverse?: boolean;
};

const CHANNELS: ChannelDefinition[] = [
  { key: "heartRateBpm", label: "Heart rate", short: "HR", format: (value) => `${Math.round(value)} bpm` },
  { key: "paceSecondsPerKm", label: "Pace", short: "Pace", format: (value) => `${formatDuration(value)} /km`, inverse: true },
  { key: "cadenceSpm", label: "Cadence", short: "Cad", format: (value) => `${Math.round(value)} spm` },
  { key: "altitudeMeters", label: "Elevation", short: "Elev", format: (value) => `${Math.round(value)} m` },
  { key: "powerWatts", label: "Power", short: "Power", format: (value) => `${Math.round(value)} W` },
  { key: "gradePercent", label: "Gradient", short: "Grade", format: (value) => `${value.toFixed(1)}%` },
  { key: "temperatureC", label: "Temperature", short: "Temp", format: (value) => `${value.toFixed(1)} °C` },
  { key: "verticalOscillationMm", label: "Vertical oscillation", short: "VO", format: (value) => `${value.toFixed(1)} mm` },
  { key: "groundContactTimeMs", label: "Ground contact time", short: "GCT", format: (value) => `${Math.round(value)} ms` },
  { key: "respirationRateBpm", label: "Respiration", short: "Resp", format: (value) => `${value.toFixed(1)} br/min` },
];

const tabs: Array<[DetailTab, string]> = [
  ["overview", "Overview"],
  ["timeline", "Timeline"],
  ["laps", "Intervals / Laps"],
  ["zones", "Zones"],
  ["efforts", "Best Efforts"],
  ["dynamics", "Dynamics"],
  ["raw", "Raw Data"],
];

function sourceFor(item: StoredActivity) {
  const externalId = typeof item.sourceMetadata.externalId === "string" ? item.sourceMetadata.externalId : undefined;
  const sourceFileUrl = typeof item.sourceMetadata.sourceFileUrl === "string" ? item.sourceMetadata.sourceFileUrl : undefined;
  return {
    id: item.id,
    name: item.sourceFileName ?? `${externalId ?? item.id}.fit`,
    origin: "backend" as const,
    externalId,
    sourceFileUrl,
  };
}

function titleCase(value: unknown): string {
  return String(value ?? "")
    .replaceAll("_", " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function activityTitle(activity: AnalysedActivity): string {
  const session = activity.summary.session;
  return titleCase(session.sport_profile_name ?? session.sub_sport ?? session.sport ?? "Activity");
}

function dateText(value: unknown): string {
  const date = normaliseDate(value);
  if (!date) return "Unknown date";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "short" }).format(date);
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function formatChannel(key: AnalysisChannelKey, value: number | undefined): string {
  if (value === undefined) return "—";
  return CHANNELS.find((channel) => channel.key === key)?.format(value) ?? value.toFixed(2);
}

function routePoints(projection: ActivityAnalysisProjection): Array<{ index: number; lat: number; lon: number; value: AnalysisStreamPoint }> {
  return projection.stream.flatMap((point) => {
    const lat = point.channels.latitude;
    const lon = point.channels.longitude;
    return typeof lat === "number" && typeof lon === "number" ? [{ index: point.index, lat, lon, value: point }] : [];
  });
}

function haversineMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = (value: number) => value * Math.PI / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const lat1 = rad(a.lat);
  const lat2 = rad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function maskRoute(points: ReturnType<typeof routePoints>, privacyRadiusMeters: number) {
  if (!privacyRadiusMeters || points.length < 3) return points;
  const start = points[0];
  const finish = points.at(-1)!;
  const filtered = points.filter((point) =>
    haversineMeters(point, start) >= privacyRadiusMeters && haversineMeters(point, finish) >= privacyRadiusMeters,
  );
  return filtered.length >= 2 ? filtered : [];
}

function xValue(point: AnalysisStreamPoint, axis: AxisMode): number | null {
  return axis === "time" ? point.elapsedSeconds : point.distanceMeters;
}

function smoothSeries(points: AnalysisStreamPoint[], key: AnalysisChannelKey, windowSize: number): Array<number | null> {
  const values = points.map((point) => point.channels[key] ?? null);
  if (windowSize <= 1) return values;
  const half = Math.floor(windowSize / 2);
  return values.map((value, index) => {
    if (value === null) return null;
    const sample = values.slice(Math.max(0, index - half), Math.min(values.length, index + half + 1)).filter((candidate): candidate is number => candidate !== null);
    return average(sample);
  });
}

function downsampleIndexes(length: number, limit: number): number[] {
  if (length <= limit) return Array.from({ length }, (_, index) => index);
  const step = (length - 1) / (limit - 1);
  const result: number[] = [];
  for (let index = 0; index < limit; index += 1) result.push(Math.round(index * step));
  return [...new Set(result)];
}

function TimelineChart({
  projection,
  channels,
  axis,
  smoothing,
  selection,
  setSelection,
  hoveredIndex,
  setHoveredIndex,
  visibleRange,
}: {
  projection: ActivityAnalysisProjection;
  channels: AnalysisChannelKey[];
  axis: AxisMode;
  smoothing: number;
  selection: Selection;
  setSelection: (selection: Selection) => void;
  hoveredIndex: number | null;
  setHoveredIndex: (index: number | null) => void;
  visibleRange: Selection;
}) {
  const width = 1200;
  const rowHeight = 130;
  const left = 70;
  const right = 18;
  const top = 18;
  const bottom = 28;
  const dragStart = useRef<number | null>(null);
  const stream = projection.stream;
  const visibleStart = visibleRange ? Math.max(0, Math.min(visibleRange.start, visibleRange.end)) : 0;
  const visibleEnd = visibleRange ? Math.min(stream.length - 1, Math.max(visibleRange.start, visibleRange.end)) : stream.length - 1;
  const visible = stream.slice(visibleStart, visibleEnd + 1);
  const height = top + rowHeight * channels.length + bottom;
  const xs = visible.map((point) => xValue(point, axis)).filter((value): value is number => value !== null);
  const minX = xs.length ? Math.min(...xs) : 0;
  const maxX = xs.length ? Math.max(...xs) : 1;
  const px = (value: number) => left + ((value - minX) / Math.max(1e-9, maxX - minX)) * (width - left - right);
  const indexFromPointer = (clientX: number, rect: DOMRect) => {
    const svgX = ((clientX - rect.left) / Math.max(1, rect.width)) * width;
    const ratio = Math.max(0, Math.min(1, (svgX - left) / Math.max(1, width - left - right)));
    const target = minX + ratio * (maxX - minX);
    let best = visibleStart;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let local = 0; local < visible.length; local += 1) {
      const value = xValue(visible[local], axis);
      if (value === null) continue;
      const distance = Math.abs(value - target);
      if (distance < bestDistance) {
        best = visibleStart + local;
        bestDistance = distance;
      }
    }
    return best;
  };
  const selectedLow = selection ? Math.min(selection.start, selection.end) : null;
  const selectedHigh = selection ? Math.max(selection.start, selection.end) : null;
  const selectedX1 = selectedLow !== null && stream[selectedLow] ? xValue(stream[selectedLow], axis) : null;
  const selectedX2 = selectedHigh !== null && stream[selectedHigh] ? xValue(stream[selectedHigh], axis) : null;
  const hovered = hoveredIndex !== null ? stream[hoveredIndex] : null;
  const hoveredX = hovered ? xValue(hovered, axis) : null;

  return (
    <div className={styles.timelineScroller}>
      <svg
        className={styles.timelineSvg}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Synchronized activity timeline"
        onPointerDown={(event) => {
          const index = indexFromPointer(event.clientX, event.currentTarget.getBoundingClientRect());
          dragStart.current = index;
          setSelection({ start: index, end: index });
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const index = indexFromPointer(event.clientX, event.currentTarget.getBoundingClientRect());
          setHoveredIndex(index);
          if (dragStart.current !== null) setSelection({ start: dragStart.current, end: index });
        }}
        onPointerUp={(event) => {
          if (dragStart.current !== null) {
            const index = indexFromPointer(event.clientX, event.currentTarget.getBoundingClientRect());
            setSelection({ start: dragStart.current, end: index });
          }
          dragStart.current = null;
          try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* no-op */ }
        }}
        onPointerLeave={() => { if (dragStart.current === null) setHoveredIndex(null); }}
      >
        <rect x="0" y="0" width={width} height={height} className={styles.timelineBackground} />
        {channels.map((key, row) => {
          const definition = CHANNELS.find((channel) => channel.key === key)!;
          const values = smoothSeries(stream, key, smoothing);
          const indexes = downsampleIndexes(visible.length, 1800).map((local) => local + visibleStart);
          const numeric = indexes.map((index) => values[index]).filter((value): value is number => value !== null && Number.isFinite(value));
          let minY = numeric.length ? Math.min(...numeric) : 0;
          let maxY = numeric.length ? Math.max(...numeric) : 1;
          if (minY === maxY) { minY -= 1; maxY += 1; }
          const rowTop = top + row * rowHeight;
          const rowBottom = rowTop + rowHeight - 18;
          const py = (value: number) => {
            const ratio = (value - minY) / Math.max(1e-9, maxY - minY);
            const normal = definition.inverse ? ratio : 1 - ratio;
            return rowTop + 8 + normal * (rowBottom - rowTop - 16);
          };
          const d = indexes.flatMap((index, pathIndex) => {
            const point = stream[index];
            const xv = xValue(point, axis);
            const yv = values[index];
            if (xv === null || yv === null) return [];
            return [`${pathIndex === 0 ? "M" : "L"}${px(xv).toFixed(1)},${py(yv).toFixed(1)}`];
          }).join(" ");
          return (
            <g key={key}>
              <line x1={left} x2={width - right} y1={rowBottom} y2={rowBottom} className={styles.gridLine} />
              <text x="12" y={rowTop + 24} className={styles.axisLabel}>{definition.short}</text>
              <text x="12" y={rowTop + 43} className={styles.axisValue}>{definition.format(maxY)}</text>
              <text x="12" y={rowBottom - 2} className={styles.axisValue}>{definition.format(minY)}</text>
              <path d={d} className={styles.trace} vectorEffect="non-scaling-stroke" />
            </g>
          );
        })}
        {selectedX1 !== null && selectedX2 !== null && (
          <rect
            x={Math.min(px(selectedX1), px(selectedX2))}
            y={top}
            width={Math.max(2, Math.abs(px(selectedX2) - px(selectedX1)))}
            height={rowHeight * channels.length - 18}
            className={styles.selectionBrush}
          />
        )}
        {hoveredX !== null && (
          <line x1={px(hoveredX)} x2={px(hoveredX)} y1={top} y2={top + rowHeight * channels.length - 18} className={styles.crosshair} />
        )}
        <text x={left} y={height - 8} className={styles.axisValue}>{axis === "time" ? formatDuration(minX) : `${(minX / 1000).toFixed(2)} km`}</text>
        <text x={width - right} y={height - 8} textAnchor="end" className={styles.axisValue}>{axis === "time" ? formatDuration(maxX) : `${(maxX / 1000).toFixed(2)} km`}</text>
      </svg>
    </div>
  );
}

function metricColourExpression(min: number, max: number) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return "#3b82f6";
  return ["interpolate", ["linear"], ["get", "metric"], min, "#2563eb", (min + max) / 2, "#f59e0b", max, "#ef4444"];
}

function RouteMap({
  projection,
  selection,
  hoveredIndex,
  setHoveredIndex,
}: {
  projection: ActivityAnalysisProjection;
  selection: Selection;
  hoveredIndex: number | null;
  setHoveredIndex: (index: number | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [colourBy, setColourBy] = useState<"heartRateBpm" | "paceSecondsPerKm" | "powerWatts" | "cadenceSpm" | "gradePercent">("heartRateBpm");
  const [privacyRadius, setPrivacyRadius] = useState(0);
  const route = useMemo(() => maskRoute(routePoints(projection), privacyRadius), [projection, privacyRadius]);

  useEffect(() => {
    if (!containerRef.current || route.length < 2) return;
    let cancelled = false;
    const ensureCss = () => {
      if (document.querySelector("link[data-maplibre-css]")) return;
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/maplibre-gl@5.7.1/dist/maplibre-gl.css";
      link.dataset.maplibreCss = "true";
      document.head.appendChild(link);
    };
    const load = async () => {
      ensureCss();
      let maplibre = (window as unknown as { maplibregl?: any }).maplibregl;
      if (!maplibre) {
        await new Promise<void>((resolve, reject) => {
          const existing = document.querySelector<HTMLScriptElement>("script[data-maplibre-js]");
          if (existing) {
            existing.addEventListener("load", () => resolve(), { once: true });
            existing.addEventListener("error", () => reject(new Error("MapLibre failed to load")), { once: true });
            return;
          }
          const script = document.createElement("script");
          script.src = "https://unpkg.com/maplibre-gl@5.7.1/dist/maplibre-gl.js";
          script.async = true;
          script.dataset.maplibreJs = "true";
          script.onload = () => resolve();
          script.onerror = () => reject(new Error("MapLibre failed to load"));
          document.head.appendChild(script);
        });
        maplibre = (window as unknown as { maplibregl?: any }).maplibregl;
      }
      if (cancelled || !maplibre || !containerRef.current) return;
      const map = new maplibre.Map({
        container: containerRef.current,
        style: {
          version: 8,
          sources: {
            osm: {
              type: "raster",
              tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
              tileSize: 256,
              attribution: "© OpenStreetMap contributors",
            },
          },
          layers: [{ id: "osm", type: "raster", source: "osm" }],
        },
        center: [route[0].lon, route[0].lat],
        zoom: 13,
      });
      map.addControl(new maplibre.NavigationControl(), "top-right");
      map.addControl(new maplibre.FullscreenControl(), "top-right");
      map.on("load", () => {
        if (cancelled) return;
        mapRef.current = map;
        markerRef.current = new maplibre.Marker({ color: "#ffffff", scale: 0.7 })
          .setLngLat([route[0].lon, route[0].lat])
          .addTo(map);
        setReady(true);
      });
      return map;
    };
    let activeMap: any = null;
    void load().then((map) => { activeMap = map; }).catch(() => setReady(false));
    return () => {
      cancelled = true;
      setReady(false);
      mapRef.current = null;
      markerRef.current = null;
      activeMap?.remove?.();
    };
  // Recreate only when the route masking geometry changes.
  }, [route.length, privacyRadius]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || route.length < 2) return;
    const values = route.map((point) => point.value.channels[colourBy]).filter((value): value is number => typeof value === "number");
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 1;
    const features = route.slice(0, -1).map((point, index) => {
      const next = route[index + 1];
      const raw = point.value.channels[colourBy];
      const metric = typeof raw === "number" ? (colourBy === "paceSecondsPerKm" ? -raw : raw) : 0;
      return {
        type: "Feature",
        properties: { metric, pointIndex: point.index },
        geometry: { type: "LineString", coordinates: [[point.lon, point.lat], [next.lon, next.lat]] },
      };
    });
    const colourValues = features.map((feature) => feature.properties.metric);
    const colourMin = colourValues.length ? Math.min(...colourValues) : min;
    const colourMax = colourValues.length ? Math.max(...colourValues) : max;
    const selectedLow = selection ? Math.min(selection.start, selection.end) : -1;
    const selectedHigh = selection ? Math.max(selection.start, selection.end) : -1;
    const selected = features.filter((feature) => feature.properties.pointIndex >= selectedLow && feature.properties.pointIndex <= selectedHigh);
    const routeData = { type: "FeatureCollection", features };
    const selectedData = { type: "FeatureCollection", features: selected };

    const upsertSource = (id: string, data: any) => {
      const source = map.getSource(id);
      if (source) source.setData(data);
      else map.addSource(id, { type: "geojson", data });
    };
    upsertSource("activity-route", routeData);
    upsertSource("activity-selected", selectedData);
    if (!map.getLayer("activity-route-line")) {
      map.addLayer({
        id: "activity-route-line",
        type: "line",
        source: "activity-route",
        paint: { "line-width": 5, "line-opacity": 0.92, "line-color": metricColourExpression(colourMin, colourMax) },
      });
      map.on("mousemove", "activity-route-line", (event: any) => {
        const index = Number(event.features?.[0]?.properties?.pointIndex);
        if (Number.isFinite(index)) setHoveredIndex(index);
        map.getCanvas().style.cursor = "crosshair";
      });
      map.on("mouseleave", "activity-route-line", () => {
        map.getCanvas().style.cursor = "";
        setHoveredIndex(null);
      });
    } else {
      map.setPaintProperty("activity-route-line", "line-color", metricColourExpression(colourMin, colourMax));
    }
    if (!map.getLayer("activity-selected-line")) {
      map.addLayer({
        id: "activity-selected-line",
        type: "line",
        source: "activity-selected",
        paint: { "line-width": 8, "line-color": "#ffffff", "line-opacity": 0.85 },
      });
    }
    const bounds = route.reduce((box: any, point) => box.extend([point.lon, point.lat]), new ((window as unknown as { maplibregl: any }).maplibregl.LngLatBounds)());
    if (!map.__paulRunningFitted) {
      map.fitBounds(bounds, { padding: 44, duration: 0 });
      map.__paulRunningFitted = true;
    }
  }, [ready, route, colourBy, selection, setHoveredIndex]);

  useEffect(() => {
    if (hoveredIndex === null || !markerRef.current) return;
    const point = route.find((candidate) => candidate.index === hoveredIndex);
    if (point) markerRef.current.setLngLat([point.lon, point.lat]);
  }, [hoveredIndex, route]);

  if (route.length < 2) {
    return <div className={styles.noMap}><strong>No GPS route</strong><span>This appears to be an indoor/treadmill activity or GPS coordinates were unavailable.</span></div>;
  }

  return (
    <section className={styles.mapCard}>
      <div className={styles.mapToolbar}>
        <div><strong>Interactive route</strong><span>OSM · hover is synchronized with the timeline</span></div>
        <div className={styles.mapControls}>
          <label>Colour by<select value={colourBy} onChange={(event) => setColourBy(event.target.value as typeof colourBy)}>
            <option value="heartRateBpm">Heart rate</option>
            <option value="paceSecondsPerKm">Pace</option>
            <option value="cadenceSpm">Cadence</option>
            <option value="powerWatts">Power</option>
            <option value="gradePercent">Gradient</option>
          </select></label>
          <label>Privacy<select value={privacyRadius} onChange={(event) => setPrivacyRadius(Number(event.target.value))}>
            <option value={0}>Off</option><option value={100}>100 m start/end</option><option value={200}>200 m start/end</option><option value={400}>400 m start/end</option>
          </select></label>
        </div>
      </div>
      <div ref={containerRef} className={styles.mapCanvas} />
      {!ready && <div className={styles.mapLoading}>Loading MapLibre + OpenStreetMap…</div>}
      <ElevationProfile projection={projection} hoveredIndex={hoveredIndex} setHoveredIndex={setHoveredIndex} />
    </section>
  );
}

function ElevationProfile({ projection, hoveredIndex, setHoveredIndex }: { projection: ActivityAnalysisProjection; hoveredIndex: number | null; setHoveredIndex: (value: number | null) => void }) {
  const points = projection.stream.filter((point) => typeof point.channels.altitudeMeters === "number" && point.distanceMeters !== null);
  if (points.length < 2) return null;
  const width = 1000;
  const height = 90;
  const pad = 8;
  const minD = Math.min(...points.map((point) => point.distanceMeters as number));
  const maxD = Math.max(...points.map((point) => point.distanceMeters as number));
  const minA = Math.min(...points.map((point) => point.channels.altitudeMeters as number));
  const maxA = Math.max(...points.map((point) => point.channels.altitudeMeters as number));
  const x = (value: number) => pad + ((value - minD) / Math.max(1, maxD - minD)) * (width - pad * 2);
  const y = (value: number) => height - pad - ((value - minA) / Math.max(1, maxA - minA)) * (height - pad * 2);
  const d = points.map((point, index) => `${index ? "L" : "M"}${x(point.distanceMeters as number).toFixed(1)},${y(point.channels.altitudeMeters as number).toFixed(1)}`).join(" ");
  const hover = hoveredIndex === null ? null : projection.stream[hoveredIndex];
  return (
    <svg className={styles.elevationProfile} viewBox={`0 0 ${width} ${height}`} onPointerMove={(event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
      const target = minD + ratio * (maxD - minD);
      let best = points[0];
      for (const point of points) if (Math.abs((point.distanceMeters as number) - target) < Math.abs((best.distanceMeters as number) - target)) best = point;
      setHoveredIndex(best.index);
    }} onPointerLeave={() => setHoveredIndex(null)}>
      <path d={`${d} L${x(maxD)},${height - pad} L${x(minD)},${height - pad} Z`} className={styles.elevationFill} />
      <path d={d} className={styles.elevationLine} />
      {hover?.distanceMeters !== null && hover?.distanceMeters !== undefined && <line x1={x(hover.distanceMeters)} x2={x(hover.distanceMeters)} y1={0} y2={height} className={styles.crosshair} />}
    </svg>
  );
}

function SelectedRangeCards({ projection, selection }: { projection: ActivityAnalysisProjection; selection: Selection }) {
  const points = selection ? selectProjectionRange(projection, selection.start, selection.end) : projection.stream;
  const summary = summarizeProjectionRange(points);
  return (
    <div className={styles.selectionCards}>
      <span><small>{selection ? "Selected time" : "Total stream"}</small><strong>{formatDuration(summary.elapsedSeconds)}</strong></span>
      <span><small>Distance</small><strong>{formatDistance(summary.distanceMeters, "metric")}</strong></span>
      <span><small>Avg HR</small><strong>{summary.avgHeartRateBpm === null ? "—" : `${Math.round(summary.avgHeartRateBpm)} bpm`}</strong></span>
      <span><small>Avg pace</small><strong>{summary.avgSpeedMps === null ? "—" : formatPace(summary.avgSpeedMps, "metric")}</strong></span>
      <span><small>Avg cadence</small><strong>{summary.avgCadenceSpm === null ? "—" : `${Math.round(summary.avgCadenceSpm)} spm`}</strong></span>
      <span><small>Aerobic drift</small><strong>{projection.derived.efficiency.aerobicDecouplingPercent === null ? "—" : `${projection.derived.efficiency.aerobicDecouplingPercent.toFixed(1)}%`}</strong></span>
    </div>
  );
}

function Overview({ activity, projection, selection, hoveredIndex, setHoveredIndex }: { activity: AnalysedActivity; projection: ActivityAnalysisProjection; selection: Selection; hoveredIndex: number | null; setHoveredIndex: (index: number | null) => void }) {
  const session = activity.summary.session;
  const point = hoveredIndex === null ? null : projection.stream[hoveredIndex];
  return (
    <div className={styles.overviewGrid}>
      <div className={styles.primaryColumn}>
        <SelectedRangeCards projection={projection} selection={selection} />
        <RouteMap projection={projection} selection={selection} hoveredIndex={hoveredIndex} setHoveredIndex={setHoveredIndex} />
      </div>
      <aside className={styles.sideColumn}>
        <section className={styles.infoCard}>
          <span className={styles.cardEyebrow}>OUTCOME</span>
          <h3>{formatDistance(activity.summary.distance, "metric")} · {formatDuration(activity.summary.timerTime)}</h3>
          <dl>
            <div><dt>Average pace</dt><dd>{formatPace(activity.summary.avgSpeed, "metric")}</dd></div>
            <div><dt>Average HR</dt><dd>{session.avg_heart_rate ? `${session.avg_heart_rate} bpm` : "—"}</dd></div>
            <div><dt>Max HR</dt><dd>{session.max_heart_rate ? `${session.max_heart_rate} bpm` : "—"}</dd></div>
            <div><dt>Average cadence</dt><dd>{activity.summary.avgCadence ? `${Math.round(activity.summary.avgCadence)} spm` : "—"}</dd></div>
            <div><dt>Elevation gain</dt><dd>{activity.summary.totalAscent === null ? "—" : `${Math.round(activity.summary.totalAscent)} m`}</dd></div>
          </dl>
        </section>
        <section className={styles.infoCard}>
          <span className={styles.cardEyebrow}>ANALYSIS STATUS</span>
          <h3>Projection {projection.projectionVersion}</h3>
          <dl>
            <div><dt>Stream points</dt><dd>{projection.stream.length.toLocaleString()}</dd></div>
            <div><dt>Source channels</dt><dd>{projection.sourceChannels.length}</dd></div>
            <div><dt>GPS coverage</dt><dd>{projection.derived.dataQuality.gpsPointCount.toLocaleString()}</dd></div>
            <div><dt>Projection payload</dt><dd>{(projection.diagnostics.approximateJsonBytes / 1024).toFixed(1)} KB</dd></div>
          </dl>
        </section>
        {point && <section className={styles.hoverCard}><span>Cursor · {formatDuration(point.elapsedSeconds)}</span><strong>{point.distanceMeters === null ? "—" : `${(point.distanceMeters / 1000).toFixed(2)} km`}</strong><small>{formatChannel("heartRateBpm", point.channels.heartRateBpm)} · {formatChannel("paceSecondsPerKm", point.channels.paceSecondsPerKm)} · {formatChannel("cadenceSpm", point.channels.cadenceSpm)}</small></section>}
      </aside>
    </div>
  );
}

function LapsView({ projection }: { projection: ActivityAnalysisProjection }) {
  if (!projection.laps.length) return <div className={styles.emptyPanel}>No FIT lap messages were recorded.</div>;
  return (
    <section className={styles.tableCard}>
      <table><thead><tr><th>Lap</th><th>Time</th><th>Distance</th><th>Pace</th><th>Avg HR</th><th>Max HR</th><th>Cadence</th></tr></thead><tbody>
        {projection.laps.map((lap) => <tr key={lap.index}>
          <td>{lap.index + 1}</td><td>{formatDuration(lap.elapsedSeconds)}</td><td>{formatDistance(lap.distanceMeters, "metric")}</td><td>{formatPace(lap.avgSpeedMps, "metric")}</td>
          <td>{lap.avgHeartRateBpm === null ? "—" : `${Math.round(lap.avgHeartRateBpm)} bpm`}</td><td>{lap.maxHeartRateBpm === null ? "—" : `${Math.round(lap.maxHeartRateBpm)} bpm`}</td><td>{lap.avgCadenceSpm === null ? "—" : `${Math.round(lap.avgCadenceSpm)} spm`}</td>
        </tr>)}
      </tbody></table>
    </section>
  );
}

function Placeholder({ title, copy, status }: { title: string; copy: string; status: string }) {
  return <section className={styles.placeholder}><span>{status}</span><h3>{title}</h3><p>{copy}</p></section>;
}

export default function PremiumActivityWorkspace({ activityId }: { activityId: string }) {
  const [token, setToken] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [item, setItem] = useState<StoredActivity | null>(null);
  const [recent, setRecent] = useState<StoredActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<DetailTab>("overview");
  const [axis, setAxis] = useState<AxisMode>("time");
  const [smoothing, setSmoothing] = useState(3);
  const [selection, setSelection] = useState<Selection>(null);
  const [visibleRange, setVisibleRange] = useState<Selection>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [selectedChannels, setSelectedChannels] = useState<AnalysisChannelKey[]>(["heartRateBpm", "paceSecondsPerKm", "cadenceSpm", "altitudeMeters"]);

  const load = useCallback(async (activeToken: string) => {
    if (!activeToken.trim()) { setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const response = await fetch("/api/v1/activities?limit=60", { headers: { Authorization: `Bearer ${activeToken.trim()}`, "X-Client-Id": "premium-activity-workspace" } });
      const payload = await response.json().catch(() => ({})) as ApiEnvelope<StoredActivity[]>;
      if (!response.ok) throw new Error(payload.error?.message ?? `${response.status} ${response.statusText}`);
      const rows = payload.data ?? [];
      const found = rows.find((candidate) => candidate.id === activityId);
      if (!found) throw new Error("Activity was not found in the most recent canonical activity window.");
      window.sessionStorage.setItem("pauls-running-api-token", activeToken.trim());
      setToken(activeToken.trim()); setTokenInput(activeToken.trim()); setRecent(rows); setItem(found);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally { setLoading(false); }
  }, [activityId]);

  useEffect(() => {
    const saved = window.sessionStorage.getItem("pauls-running-api-token") ?? "";
    setToken(saved); setTokenInput(saved);
    void load(saved);
  }, [load]);

  const activity = useMemo(() => item ? analyseDecodedFit(sourceFor(item), item.normalizedData) : null, [item]);
  const projection = useMemo(() => item ? buildActivityAnalysisProjection(sourceFor(item), item.normalizedData) : null, [item]);
  const availableChannels = useMemo(() => projection ? CHANNELS.filter((channel) => projection.sourceChannels.includes(channel.key)) : [], [projection]);

  useEffect(() => {
    if (!projection) return;
    const available = new Set(projection.sourceChannels);
    const kept = selectedChannels.filter((key) => available.has(key));
    if (!kept.length && availableChannels.length) setSelectedChannels(availableChannels.slice(0, 4).map((channel) => channel.key));
    else if (kept.length !== selectedChannels.length) setSelectedChannels(kept);
    setSelection(null); setVisibleRange(null); setHoveredIndex(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projection?.source.id]);

  if (loading) return <main className={styles.centerState}><strong>Loading activity intelligence…</strong><span>Reading the canonical activity and building the analysis projection.</span></main>;
  if (!token || error || !activity || !projection) return (
    <main className={styles.centerState}>
      <Link href="/activity-analysis">← Activity Analysis</Link>
      <strong>{error ?? "Authentication required"}</strong>
      <span>Enter the Paul’s Running API token. It is stored only for this browser session.</span>
      <div className={styles.tokenPrompt}><input type="password" value={tokenInput} onChange={(event) => setTokenInput(event.target.value)} placeholder="PAUL_RUNNING_API_TOKEN" /><button onClick={() => void load(tokenInput)}>Open activity</button></div>
    </main>
  );

  const session = activity.summary.session;
  const hoverPoint = hoveredIndex === null ? null : projection.stream[hoveredIndex];
  const date = normaliseDate(activity.summary.start);
  const filteredRecent = recent.slice(0, 10);

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.breadcrumbs}><Link href="/">Paul&apos;s Running</Link><span>/</span><Link href="/activity-analysis">Activity Analysis</Link><span>/</span><strong>{activityTitle(activity)}</strong></div>
        <div className={styles.switcher}>
          <label>Switch activity<select value={activityId} onChange={(event) => { window.location.href = `/activity-analysis/${encodeURIComponent(event.target.value)}`; }}>
            {filteredRecent.map((candidate) => <option key={candidate.id} value={candidate.id}>{new Date(candidate.startedAt).toLocaleDateString()} · {candidate.sourceFileName ?? candidate.id}</option>)}
          </select></label>
        </div>
      </header>

      <section className={styles.hero}>
        <div>
          <span className={styles.heroEyebrow}>CANONICAL GARMIN ACTIVITY · PROJECTION {projection.projectionVersion}</span>
          <h1>{activityTitle(activity)}</h1>
          <p>{dateText(activity.summary.start)} · {titleCase(session.sport)}{session.sub_sport ? ` · ${titleCase(session.sub_sport)}` : ""}</p>
        </div>
        <div className={styles.heroMetrics}>
          <span><small>Distance</small><strong>{formatDistance(activity.summary.distance, "metric")}</strong></span>
          <span><small>Time</small><strong>{formatDuration(activity.summary.timerTime)}</strong></span>
          <span><small>Average pace</small><strong>{formatPace(activity.summary.avgSpeed, "metric")}</strong></span>
          <span><small>Average HR</small><strong>{session.avg_heart_rate ? `${session.avg_heart_rate} bpm` : "—"}</strong></span>
        </div>
      </section>

      <nav className={styles.tabs}>{tabs.map(([key, label]) => <button key={key} className={tab === key ? styles.activeTab : ""} onClick={() => setTab(key)}>{label}</button>)}</nav>

      <section className={styles.content}>
        {tab === "overview" && <Overview activity={activity} projection={projection} selection={selection} hoveredIndex={hoveredIndex} setHoveredIndex={setHoveredIndex} />}
        {tab === "timeline" && <>
          <section className={styles.timelineCard}>
            <div className={styles.timelineToolbar}>
              <div><strong>Multi-channel timeline</strong><span>Drag to select · hover to synchronize · up to five channels</span></div>
              <div className={styles.controlRow}>
                <label>X axis<select value={axis} onChange={(event) => setAxis(event.target.value as AxisMode)}><option value="time">Time</option><option value="distance">Distance</option></select></label>
                <label>Smoothing<select value={smoothing} onChange={(event) => setSmoothing(Number(event.target.value))}><option value={1}>Off</option><option value={3}>3 point</option><option value={5}>5 point</option><option value={9}>9 point</option></select></label>
                <button disabled={!selection} onClick={() => setVisibleRange(selection)}>Zoom to selection</button>
                <button onClick={() => { setVisibleRange(null); setSelection(null); }}>Reset</button>
              </div>
            </div>
            <div className={styles.channelPicker}>{availableChannels.map((channel) => <label key={channel.key}><input type="checkbox" checked={selectedChannels.includes(channel.key)} onChange={() => setSelectedChannels((current) => current.includes(channel.key) ? current.filter((key) => key !== channel.key) : current.length < 5 ? [...current, channel.key] : current)} />{channel.label}</label>)}</div>
            <TimelineChart projection={projection} channels={selectedChannels.slice(0, 5)} axis={axis} smoothing={smoothing} selection={selection} setSelection={setSelection} hoveredIndex={hoveredIndex} setHoveredIndex={setHoveredIndex} visibleRange={visibleRange} />
            <SelectedRangeCards projection={projection} selection={selection} />
            {hoverPoint && <div className={styles.hoverStrip}><strong>{formatDuration(hoverPoint.elapsedSeconds)}</strong><span>{hoverPoint.distanceMeters === null ? "—" : `${(hoverPoint.distanceMeters / 1000).toFixed(2)} km`}</span>{selectedChannels.map((key) => <span key={key}>{CHANNELS.find((channel) => channel.key === key)?.short}: {formatChannel(key, hoverPoint.channels[key])}</span>)}</div>}
          </section>
          <RouteMap projection={projection} selection={selection} hoveredIndex={hoveredIndex} setHoveredIndex={setHoveredIndex} />
        </>}
        {tab === "laps" && <LapsView projection={projection} />}
        {tab === "zones" && <Placeholder status="BATCH B" title="Zone distributions" copy="The Batch A projection already exposes the stable stream and derived namespace required for HR, pace, power and cadence zone distributions. Zone histograms and time-in-zone analysis are scheduled in PAU-29." />}
        {tab === "efforts" && <Placeholder status="BATCH B" title="Best efforts" copy="The projection includes the versioned best-effort namespace. Distance/time effort extraction and PB comparison are scheduled in PAU-30." />}
        {tab === "dynamics" && <section className={styles.dynamicsGrid}>{availableChannels.filter((channel) => ["cadenceSpm","powerWatts","verticalOscillationMm","groundContactTimeMs","respirationRateBpm","temperatureC","gradePercent"].includes(channel.key)).map((channel) => {
          const values = projection.stream.map((point) => point.channels[channel.key]).filter((value): value is number => typeof value === "number");
          const avg = average(values);
          return <article key={channel.key}><span>{channel.label}</span><strong>{avg === null ? "—" : channel.format(avg)}</strong><small>{values.length.toLocaleString()} samples</small></article>;
        })}</section>}
        {tab === "raw" && <section className={styles.rawCard}><div><strong>Projection diagnostics</strong><span>The immutable normalized FIT tree remains untouched. This read model is derived and recomputable.</span></div><pre>{JSON.stringify(serialisable({ projection, rawDecodedSections: activity.groups.map((group) => ({ key: group.key, count: group.count })) }), null, 2)}</pre></section>}
      </section>
    </main>
  );
}
