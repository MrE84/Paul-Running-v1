"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  availableComparisonIntervals,
  buildActivityComparison,
  type ActivityComparison,
  type ComparisonAlignment,
} from "../../../lib/activity-analysis/comparison";
import { formatDistance, formatDuration, formatPace } from "../../../lib/activity-analysis/core";
import { CHANNELS, type ActivityListItem, type AnalysisProjection, type Channel } from "../../../lib/activity-analysis/projection";
import { channelUnit, displayValue, formatChannel } from "../../../lib/activity-analysis/selection";
import type { UnitSystem } from "../../../lib/activity-analysis/contracts";
import styles from "./comparison.module.css";

type ApiEnvelope<T> = { data?: T; error?: { message?: string } };
export interface InitialComparisonState { ids: string[]; alignment: ComparisonAlignment; channels: string[]; relative: boolean; intervalLabel: string }
interface SavedComparison extends InitialComparisonState { name: string; shifts: Record<string, number> }
const STORAGE_KEY = "paul-running:comparison-sets:v1";

async function api<T>(path: string): Promise<T> {
  const response = await fetch(`/api/v1/${path}`, { cache: "no-store", headers: { "X-Client-Id": "activity-comparison" } });
  const payload = await response.json().catch(() => ({})) as ApiEnvelope<T>;
  if (!response.ok || payload.data === undefined) throw new Error(payload.error?.message ?? `${response.status} ${response.statusText}`);
  return payload.data;
}

function dateLabel(value: string | null): string {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Date unavailable" : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function relativeDisplay(channel: Channel, value: number, units: UnitSystem): number {
  if (units !== "imperial") return value;
  if (channel === "pace") return value * 1.609344;
  if (channel === "altitude") return value * 3.28084;
  if (channel === "temperature" || channel === "ambient_temperature") return value * 1.8;
  if (channel === "wind_speed" || channel === "headwind") return value * 2.236936;
  if (channel === "precipitation") return value / 25.4;
  return value;
}

function chartValue(comparison: ActivityComparison, channel: Channel, value: number, units: UnitSystem): number {
  return comparison.relative ? relativeDisplay(channel, value, units) : displayValue(channel, value, units)!;
}

function pathSegments(points: Array<{ x: number; y: number | null }>, x: (value: number) => number, y: (value: number) => number): string[] {
  const result: string[] = [];
  let current: string[] = [];
  for (const point of points) {
    if (point.y === null) {
      if (current.length > 1) result.push(current.join(" "));
      current = [];
    } else current.push(`${x(point.x).toFixed(1)},${y(point.y).toFixed(1)}`);
  }
  if (current.length > 1) result.push(current.join(" "));
  return result;
}

