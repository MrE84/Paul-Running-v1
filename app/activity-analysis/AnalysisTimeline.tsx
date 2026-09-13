"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { CHANNELS, nearestIndex, type AnalysisProjection, type Axis, type Channel, type IndexRange } from "../../lib/activity-analysis/projection";
import { channelUnit, chartSamples, displayValue } from "../../lib/activity-analysis/selection";
import { formatDuration } from "../../lib/activity-analysis/core";
import type { UnitSystem } from "../../lib/activity-analysis/contracts";
import type { AnalysisInterval } from "../../lib/activity-analysis/intelligence";
import styles from "./analysis.module.css";

export interface TimelineProps {
  projection: AnalysisProjection; channels: Channel[]; axis: Axis; mode: "stacked" | "overlay";
  units: UnitSystem; smoothing: number; resolution: number; zones: boolean;
  plannedIntervals?: AnalysisInterval[];
  hover: number | null; selection: IndexRange | null; zoom: IndexRange | null;
  onHover: (index: number | null) => void; onSelect: (range: IndexRange | null) => void;
}

const Chart = memo(function Chart(props: Omit<TimelineProps, "mode"> & { compact: boolean }) {
  const { projection, channels, axis, units, smoothing, resolution, zones, plannedIntervals = [], compact, hover, selection, zoom, onHover, onSelect } = props;
  const container = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const current = useRef({ hover, selection, zoom, onHover, onSelect });
  current.current = { hover, selection, zoom, onHover, onSelect };
  const samples = useMemo(() => chartSamples(projection, channels, axis, resolution, smoothing, units), [projection, channels, axis, resolution, smoothing, units]);
  const distanceAxis = useMemo(() => projection.streams.distance.flatMap((d, i) => d === null ? [] : [{ value: d / (units === "metric" ? 1000 : 1609.344), index: i }]), [projection, units]);
  const distanceValues = useMemo(() => distanceAxis.map(p => p.value), [distanceAxis]);
  const xAt = (i: number) => axis === "time" ? projection.streams.elapsed[i] : projection.streams.distance[i] === null ? null : projection.streams.distance[i] / (units === "metric" ? 1000 : 1609.344);

  useEffect(() => {
    if (!container.current || samples.data[0].length < 2) return;
    const element = container.current;
    const indexAt = (x: number) => axis === "time" ? nearestIndex(projection.streams.elapsed, x) : distanceAxis[nearestIndex(distanceValues, x)]?.index ?? 0;
    let frame = 0;
    const scales: Record<string, uPlot.Scale> = { x: { time: false } };
    channels.forEach(k => { scales[k] = { auto: true, ...(k === "pace" ? { dir: -1 as const } : {}) }; });
    const chart = new uPlot({
      width: Math.max(240, element.clientWidth), height: compact ? 145 : 350,
      padding: [12, 12, 0, 4], legend: { show: false }, scales,
      cursor: { y: false, drag: { x: true, y: false, setScale: false }, points: { size: 5 } },
      select: { show: true, left: 0, top: 0, width: 0, height: 0 },
      series: [{}, ...channels.map(k => ({ label: CHANNELS[k].label, scale: k, stroke: CHANNELS[k].color, width: 1.5, spanGaps: false, points: { show: false } }))],
      axes: [
        { stroke: "#8c9bb0", grid: { stroke: "#1e2c3e", width: 1 }, ticks: { show: false }, size: 30, font: "10px system-ui", values: (_u, values) => values.map(v => axis === "time" ? formatDuration(v) : `${v.toFixed(1)}`) },
        ...channels.map((k, i): uPlot.Axis => ({
          scale: k, side: i % 2 ? 1 : 3, size: 48, stroke: CHANNELS[k].color,
          grid: { show: i === 0, stroke: "#1e2c3e", width: 1 }, ticks: { show: false }, font: "10px system-ui",
          values: (_u, values) => values.map(v => k === "pace" ? formatDuration(v) : Number(v.toFixed(1)).toString()),
        })),
      ],
      hooks: {
        setCursor: [(u) => {
          cancelAnimationFrame(frame);
          const x = u.cursor.left;
          frame = requestAnimationFrame(() => current.current.onHover(x == null || x < 0 ? null : indexAt(u.posToVal(x, "x"))));
        }],
        setSelect: [(u) => {
          if (u.select.width < 3) return;
          const start = indexAt(u.posToVal(u.select.left, "x"));
          const end = indexAt(u.posToVal(u.select.left + u.select.width, "x"));
          current.current.onSelect([Math.min(start, end), Math.max(start, end)]);
        }],
        drawClear: [(u) => {
          const k = channels[0];
          const ctx = u.ctx, box = u.bbox;
          ctx.save(); ctx.beginPath(); ctx.rect(box.left, box.top, box.width, box.height); ctx.clip();
          if (zones) projection.zones[k]?.forEach(z => {
              const min = displayValue(k, z.lower, units) ?? u.scales[k].min!;
              const max = displayValue(k, z.upper, units) ?? u.scales[k].max!;
              const y0 = u.valToPos(min, k, true), y1 = u.valToPos(max, k, true);
              ctx.fillStyle = `${z.color}15`; ctx.fillRect(box.left, Math.min(y0, y1), box.width, Math.abs(y1 - y0));
            });
          plannedIntervals.filter(interval => interval.target?.channel === k).forEach(interval => {
            const target = interval.target!;
            const start = xAt(interval.start), end = xAt(interval.end);
            const low = displayValue(k, target.lower, units), high = displayValue(k, target.upper, units);
            if (start === null || end === null || low === null || high === null) return;
            const x0 = u.valToPos(start, "x", true), x1 = u.valToPos(end, "x", true);
            const y0 = u.valToPos(low, k, true), y1 = u.valToPos(high, k, true);
            ctx.fillStyle = "#fbbf2424";
            ctx.strokeStyle = "#fbbf24aa";
            ctx.lineWidth = 1;
            ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.max(2, Math.abs(y1 - y0)));
            ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.max(2, Math.abs(y1 - y0)));
          });
          ctx.restore();
        }],
      },
    }, samples.data, element);
    plotRef.current = chart;
    const resize = new ResizeObserver(() => chart.setSize({ width: Math.max(240, element.clientWidth), height: compact ? 145 : 350 }));
    resize.observe(element);
    return () => { cancelAnimationFrame(frame); resize.disconnect(); plotRef.current = null; chart.destroy(); };
  }, [projection, channels, axis, units, samples, distanceAxis, distanceValues, compact, zones, plannedIntervals]);

  useEffect(() => {
    const chart = plotRef.current;
    if (!chart) return;
    const first = zoom ? xAt(zoom[0]) : samples.data[0][0];
    const last = zoom ? xAt(zoom[1]) : samples.data[0].at(-1);
    if (first != null && last != null && last > first) chart.setScale("x", { min: first, max: last });
    if (selection) {
      const a = xAt(selection[0]), b = xAt(selection[1]);
      if (a != null && b != null) {
        const left = chart.valToPos(a, "x"), right = chart.valToPos(b, "x");
        chart.setSelect({ left, top: 0, width: Math.max(0, right - left), height: chart.bbox.height / (window.devicePixelRatio || 1) }, false);
      }
    } else chart.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
  }, [zoom, selection, samples, axis, units]); // indices remain stable through axis and channel changes

  useEffect(() => {
    const chart = plotRef.current;
    if (!chart) return;
    const value = hover === null ? null : xAt(hover);
    chart.setCursor({ left: value === null ? -10 : chart.valToPos(value, "x"), top: -10 }, false);
  }, [hover, samples, axis, units]);

  const touchStart = useRef<number | null>(null);
  return <div className={styles.chartRow}>
    <div className={styles.chartLabels}>{channels.map(k => <span style={{ color: CHANNELS[k].color }} key={k}>{CHANNELS[k].label} <small>{channelUnit(k, units)}</small></span>)}</div>
    {samples.data[0].length < 2 ? <p className={styles.quiet}>Not enough aligned samples for this axis.</p> : <div ref={container} className={styles.plot} role="img" aria-label={`${channels.map(k => CHANNELS[k].label).join(", ")} timeline`}
      onPointerDown={event => { if (event.pointerType === "touch") touchStart.current = event.clientX; }}
      onPointerUp={event => {
        if (touchStart.current === null || !plotRef.current) return;
        const u = plotRef.current, rect = u.over.getBoundingClientRect();
        const a = u.posToVal(Math.max(0, Math.min(rect.width, touchStart.current - rect.left)), "x");
        const b = u.posToVal(Math.max(0, Math.min(rect.width, event.clientX - rect.left)), "x");
        const idx = (x: number) => axis === "time" ? nearestIndex(projection.streams.elapsed, x) : distanceAxis[nearestIndex(distanceValues, x)]?.index ?? 0;
        if (Math.abs(event.clientX - touchStart.current) > 8) onSelect([Math.min(idx(a), idx(b)), Math.max(idx(a), idx(b))]); else onHover(idx(b));
        touchStart.current = null;
      }} />}
  </div>;
});

export default memo(function AnalysisTimeline(props: TimelineProps) {
  const groups = useMemo(() => props.mode === "overlay" ? [props.channels] : props.channels.map(k => [k]), [props.channels, props.mode]);
  if (!props.channels.length) return <p className={styles.empty}>Choose at least one available channel.</p>;
  return <div className={styles.timeline}>{groups.map(keys => <Chart key={keys.join("-")} {...props} channels={keys} compact={props.mode === "stacked"} />)}
    <p className={styles.axisCaption}>{props.axis === "time" ? "Elapsed time" : `Distance (${props.units === "metric" ? "km" : "mi"})`} · Drag to select a range</p>
  </div>;
});
