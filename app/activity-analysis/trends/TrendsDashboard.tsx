"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatDistance, formatDuration, formatPace } from "../../../lib/activity-analysis/core";
import type { AthleteTrends, LoadPoint, VolumeBucket } from "../../../lib/activity-analysis/trends";
import type { UnitSystem } from "../../../lib/activity-analysis/contracts";
import styles from "./trends.module.css";

type ApiEnvelope<T> = { data?: T; error?: { message?: string } };
export interface InitialTrendState {
  from: string;
  to: string;
  sport: string;
  bucket: "week" | "month";
  fitnessDays: number;
  fatigueDays: number;
}

const COLORS = { fitness: "#63d7ff", fatigue: "#fb8b61", form: "#a78bfa", load: "#f8d66d", distance: "#4ade80" };

async function api<T>(path: string): Promise<T> {
  const response = await fetch(`/api/v1/${path}`, { cache: "no-store", headers: { "X-Client-Id": "activity-trends" } });
  const payload = await response.json().catch(() => ({})) as ApiEnvelope<T>;
  if (!response.ok || payload.data === undefined) throw new Error(payload.error?.message ?? `${response.status} ${response.statusText}`);
  return payload.data;
}

function dateLabel(value: string, compact = false): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleDateString(undefined, compact ? { month: "short", day: "numeric", timeZone: "UTC" } : { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function displayPace(secondsPerKm: number | null, units: UnitSystem): string {
  return formatPace(secondsPerKm && secondsPerKm > 0 ? 1000 / secondsPerKm : null, units);
}

function sampled<T>(values: T[], maximum = 520): T[] {
  if (values.length <= maximum) return values;
  const stride = Math.ceil(values.length / maximum);
  const result = values.filter((_, index) => index % stride === 0);
  if (result.at(-1) !== values.at(-1)) result.push(values.at(-1)!);
  return result;
}

function points(values: number[], width: number, height: number, pad = 24): string {
  if (!values.length) return "";
  let minimum = Math.min(...values), maximum = Math.max(...values);
  if (minimum === maximum) { minimum -= 1; maximum += 1; }
  return values.map((value, index) => {
    const x = pad + index / Math.max(1, values.length - 1) * (width - pad * 2);
    const y = pad + (maximum - value) / (maximum - minimum) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function LoadChart({ values }: { values: LoadPoint[] }) {
  const width = 1000, height = 330, pad = 36;
  const data = sampled(values);
  if (!data.length) return <div className={styles.emptyChart}>No load history in this window.</div>;
  const all = data.flatMap(value => [value.fitness, value.fatigue, value.form, value.load]);
  let minimum = Math.min(0, ...all), maximum = Math.max(1, ...all);
  if (minimum === maximum) maximum += 1;
  const x = (index: number) => pad + index / Math.max(1, data.length - 1) * (width - pad * 2);
  const y = (value: number) => pad + (maximum - value) / (maximum - minimum) * (height - pad * 2);
  const series = [
    { key: "fitness" as const, label: "Fitness", color: COLORS.fitness },
    { key: "fatigue" as const, label: "Fatigue", color: COLORS.fatigue },
    { key: "form" as const, label: "Form", color: COLORS.form },
  ];
  return <div className={styles.chartWrap}>
    <div className={styles.legend}>{series.map(item => <span key={item.key}><i style={{ background: item.color }} />{item.label}</span>)}<span><i style={{ background: COLORS.load }} />Daily load</span></div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Daily training load with exponentially weighted fitness, fatigue and form">
      {[0, 1, 2, 3, 4].map(index => { const yy = pad + index * (height - pad * 2) / 4; return <line key={index} x1={pad} x2={width - pad} y1={yy} y2={yy} className={styles.gridLine} />; })}
      {data.map((item, index) => item.load > 0 && <line key={item.date} x1={x(index)} x2={x(index)} y1={y(0)} y2={y(item.load)} stroke={COLORS.load} strokeOpacity=".35" strokeWidth={Math.max(1, (width - pad * 2) / data.length * .55)} />)}
      {series.map(item => <polyline key={item.key} points={data.map((value, index) => `${x(index).toFixed(1)},${y(value[item.key]).toFixed(1)}`).join(" ")} fill="none" stroke={item.color} strokeWidth="2.4" vectorEffect="non-scaling-stroke" />)}
      <text x={pad} y={height - 8} className={styles.svgLabel}>{dateLabel(data[0].date, true)}</text><text x={width - pad} y={height - 8} textAnchor="end" className={styles.svgLabel}>{dateLabel(data.at(-1)!.date, true)}</text>
      <text x={pad + 4} y={18} className={styles.svgLabel}>{maximum.toFixed(0)}</text><text x={pad + 4} y={height - pad - 5} className={styles.svgLabel}>{minimum.toFixed(0)}</text>
    </svg>
  </div>;
}

function VolumeChart({ values, units }: { values: VolumeBucket[]; units: UnitSystem }) {
  const width = 1000, height = 300, padX = 38, padBottom = 44, padTop = 20;
  if (!values.length) return <div className={styles.emptyChart}>No volume history in this window.</div>;
  const distances = values.map(value => value.distanceMeters / (units === "metric" ? 1000 : 1609.344));
  const maximum = Math.max(1, ...distances);
  const slot = (width - padX * 2) / values.length;
  return <div className={styles.chartWrap}><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${values.length} ${values.length === 1 ? "training period" : "training periods"} showing distance volume`}>
    {[0, 1, 2, 3, 4].map(index => { const yy = padTop + index * (height - padTop - padBottom) / 4; return <line key={index} x1={padX} x2={width - padX} y1={yy} y2={yy} className={styles.gridLine} />; })}
    {values.map((value, index) => { const distance = distances[index]; const barHeight = distance / maximum * (height - padTop - padBottom); return <rect key={value.start} x={padX + index * slot + slot * .14} y={height - padBottom - barHeight} width={Math.max(2, slot * .72)} height={barHeight} rx="3" fill={COLORS.distance} fillOpacity=".78"><title>{`${dateLabel(value.start)}: ${distance.toFixed(1)} ${units === "metric" ? "km" : "mi"}`}</title></rect>; })}
    <text x={padX} y={height - 10} className={styles.svgLabel}>{dateLabel(values[0].start, true)}</text><text x={width - padX} y={height - 10} textAnchor="end" className={styles.svgLabel}>{dateLabel(values.at(-1)!.start, true)}</text><text x={padX + 4} y={16} className={styles.svgLabel}>{maximum.toFixed(1)} {units === "metric" ? "km" : "mi"}</text>
  </svg></div>;
}

function MiniTrend({ values, label, invert = false }: { values: number[]; label: string; invert?: boolean }) {
  const data = sampled(values, 160);
  if (data.length < 2) return <span className={styles.missing}>Not enough comparable points</span>;
  const plotted = invert ? data.map(value => -value) : data;
  return <svg viewBox="0 0 420 110" role="img" aria-label={label}><polyline points={points(plotted, 420, 110, 10)} fill="none" stroke="#63d7ff" strokeWidth="3" vectorEffect="non-scaling-stroke" /></svg>;
}

function ZoneBars({ values }: { values: VolumeBucket[] }) {
  const names = [...new Set(values.flatMap(value => value.heartRateZones.map(zone => zone.name)))];
  if (!names.length) return <div className={styles.emptyChart}>No configured heart-rate zone time is available.</div>;
  return <div className={styles.zoneRows}>{values.map(value => { const total = value.heartRateZones.reduce((sum, zone) => sum + zone.seconds, 0); return <div key={value.start} className={styles.zoneRow}><span>{dateLabel(value.start, true)}</span><div aria-label={`${dateLabel(value.start)} heart-rate zone distribution`}>{value.heartRateZones.map(zone => <i key={zone.name} title={`${zone.name}: ${formatDuration(zone.seconds)}`} style={{ width: `${total ? zone.seconds / total * 100 : 0}%`, background: zone.color }} />)}</div></div>; })}<div className={styles.zoneLegend}>{names.map(name => { const zone = values.flatMap(value => value.heartRateZones).find(value => value.name === name)!; return <span key={name}><i style={{ background: zone.color }} />{name}</span>; })}</div></div>;
}

export default function TrendsDashboard({ initial }: { initial: InitialTrendState }) {
  const [filters, setFilters] = useState(initial);
  const [trends, setTrends] = useState<AthleteTrends | null>(null);
  const [units, setUnits] = useState<UnitSystem>("metric");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const search = new URLSearchParams();
    if (filters.from) search.set("from", filters.from);
    if (filters.to) search.set("to", filters.to);
    if (filters.sport !== "all") search.set("sport", filters.sport);
    search.set("bucket", filters.bucket);
    search.set("fitnessDays", String(filters.fitnessDays));
    search.set("fatigueDays", String(filters.fatigueDays));
    window.history.replaceState(null, "", `${window.location.pathname}?${search.toString()}`);
    const query = new URLSearchParams({ bucket: filters.bucket, fitnessDays: String(filters.fitnessDays), fatigueDays: String(filters.fatigueDays), limit: "250" });
    if (filters.from) query.set("from", filters.from);
    if (filters.to) query.set("to", filters.to);
    if (filters.sport !== "all") query.set("sport", filters.sport);
    let cancelled = false;
    setLoading(true); setError("");
    api<AthleteTrends>(`activity-trends?${query.toString()}`).then(value => { if (!cancelled) setTrends(value); }).catch(value => { if (!cancelled) { setTrends(null); setError(value instanceof Error ? value.message : String(value)); } }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filters]);

  const recentLoad = trends?.load.at(-1);
  const efficiency = useMemo(() => trends?.efficiency.filter(item => item.speedPerHeartBeat !== null) ?? [], [trends]);
  const easyPace = useMemo(() => trends?.efficiency.filter(item => item.easyPaceSecPerKm !== null) ?? [], [trends]);
  const threshold = useMemo(() => trends?.efficiency.filter(item => item.thresholdPaceSecPerKm !== null) ?? [], [trends]);

  return <main className={styles.page}>
    <header className={styles.header}><div><Link href="/activity-analysis">← Activity Analysis</Link><span>LONGITUDINAL PERFORMANCE</span><h1>Performance trends</h1><p>See whether training is producing durable fitness—not just one good run. Every result is derived from canonical activity history and documented below.</p></div><div className={styles.headerLinks}><Link href="/activity-analysis/compare">Compare activities →</Link><label>Units<select value={units} onChange={event => setUnits(event.target.value as UnitSystem)}><option value="metric">Metric</option><option value="imperial">Imperial</option></select></label></div></header>
    <section className={styles.filters} aria-label="Trend filters">
      <label>From<input type="date" value={filters.from} max={filters.to || undefined} onChange={event => setFilters(current => ({ ...current, from: event.target.value }))} /></label>
      <label>To<input type="date" value={filters.to} min={filters.from || undefined} onChange={event => setFilters(current => ({ ...current, to: event.target.value }))} /></label>
      <label>Sport<select value={filters.sport} onChange={event => setFilters(current => ({ ...current, sport: event.target.value }))}><option value="all">All sports</option><option value="running">Running</option><option value="cycling">Cycling</option><option value="swimming">Swimming</option></select></label>
      <label>Aggregate<select value={filters.bucket} onChange={event => setFilters(current => ({ ...current, bucket: event.target.value as "week" | "month" }))}><option value="week">Weekly</option><option value="month">Monthly</option></select></label>
      <label>Fitness response (days)<input type="number" min={2} max={120} value={filters.fitnessDays} onChange={event => setFilters(current => ({ ...current, fitnessDays: Math.max(2, Math.min(120, Number(event.target.value) || 42)) }))} /></label>
      <label>Fatigue response (days)<input type="number" min={1} max={60} value={filters.fatigueDays} onChange={event => setFilters(current => ({ ...current, fatigueDays: Math.max(1, Math.min(60, Number(event.target.value) || 7)) }))} /></label>
      <button onClick={() => setFilters({ from: "", to: "", sport: "all", bucket: "week", fitnessDays: 42, fatigueDays: 7 })}>Reset</button>
    </section>
    {error && <div className={styles.error} role="status">{error}</div>}
    {loading && <div className={styles.loading}>Recomputing your selected history…</div>}
    {trends && !loading && <>
      <section className={styles.answer} data-direction={trends.fitnessAnswer.direction}><div><span>AM I GETTING FITTER?</span><h2>{trends.fitnessAnswer.direction === "improving" ? "Yes—efficiency is improving" : trends.fitnessAnswer.direction === "declining" ? "Recent efficiency is declining" : trends.fitnessAnswer.direction === "stable" ? "Fitness is broadly stable" : "More comparable runs needed"}</h2><p>{trends.fitnessAnswer.message}</p></div><dl><div><dt>Fitness</dt><dd>{recentLoad?.fitness.toFixed(1) ?? "—"}</dd></div><div><dt>Fatigue</dt><dd>{recentLoad?.fatigue.toFixed(1) ?? "—"}</dd></div><div><dt>Form</dt><dd>{recentLoad ? `${recentLoad.form >= 0 ? "+" : ""}${recentLoad.form.toFixed(1)}` : "—"}</dd></div><div><dt>Efficiency Δ</dt><dd>{trends.fitnessAnswer.efficiencyChangePercent == null ? "—" : `${trends.fitnessAnswer.efficiencyChangePercent >= 0 ? "+" : ""}${trends.fitnessAnswer.efficiencyChangePercent.toFixed(1)}%`}</dd></div></dl></section>
      <section className={styles.statGrid}><article><span>Activities</span><strong>{trends.totals.activities}</strong></article><article><span>Distance</span><strong>{formatDistance(trends.totals.distanceMeters, units)}</strong></article><article><span>Training time</span><strong>{formatDuration(trends.totals.durationSeconds)}</strong></article><article><span>Elevation gain</span><strong>{units === "metric" ? `${trends.totals.elevationGainMeters.toFixed(0)} m` : `${(trends.totals.elevationGainMeters * 3.28084).toFixed(0)} ft`}</strong></article><article><span>Internal load</span><strong>{trends.totals.internalLoad.toFixed(0)}</strong></article></section>
      <div className={styles.dashboardGrid}>
        <section className={`${styles.panel} ${styles.wide}`}><div className={styles.panelHeading}><div><h2>{filters.bucket === "week" ? "Weekly" : "Monthly"} volume</h2><p>Distance with exact period values available below.</p></div></div><VolumeChart values={trends.volume} units={units} /><details><summary>Accessible volume table</summary><div className={styles.tableScroll}><table><thead><tr><th>Period</th><th>Activities</th><th>Distance</th><th>Time</th><th>Elevation</th><th>Load</th></tr></thead><tbody>{trends.volume.map(value => <tr key={value.start}><td>{dateLabel(value.start)}</td><td>{value.activities}</td><td>{formatDistance(value.distanceMeters, units)}</td><td>{formatDuration(value.durationSeconds)}</td><td>{units === "metric" ? `${value.elevationGainMeters.toFixed(0)} m` : `${(value.elevationGainMeters * 3.28084).toFixed(0)} ft`}</td><td>{value.internalLoad.toFixed(1)}</td></tr>)}</tbody></table></div></details></section>
        <section className={`${styles.panel} ${styles.wide}`}><div className={styles.panelHeading}><div><h2>Fitness, fatigue and form</h2><p>Daily impulse response; bars are actual load, lines are modeled response.</p></div></div><LoadChart values={trends.load} /><details><summary>Recent load table</summary><div className={styles.tableScroll}><table><thead><tr><th>Date</th><th>Load</th><th>Fitness</th><th>Fatigue</th><th>Form</th></tr></thead><tbody>{trends.load.slice(-30).reverse().map(value => <tr key={value.date}><td>{dateLabel(value.date)}</td><td>{value.load.toFixed(1)}</td><td>{value.fitness.toFixed(1)}</td><td>{value.fatigue.toFixed(1)}</td><td>{value.form.toFixed(1)}</td></tr>)}</tbody></table></div></details></section>
        <section className={`${styles.panel} ${styles.wide}`}><div className={styles.panelHeading}><div><h2>Heart-rate zone distribution</h2><p>Time in your configured zones by {filters.bucket}.</p></div></div><ZoneBars values={trends.volume} /></section>
        <section className={styles.panel}><div className={styles.panelHeading}><div><h2>Pace-to-HR efficiency</h2><p>{efficiency.length} comparable activities · higher is better.</p></div></div><MiniTrend values={efficiency.map(value => value.speedPerHeartBeat!)} label="Pace-to-heart-rate efficiency progression" /><div className={styles.lastValue}>{efficiency.at(-1)?.speedPerHeartBeat?.toFixed(4) ?? "—"}<small>metres per heartbeat-equivalent</small></div></section>
        <section className={styles.panel}><div className={styles.panelHeading}><div><h2>Easy-running pace</h2><p>Time weighted inside your configured easy HR zone.</p></div></div><MiniTrend values={easyPace.map(value => value.easyPaceSecPerKm!)} label="Easy running pace progression where an upward line means faster" invert /><div className={styles.lastValue}>{displayPace(easyPace.at(-1)?.easyPaceSecPerKm ?? null, units)}<small>{easyPace.at(-1) ? dateLabel(easyPace.at(-1)!.date) : "No comparable run"}</small></div></section>
        <section className={styles.panel}><div className={styles.panelHeading}><div><h2>Threshold pace</h2><p>Named or longest comparable 5–60 minute effort.</p></div></div><MiniTrend values={threshold.map(value => value.thresholdPaceSecPerKm!)} label="Threshold pace progression where an upward line means faster" invert /><div className={styles.lastValue}>{displayPace(threshold.at(-1)?.thresholdPaceSecPerKm ?? null, units)}<small>{threshold.at(-1)?.thresholdHeartRateBpm ? `${threshold.at(-1)!.thresholdHeartRateBpm!.toFixed(0)} bpm` : "HR unavailable"}</small></div></section>
        <section className={styles.panel}><div className={styles.panelHeading}><div><h2>Equipment mileage</h2><p>Shown only when canonical activity metadata identifies gear.</p></div></div>{trends.equipment.length ? <div className={styles.equipment}>{trends.equipment.map(item => <div key={item.name}><span><strong>{item.name}</strong><small>{item.activities} activities</small></span><b>{formatDistance(item.distanceMeters, units)}</b></div>)}</div> : <div className={styles.emptyChart}>No equipment metadata is available.</div>}</section>
        <section className={`${styles.panel} ${styles.wide}`}><div className={styles.panelHeading}><div><h2>Personal-best progression</h2><p>Chronological bests from rolling distance efforts; every result opens its source activity.</p></div></div>{trends.personalBests.length ? <div className={styles.tableScroll}><table><thead><tr><th>Date</th><th>Distance</th><th>Result</th><th>Improvement</th><th>Activity</th></tr></thead><tbody>{trends.personalBests.slice().reverse().map((value, index) => <tr key={`${value.activityId}-${value.distanceMeters}-${index}`}><td>{dateLabel(value.date)}</td><td>{value.label}</td><td>{formatDuration(value.durationSeconds)}</td><td>{value.improvementSeconds == null ? "First recorded" : `${value.improvementSeconds.toFixed(1)} sec`}</td><td><Link href={`/activity-analysis/${encodeURIComponent(value.activityId)}`}>Open analysis →</Link></td></tr>)}</tbody></table></div> : <div className={styles.emptyChart}>No distance PB progression is available in this window.</div>}</section>
      </div>
      <details className={styles.method}><summary>Methods, provenance and data quality</summary><div><p>Trend projection <strong>{trends.version}</strong>, generated through {new Date(trends.generatedAt).toLocaleString()}. {trends.quality.processedActivities} activities were processed; {trends.quality.skippedActivities.length} were isolated and skipped.</p><dl>{Object.entries(trends.algorithms).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>{trends.quality.skippedActivities.length > 0 && <ul>{trends.quality.skippedActivities.map(item => <li key={item.activityId}>{item.activityId}: {item.message}</li>)}</ul>}</div></details>
    </>}
  </main>;
}