function ComparisonChart({ comparison, channel, units }: { comparison: ActivityComparison; channel: Channel; units: UnitSystem }) {
  const width = 1000, height = 330, padX = 54, padTop = 24, padBottom = 38;
  const [minimumX, maximumX] = comparison.domain;
  const values = comparison.series.flatMap(series => series.points.flatMap(point => {
    const value = point.values[channel];
    return typeof value === "number" && Number.isFinite(value) && point.x >= minimumX && point.x <= maximumX ? [chartValue(comparison, channel, value, units)] : [];
  }));
  if (!values.length || maximumX <= minimumX) return <div className={styles.empty}>No overlapping {CHANNELS[channel].label.toLowerCase()} samples are available.</div>;
  let minimumY = Math.min(...values), maximumY = Math.max(...values);
  if (minimumY === maximumY) { minimumY -= 1; maximumY += 1; }
  const x = (value: number) => padX + (value - minimumX) / (maximumX - minimumX) * (width - padX * 2);
  const invert = channel === "pace" && !comparison.relative;
  const y = (value: number) => padTop + (invert ? value - minimumY : maximumY - value) / Math.max(Number.EPSILON, maximumY - minimumY) * (height - padTop - padBottom);
  const xLabel = (value: number) => comparison.xUnit === "seconds"
    ? formatDuration(value)
    : `${(value / (units === "metric" ? 1000 : 1609.344)).toFixed(1)} ${units === "metric" ? "km" : "mi"}`;
  const yLabel = (value: number) => comparison.relative
    ? `${value > 0 ? "+" : ""}${channel === "pace" ? formatDuration(Math.abs(value)) : value.toFixed(1)}`
    : channel === "pace"
      ? formatDuration(value)
      : value.toFixed(channel === "speed" || channel === "grade" || channel === "temperature" || channel === "ambient_temperature" || channel === "wind_speed" || channel === "headwind" || channel === "precipitation" || channel === "vertical_oscillation" ? 1 : 0);
  return <section className={styles.chartCard}>
    <div className={styles.chartHeading}><div><h3>{CHANNELS[channel].label}</h3><p>{comparison.relative ? `Difference from ${comparison.series[0].title}` : channelUnit(channel, units)} · overlapping range only</p></div><div className={styles.legend}>{comparison.series.map(series => <span key={series.activityId}><i style={{ background: series.color }} />{series.title}</span>)}</div></div>
    <div className={styles.chartScroll}><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${CHANNELS[channel].label} overlay for ${comparison.series.length} activities`}>
      {[0, 1, 2, 3, 4].map(index => { const yy = padTop + index * (height - padTop - padBottom) / 4; return <line key={index} x1={padX} x2={width - padX} y1={yy} y2={yy} className={styles.gridLine} />; })}
      {comparison.series.map(series => {
        const points = series.points.filter(point => point.x >= minimumX && point.x <= maximumX).map(point => {
          const value = point.values[channel];
          return { x: point.x, y: typeof value === "number" && Number.isFinite(value) ? chartValue(comparison, channel, value, units) : null };
        });
        return pathSegments(points, x, y).map((path, index) => <polyline key={`${series.activityId}-${index}`} points={path} fill="none" stroke={series.color} strokeWidth="2.3" vectorEffect="non-scaling-stroke" />);
      })}
      <text x={padX} y={height - 10} className={styles.svgLabel}>{xLabel(minimumX)}</text><text x={width - padX} y={height - 10} textAnchor="end" className={styles.svgLabel}>{xLabel(maximumX)}</text>
      <text x={padX + 4} y={17} className={styles.svgLabel}>{yLabel(maximumY)} {comparison.relative ? channelUnit(channel, units) : ""}</text><text x={padX + 4} y={height - padBottom - 7} className={styles.svgLabel}>{yLabel(minimumY)} {comparison.relative ? channelUnit(channel, units) : ""}</text>
    </svg></div>
  </section>;
}

export default function ComparisonWorkspace({ initial }: { initial: InitialComparisonState }) {
  const validInitialChannels = initial.channels.filter((value): value is Channel => Object.hasOwn(CHANNELS, value)).slice(0, 5);
  const [activities, setActivities] = useState<ActivityListItem[]>([]);
  const [ids, setIds] = useState<string[]>(initial.ids);
  const [projections, setProjections] = useState<AnalysisProjection[]>([]);
  const [alignment, setAlignment] = useState<ComparisonAlignment>(initial.alignment);
  const [channels, setChannels] = useState<Channel[]>(validInitialChannels.length ? validInitialChannels : ["heart_rate", "pace"]);
  const [relative, setRelative] = useState(initial.relative);
  const [intervalLabel, setIntervalLabel] = useState(initial.intervalLabel);
  const [shifts, setShifts] = useState<Record<string, number>>({});
  const [units, setUnits] = useState<UnitSystem>("metric");
  const [saved, setSaved] = useState<SavedComparison[]>([]);
  const [setName, setSetName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api<ActivityListItem[]>("activities?view=summary&limit=100").then(setActivities).catch(value => setError(value instanceof Error ? value.message : String(value))).finally(() => setLoading(false));
    try { const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]"); if (Array.isArray(value)) setSaved(value.slice(0, 20)); } catch { /* Invalid local state is ignored. */ }
  }, []);

  useEffect(() => {
    if (ids.length < 2) { setProjections([]); return; }
    let cancelled = false;
    setLoading(true); setError(""); setProjections([]);
    const query = ids.map(id => `id=${encodeURIComponent(id)}`).join("&");
    api<AnalysisProjection[]>(`activities/comparison?${query}`).then(value => { if (!cancelled) setProjections(value); }).catch(value => { if (!cancelled) setError(value instanceof Error ? value.message : String(value)); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ids]);

  useEffect(() => {
    const search = new URLSearchParams();
    ids.forEach(id => search.append("id", id));
    search.set("align", alignment); search.set("channels", channels.join(","));
    if (relative) search.set("relative", "1");
    if (alignment === "interval" && intervalLabel) search.set("interval", intervalLabel);
    const next = `${window.location.pathname}?${search.toString()}`;
    window.history.replaceState(null, "", next);
  }, [ids, alignment, channels, relative, intervalLabel]);

  const availableChannels = useMemo(() => [...new Set(projections.flatMap(projection => Object.keys(projection.streams.channels) as Channel[]))], [projections]);
  const intervalOptions = useMemo(() => availableComparisonIntervals(projections), [projections]);
  const comparison = useMemo(() => projections.length >= 2 ? buildActivityComparison(projections, { alignment, channels, intervalLabel: intervalLabel || undefined, shifts, relative }) : null, [projections, alignment, channels, intervalLabel, shifts, relative]);

  function toggle(id: string) {
    setIds(current => current.includes(id) ? current.filter(value => value !== id) : current.length < 6 ? [...current, id] : current);
  }
  function saveSet() {
    const name = setName.trim();
    if (!name || ids.length < 2) return;
    const next = [...saved.filter(item => item.name !== name), { name, ids, alignment, channels, relative, intervalLabel, shifts }].slice(-20);
    setSaved(next); setSetName(""); localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  function openSet(item: SavedComparison) {
    setIds(item.ids.slice(0, 6)); setAlignment(item.alignment); setChannels(item.channels.filter((value): value is Channel => value in CHANNELS).slice(0, 5)); setRelative(item.relative); setIntervalLabel(item.intervalLabel); setShifts(item.shifts ?? {});
  }

  return <main className={styles.page}>
    <header className={styles.header}><div><Link href="/activity-analysis">← Activity Analysis</Link><span>REPEATED SESSION INTELLIGENCE</span><h1>Compare activities</h1><p>Overlay parkruns, threshold sessions or races and align the effort—not just the file start.</p></div><div className={styles.headerLinks}><Link href="/activity-analysis/trends">Performance trends →</Link><label>Units<select value={units} onChange={event => setUnits(event.target.value as UnitSystem)}><option value="metric">Metric</option><option value="imperial">Imperial</option></select></label></div></header>
    <div className={styles.workspace}>
      <aside className={styles.selector} aria-label="Choose activities"><div className={styles.selectorHeading}><div><h2>Activity set</h2><p>{ids.length}/6 selected</p></div>{ids.length > 0 && <button onClick={() => setIds([])}>Clear</button>}</div>
        {activities.map(activity => <label key={activity.id} className={styles.activity} data-selected={ids.includes(activity.id)}><input type="checkbox" checked={ids.includes(activity.id)} disabled={!ids.includes(activity.id) && ids.length >= 6} onChange={() => toggle(activity.id)} /><span><strong>{activity.title}</strong><small>{dateLabel(activity.startedAt)} · {formatDistance(activity.distance, units)} · {formatDuration(activity.duration)}</small></span></label>)}
        {!activities.length && <p className={styles.empty}>{loading ? "Loading activity history…" : "No canonical activities are available."}</p>}
      </aside>
      <section className={styles.content}>
        <div className={styles.controls}>
          <label>Align by<select value={alignment} onChange={event => setAlignment(event.target.value as ComparisonAlignment)}><option value="distance">Distance</option><option value="time">Elapsed time</option><option value="interval">Matched interval / step</option></select></label>
          {alignment === "interval" && <label>Interval<select value={intervalLabel} onChange={event => setIntervalLabel(event.target.value)}><option value="">Best detected match</option>{intervalOptions.map(label => <option key={label}>{label}</option>)}</select></label>}
          <label className={styles.check}><input type="checkbox" checked={relative} onChange={event => setRelative(event.target.checked)} />Show delta from first activity</label>
          <label>Channel<select value="" onChange={event => { const value = event.target.value as Channel; if (value && !channels.includes(value) && channels.length < 5) setChannels(current => [...current, value]); }}><option value="">+ Add channel</option>{availableChannels.filter(channel => !channels.includes(channel)).map(channel => <option key={channel} value={channel}>{CHANNELS[channel].label}</option>)}</select></label>
        </div>
        <div className={styles.channelList}>{channels.map(channel => <span key={channel}>{CHANNELS[channel].label}<button aria-label={`Remove ${CHANNELS[channel].label}`} disabled={channels.length === 1} onClick={() => setChannels(current => current.filter(value => value !== channel))}>×</button></span>)}</div>
        {projections.length > 1 && <details className={styles.shiftPanel}><summary>Manual alignment shifts</summary><div>{projections.map(projection => <label key={projection.activity.id}>{projection.activity.title}<input type="number" step={alignment === "distance" ? 10 : 1} value={shifts[projection.activity.id] ?? 0} onChange={event => setShifts(current => ({ ...current, [projection.activity.id]: Number(event.target.value) || 0 }))} /><span>{alignment === "distance" ? "m" : "sec"}</span></label>)}</div></details>}
        <div className={styles.savedBar}><input value={setName} onChange={event => setSetName(event.target.value)} placeholder="Name this comparison" /><button disabled={!setName.trim() || ids.length < 2} onClick={saveSet}>Save set</button><select value="" onChange={event => { const item = saved.find(value => value.name === event.target.value); if (item) openSet(item); }}><option value="">Open saved set…</option>{saved.map(item => <option key={item.name}>{item.name}</option>)}</select></div>
        {error && <div className={styles.error} role="status">{error}</div>}
        {loading && ids.length >= 2 && <div className={styles.empty}>Loading synchronized activity projections…</div>}
        {!loading && ids.length < 2 && <div className={styles.empty}>Select at least two activities. For your parkruns, start with <strong>Distance</strong> alignment so warm-ups and recording start times do not distort the comparison.</div>}
        {comparison && !loading && <>
          <div className={styles.summaryCards}>{comparison.summaries.map((item, index) => <article key={item.activityId} style={{ borderTopColor: comparison.series[index].color }}><span>{dateLabel(item.startedAt)}</span><h3>{item.title}</h3><dl><div><dt>{item.intervalLabel ? "Interval" : "Distance"}</dt><dd>{item.intervalLabel ?? formatDistance(item.distanceMeters, units)}</dd></div><div><dt>Time</dt><dd>{formatDuration(item.durationSeconds)}</dd></div><div><dt>Pace</dt><dd>{formatPace(item.averagePaceSecPerKm ? 1000 / item.averagePaceSecPerKm : null, units)}</dd></div><div><dt>HR</dt><dd>{item.averageHeartRateBpm?.toFixed(0) ?? "—"} bpm</dd></div></dl>{comparison.series[index].warning && <p>{comparison.series[index].warning}</p>}</article>)}</div>
          {channels.map(channel => <ComparisonChart key={channel} comparison={comparison} channel={channel} units={units} />)}
          <section className={styles.tableCard}><div><h2>Side-by-side intelligence</h2><p>Same selection basis across summary, zone, best-effort and efficiency metrics.</p></div><div className={styles.tableScroll}><table><thead><tr><th>Activity</th><th>Avg pace</th><th>Avg HR</th><th>Cadence</th><th>Power</th><th>Elevation</th><th>HR zones</th><th>Decoupling</th><th>Speed / HR</th><th>Best 5K</th><th>Load</th></tr></thead><tbody>{comparison.summaries.map(item => <tr key={item.activityId}><td><Link href={`/activity-analysis/${encodeURIComponent(item.activityId)}`}>{item.title}</Link></td><td>{formatPace(item.averagePaceSecPerKm ? 1000 / item.averagePaceSecPerKm : null, units)}</td><td>{item.averageHeartRateBpm?.toFixed(0) ?? "—"}</td><td>{item.averageCadenceSpm?.toFixed(0) ?? "—"}</td><td>{item.averagePowerWatts?.toFixed(0) ?? "—"}</td><td>{formatChannel("altitude", item.elevationGainMeters, units)} {channelUnit("altitude", units)}</td><td>{item.heartRateZones.length ? item.heartRateZones.map(zone => `${zone.name} ${zone.percentage.toFixed(0)}%`).join(" · ") : "—"}</td><td>{item.aerobicDecouplingPercent == null ? "—" : `${item.aerobicDecouplingPercent.toFixed(1)}%`}</td><td>{item.speedPerHeartBeat?.toFixed(4) ?? "—"}</td><td>{formatDuration(item.best5kSeconds)}</td><td>{item.internalLoadScore?.toFixed(1) ?? "—"}</td></tr>)}</tbody></table></div><small>Comparison algorithm {comparison.version} · {comparison.algorithms.alignment}. The first selected activity is the delta baseline.</small></section>
        </>}
      </section>
    </div>
  </main>;
}
