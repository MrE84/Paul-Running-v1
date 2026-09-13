"use client";

import { useMemo, useState } from "react";
import {
  customInterval,
  densityHeatmap,
  derivedRunningMetrics,
  efficiencyAnalysis,
  histogram,
  scatterSamples,
  zoneDistribution,
  type ActivityIntelligence,
  type AnalysisInterval,
  type ScatterSample,
  type HeatmapCell,
} from "../../lib/activity-analysis/intelligence";
import { CHANNELS, type AnalysisProjection, type Channel, type IndexRange } from "../../lib/activity-analysis/projection";
import { channelUnit, formatChannel } from "../../lib/activity-analysis/selection";
import { formatDistance, formatDuration, formatPace } from "../../lib/activity-analysis/core";
import type { UnitSystem } from "../../lib/activity-analysis/contracts";
import styles from "./analysis-panels.module.css";

function percent(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(0)}%`;
}

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function download(name: string, rows: unknown[][]) {
  const csv = rows.map(row => row.map(csvCell).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function intervalRows(projection: AnalysisProjection, intervals: AnalysisInterval[]) {
  return [
    ["label", "source", "phase", "start_seconds", "end_seconds", "duration_seconds", "distance_meters", "pace_seconds_per_km", "average_hr_bpm", "average_cadence_spm", "average_power_watts", "elevation_gain_meters", "target", "compliance_percent"],
    ...intervals.map(interval => [
      interval.label,
      interval.source,
      interval.phase,
      projection.streams.elapsed[interval.start] ?? "",
      projection.streams.elapsed[interval.end] ?? "",
      interval.metrics.durationSeconds,
      interval.metrics.distanceMeters,
      interval.metrics.averagePaceSecPerKm,
      interval.metrics.averageHeartRateBpm,
      interval.metrics.averageCadenceSpm,
      interval.metrics.averagePowerWatts,
      interval.metrics.elevationGainMeters,
      interval.target ? `${interval.target.channel}:${interval.target.lower}-${interval.target.upper} ${interval.target.unit}` : "",
      interval.compliancePercent,
    ]),
  ];
}

export function IntervalsPanel({
  projection,
  intelligence,
  selection,
  onSelect,
  units,
}: {
  projection: AnalysisProjection;
  intelligence: ActivityIntelligence;
  selection: IndexRange | null;
  onSelect: (range: IndexRange | null) => void;
  units: UnitSystem;
}) {
  const [custom, setCustom] = useState<AnalysisInterval[]>([]);
  const [source, setSource] = useState<"all" | AnalysisInterval["source"]>("all");
  const intervals = useMemo(() => [...intelligence.intervals, ...custom], [intelligence, custom]);
  const visible = source === "all" ? intervals : intervals.filter(interval => interval.source === source);
  return <section className={styles.panel}>
    <div className={styles.heading}>
      <div><span>WORKOUT INTELLIGENCE</span><h3>Intervals, laps and planned execution</h3><p>Recorded, detected, planned and custom segments share the same chart and map selection.</p></div>
      <div className={styles.actions}>
        <button disabled={!selection || selection[0] === selection[1]} onClick={() => selection && setCustom(existing => [...existing, customInterval(projection, selection, existing.length + 1)])}>Save selected interval</button>
        <button disabled={!visible.length} onClick={() => download(`${projection.activity.id}-intervals.csv`, intervalRows(projection, visible))}>Export CSV</button>
      </div>
    </div>
    {intelligence.plannedActual && <div className={styles.summaryStrip}>
      <span><small>Planned workout</small><strong>{intelligence.plannedActual.workoutName}</strong></span>
      <span><small>Measured steps</small><strong>{intelligence.plannedActual.measuredStepCount}/{intelligence.plannedActual.stepCount}</strong></span>
      <span><small>Average compliance</small><strong>{percent(intelligence.plannedActual.compliancePercent)}</strong></span>
      <span><small>Steps ≥80%</small><strong>{intelligence.plannedActual.compliantStepCount}</strong></span>
    </div>}
    <div className={styles.filters}>
      <label>Segment type<select value={source} onChange={event => setSource(event.target.value as typeof source)}>
        <option value="all">All segments</option><option value="recorded">Recorded laps</option><option value="detected">Detected efforts</option><option value="planned">Planned steps</option><option value="custom">Custom</option>
      </select></label>
      <span>{visible.length} segments · click a row to synchronize charts and route</span>
    </div>
    {!visible.length ? <p className={styles.empty}>No segments are available for this filter. Select a range on the timeline to create one.</p> : <div className={styles.table}><table><thead><tr><th>Segment</th><th>Type</th><th>Time</th><th>Distance</th><th>Pace</th><th>HR</th><th>Cadence</th><th>Power</th><th>Ascent</th><th>Target</th><th>Compliance</th></tr></thead><tbody>
      {visible.map(interval => <tr key={interval.id} role="button" tabIndex={0} data-selected={Boolean(selection && interval.start <= selection[1] && interval.end >= selection[0])} onClick={() => onSelect([interval.start, interval.end])} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") onSelect([interval.start, interval.end]); }}>
        <td><strong>{interval.label}</strong><small>{formatDuration(projection.streams.elapsed[interval.start])}–{formatDuration(projection.streams.elapsed[interval.end])}</small></td>
        <td>{interval.source}</td><td>{formatDuration(interval.metrics.durationSeconds)}</td><td>{formatDistance(interval.metrics.distanceMeters, units)}</td><td>{formatPace(interval.metrics.averageSpeedMps, units)}</td>
        <td>{formatChannel("heart_rate", interval.metrics.averageHeartRateBpm, units)} bpm</td><td>{formatChannel("cadence", interval.metrics.averageCadenceSpm, units)} spm</td><td>{formatChannel("power", interval.metrics.averagePowerWatts, units)} W</td><td>{formatChannel("altitude", interval.metrics.elevationGainMeters, units)} {channelUnit("altitude", units)}</td>
        <td>{interval.target ? `${formatChannel(interval.target.channel, interval.target.lower, units)}–${formatChannel(interval.target.channel, interval.target.upper, units)} ${channelUnit(interval.target.channel, units)}` : "—"}</td><td>{percent(interval.compliancePercent)}</td>
      </tr>)}
    </tbody></table></div>}
  </section>;
}

function ScatterPlot({ samples, x, y, units, onSelect }: { samples: ScatterSample[]; x: Channel; y: Channel; units: UnitSystem; onSelect: (range: IndexRange) => void }) {
  if (!samples.length) return <p className={styles.empty}>These channels have no overlapping samples in the selected range.</p>;
  const xs = samples.map(sample => sample.x), ys = samples.map(sample => sample.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const px = (value: number) => 26 + 548 * (value - minX) / Math.max(Number.EPSILON, maxX - minX);
  const py = (value: number) => 232 - 206 * (value - minY) / Math.max(Number.EPSILON, maxY - minY);
  return <div><svg className={styles.scatter} viewBox="0 0 600 260" role="img" aria-label={`${CHANNELS[x].label} against ${CHANNELS[y].label} scatter plot`}>
    <path d="M26 20V232H580" />
    {samples.map(sample => <circle key={sample.index} cx={px(sample.x)} cy={py(sample.y)} r="3" role="button" tabIndex={0} onClick={() => onSelect([sample.index, sample.index])} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") onSelect([sample.index, sample.index]); }}><title>{`${formatChannel(x, sample.x, units)} ${channelUnit(x, units)} · ${formatChannel(y, sample.y, units)} ${channelUnit(y, units)}`}</title></circle>)}
  </svg><div className={styles.axisLabels}><span>{CHANNELS[x].label} · {channelUnit(x, units)}</span><span>{CHANNELS[y].label} · {channelUnit(y, units)}</span></div></div>;
}

function DensityHeatmap({ cells, x, y, units, onSelect }: { cells: HeatmapCell[]; x: Channel; y: Channel; units: UnitSystem; onSelect: (range: IndexRange) => void }) {
  if (!cells.length) return <p className={styles.empty}>These channels have no overlapping samples in the selected range.</p>;
  const peak = Math.max(...cells.map(cell => cell.count));
  return <div><svg className={styles.scatter} viewBox="0 0 600 260" role="img" aria-label={`${CHANNELS[x].label} against ${CHANNELS[y].label} density heatmap`}>
    <path d="M26 20V232H580" />
    {cells.map(cell => { const range: IndexRange = [Math.min(...cell.indices), Math.max(...cell.indices)]; return <rect key={`${cell.xBin}-${cell.yBin}`} x={26 + cell.xBin * 46} y={232 - (cell.yBin + 1) * 20.6} width="45" height="19.6" rx="2" fill={`rgba(251,113,133,${.12 + .82 * cell.count / peak})`} role="button" tabIndex={0} onClick={() => onSelect(range)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") onSelect(range); }}><title>{`${cell.count} samples · ${formatChannel(x, cell.xLower, units)}–${formatChannel(x, cell.xUpper, units)} ${channelUnit(x, units)} · ${formatChannel(y, cell.yLower, units)}–${formatChannel(y, cell.yUpper, units)} ${channelUnit(y, units)}`}</title></rect>; })}
  </svg><div className={styles.axisLabels}><span>{CHANNELS[x].label} · {channelUnit(x, units)}</span><span>{CHANNELS[y].label} · {channelUnit(y, units)}</span></div></div>;
}

export function ZonesPanel({ projection, selection, units, onSelect }: { projection: AnalysisProjection; selection: IndexRange | null; units: UnitSystem; onSelect: (range: IndexRange) => void }) {
  const available = Object.keys(projection.streams.channels) as Channel[];
  const zoned = Object.keys(projection.zones) as Channel[];
  const [channel, setChannel] = useState<Channel>(zoned.includes("heart_rate") ? "heart_rate" : zoned[0] ?? available[0] ?? "heart_rate");
  const [scatterX, setScatterX] = useState<Channel>(available.includes("heart_rate") ? "heart_rate" : available[0] ?? "heart_rate");
  const [scatterY, setScatterY] = useState<Channel>(available.includes("pace") ? "pace" : available[1] ?? available[0] ?? "heart_rate");
  const [relationshipView, setRelationshipView] = useState<"scatter" | "heatmap">("scatter");
  const distribution = useMemo(() => zoneDistribution(projection, channel, selection), [projection, channel, selection]);
  const bins = useMemo(() => histogram(projection, channel, selection), [projection, channel, selection]);
  const scatter = useMemo(() => scatterSamples(projection, scatterX, scatterY, selection), [projection, scatterX, scatterY, selection]);
  const heatmap = useMemo(() => densityHeatmap(scatter), [scatter]);
  const tallest = Math.max(1, ...bins.map(bin => bin.count));
  if (!available.length) return <section className={styles.panel}>
    <div className={styles.heading}><div><span>DISTRIBUTIONS</span><h3>Zones, histogram and relationships</h3><p>No sampled channels were present in this activity.</p></div></div>
    <p className={styles.empty}>This activity has summary information only. Recover or re-import its detailed FIT data to use charts and distributions.</p>
  </section>;
  return <section className={styles.panel}>
    <div className={styles.heading}><div><span>DISTRIBUTIONS</span><h3>Zones, histogram and relationships</h3><p>{selection ? "Calculated from the selected range." : "Calculated from the complete activity."} Missing streams remain hidden.</p></div></div>
    <div className={styles.filters}><label>Distribution channel<select value={channel} onChange={event => setChannel(event.target.value as Channel)}>{available.map(key => <option key={key} value={key}>{CHANNELS[key].label}</option>)}</select></label></div>
    {distribution ? <>
      <div className={styles.zoneBar} aria-label={`${CHANNELS[channel].label} time in zones`}>{distribution.zones.filter(zone => zone.seconds > 0).map(zone => <span key={zone.name} style={{ width: `${zone.percentage}%`, background: zone.color }} title={`${zone.name}: ${percent(zone.percentage)}`} />)}</div>
      <div className={styles.zoneGrid}>{distribution.zones.map(zone => <article key={zone.name}><i style={{ background: zone.color }} /><span><strong>{zone.name}</strong><small>{formatChannel(channel, zone.lower, units)}–{formatChannel(channel, zone.upper, units)} {channelUnit(channel, units)}</small></span><b>{formatDuration(zone.seconds)} · {percent(zone.percentage)}</b></article>)}</div>
      {distribution.unclassifiedSeconds > 0 && <p className={styles.note}>{formatDuration(distribution.unclassifiedSeconds)} was outside configured zone bounds.</p>}
    </> : <p className={styles.empty}>No configured {CHANNELS[channel].label.toLowerCase()} zones are available for this activity date.</p>}
    <div className={styles.split}>
      <div><h4>{CHANNELS[channel].label} histogram</h4><div className={styles.histogram}>{bins.map((bin, index) => <span key={index} style={{ height: `${100 * bin.count / tallest}%` }} title={`${formatChannel(channel, bin.lower, units)}–${formatChannel(channel, bin.upper, units)}: ${percent(bin.percentage)}`} />)}</div><div className={styles.axisLabels}><span>{bins.length ? formatChannel(channel, bins[0].lower, units) : "—"}</span><span>{bins.length ? formatChannel(channel, bins.at(-1)!.upper, units) : "—"} {channelUnit(channel, units)}</span></div></div>
      <div><div className={styles.scatterControls}><h4>Signal relationship</h4><label>View<select value={relationshipView} onChange={event => setRelationshipView(event.target.value as typeof relationshipView)}><option value="scatter">Scatter</option><option value="heatmap">Density heatmap</option></select></label><label>X<select value={scatterX} onChange={event => setScatterX(event.target.value as Channel)}>{available.map(key => <option key={key} value={key}>{CHANNELS[key].label}</option>)}</select></label><label>Y<select value={scatterY} onChange={event => setScatterY(event.target.value as Channel)}>{available.map(key => <option key={key} value={key}>{CHANNELS[key].label}</option>)}</select></label></div>{relationshipView === "scatter" ? <ScatterPlot samples={scatter} x={scatterX} y={scatterY} units={units} onSelect={onSelect} /> : <DensityHeatmap cells={heatmap} x={scatterX} y={scatterY} units={units} onSelect={onSelect} />}</div>
    </div>
  </section>;
}

export function BestEffortsPanel({ projection, intelligence, selection, units, onSelect }: { projection: AnalysisProjection; intelligence: ActivityIntelligence; selection: IndexRange | null; units: UnitSystem; onSelect: (range: IndexRange) => void }) {
  const [basis, setBasis] = useState<"duration" | "distance">("duration");
  const [peakMetric, setPeakMetric] = useState<"speed" | "heart_rate" | "power" | "cadence">("heart_rate");
  const efforts = intelligence.bestEfforts.filter(effort => effort.basis === basis);
  const efficiency = useMemo(() => efficiencyAnalysis(projection, selection), [projection, selection]);
  const derived = useMemo(() => derivedRunningMetrics(projection, selection), [projection, selection]);
  const peakSignals = intelligence.peakSignals.filter(effort => effort.channel === peakMetric);
  return <section className={styles.panel}>
    <div className={styles.heading}><div><span>DERIVED RUNNING INTELLIGENCE</span><h3>Best efforts and aerobic efficiency</h3><p>Vendor-neutral calculations from the immutable activity projection, algorithm version {intelligence.version}.</p></div></div>
    {efficiency && <div className={styles.summaryStrip}>
      <span><small>Average speed</small><strong>{efficiency.averageSpeedMps?.toFixed(2) ?? "—"} m/s</strong></span>
      <span><small>Average HR</small><strong>{efficiency.averageHeartRateBpm?.toFixed(0) ?? "—"} bpm</strong></span>
      <span><small>Speed / HR</small><strong>{efficiency.speedPerHeartBeat?.toFixed(4) ?? "—"}</strong></span>
      <span><small>Power / HR</small><strong>{efficiency.powerPerHeartBeat?.toFixed(2) ?? "—"}</strong></span>
      <span><small>Aerobic decoupling</small><strong>{efficiency.aerobicDecouplingPercent == null ? "—" : `${efficiency.aerobicDecouplingPercent.toFixed(1)}%`}</strong></span>
    </div>}
    <div className={styles.summaryStrip}>
      <span><small>Grade-adjusted pace</small><strong>{formatChannel("pace", derived.gradeAdjustedPaceSecPerKm, units)} {channelUnit("pace", units)}</strong></span>
      <span><small>Elevation gain / loss</small><strong>{formatChannel("altitude", derived.elevationGainMeters, units)} / {formatChannel("altitude", derived.elevationLossMeters, units)} {channelUnit("altitude", units)}</strong></span>
      <span><small>Uphill / downhill</small><strong>{formatDuration(derived.uphillSeconds)} / {formatDuration(derived.downhillSeconds)}</strong></span>
      <span><small>Internal load</small><strong>{derived.internalLoadScore?.toFixed(1) ?? "—"}</strong></span>
    </div>
    <div className={styles.filters}><label>Effort basis<select value={basis} onChange={event => setBasis(event.target.value as typeof basis)}><option value="duration">Rolling duration</option><option value="distance">Distance bests</option></select></label><span>Click an effort to inspect it across the timeline and route.</span></div>
    {!efforts.length ? <p className={styles.empty}>This activity is not long enough for the configured best-effort windows.</p> : <div className={styles.effortGrid}>{efforts.map(effort => <button key={effort.id} onClick={() => onSelect([effort.start, effort.end])}><span>{effort.label}</span><strong>{formatPace(effort.averageSpeedMps, units)}</strong><small>{formatDistance(effort.distanceMeters, units)} · {formatDuration(effort.durationSeconds)}</small><small>{effort.averageHeartRateBpm?.toFixed(0) ?? "—"} bpm · {effort.averageCadenceSpm?.toFixed(0) ?? "—"} spm</small></button>)}</div>}
    <div className={styles.filters}><label>Peak signal<select value={peakMetric} onChange={event => setPeakMetric(event.target.value as typeof peakMetric)}>{(["heart_rate", "power", "cadence", "speed"] as const).filter(channel => intelligence.peakSignals.some(effort => effort.channel === channel)).map(channel => <option key={channel} value={channel}>{CHANNELS[channel].label}</option>)}</select></label><span>Highest time-weighted rolling averages.</span></div>
    {peakSignals.length > 0 && <div className={styles.effortGrid}>{peakSignals.map(effort => <button key={effort.id} onClick={() => onSelect([effort.start, effort.end])}><span>{formatDuration(effort.windowSeconds)}</span><strong>{formatChannel(effort.channel, effort.average, units)} {channelUnit(effort.channel, units)}</strong><small>{formatDuration(projection.streams.elapsed[effort.start])}–{formatDuration(projection.streams.elapsed[effort.end])}</small></button>)}</div>}
    <p className={styles.note}>Grade-adjusted pace uses a documented terrain energy-cost polynomial. Internal load is transparent: {derived.loadFormula}. Decoupling compares speed-per-heartbeat in equal elapsed-time halves; use a steady effort or selection for a meaningful result.</p>
  </section>;
}
