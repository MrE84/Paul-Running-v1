"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CHANNELS, type AnalysisProjection, type Axis, type Channel, type IndexRange } from "../../lib/activity-analysis/projection";
import { channelUnit, formatChannel, rangeSummary } from "../../lib/activity-analysis/selection";
import { formatDistance, formatDuration, formatPace } from "../../lib/activity-analysis/core";
import type { DecodedFit, UnitSystem } from "../../lib/activity-analysis/contracts";
import styles from "./analysis.module.css";

const Timeline = dynamic(() => import("./AnalysisTimeline"), { ssr: false, loading: () => <div className={styles.skeleton}>Preparing timeline…</div> });
const RouteMap = dynamic(() => import("./AnalysisMap"), { ssr: false, loading: () => <div className={styles.skeleton}>Preparing route…</div> });
const RawData = dynamic(() => import("./RawData"), { loading: () => <div className={styles.skeleton}>Opening raw data…</div> });
const defaultChannels: Channel[] = ["heart_rate", "pace", "cadence", "altitude"];
const views = ["Overview", "Timeline", "Intervals / laps", "Zones", "Best efforts", "Dynamics", "Raw data"] as const;

export default function ActivityWorkspace({ projection: p, units, loadRaw }: { projection: AnalysisProjection; units: UnitSystem; loadRaw: () => Promise<DecodedFit> }) {
  const available = useMemo(() => Object.keys(p.streams.channels) as Channel[], [p]);
  const [channels, setChannels] = useState<Channel[]>(() => {
    const initial = defaultChannels.filter(k => p.streams.channels[k]); return initial.length ? initial : available.slice(0, 4);
  });
  const [view, setView] = useState<typeof views[number]>("Overview");
  const [axis, setAxis] = useState<Axis>("time");
  const [mode, setMode] = useState<"stacked" | "overlay">("stacked");
  const [smoothing, setSmoothing] = useState(0);
  const [resolution, setResolution] = useState(2400);
  const [zoneBands, setZoneBands] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [selection, setSelection] = useState<IndexRange | null>(null);
  const [zoom, setZoom] = useState<IndexRange | null>(null);
  const [raw, setRaw] = useState<DecodedFit | null>(null);
  const [rawError, setRawError] = useState("");
  const [rawLoading, setRawLoading] = useState(false);
  const stats = useMemo(() => rangeSummary(p, selection), [p, selection]);
  const onHover = useCallback((index: number | null) => setHover(index), []);
  const onSelect = useCallback((range: IndexRange | null) => setSelection(range), []);
  const dynamics = useMemo(() => available.filter(k => ["cadence", "vertical_oscillation", "ground_contact_time", "respiration_rate", "power"].includes(k)).slice(0, 5), [available]);
  const visibleChannels = view === "Dynamics" ? dynamics : channels;
  const distanceAvailable = p.streams.distance.filter(v => v !== null).length > 1;
  const hasSamples = p.streams.elapsed.length > 0;

  useEffect(() => {
    if (view !== "Raw data" || raw) return;
    let cancelled = false;
    setRawLoading(true); setRawError("");
    loadRaw().then(value => { if (!cancelled) setRaw(value); }).catch(error => { if (!cancelled) setRawError(error instanceof Error ? error.message : "Could not load raw data."); }).finally(() => { if (!cancelled) setRawLoading(false); });
    return () => { cancelled = true; };
  }, [view, raw, loadRaw]);

  const cards = [
    ["Distance", formatDistance(selection ? stats.distance : p.summary.distance, units)],
    [selection ? "Selected time" : "Moving time", formatDuration(selection ? stats.duration : p.summary.duration)],
    ["Average pace", formatPace(selection ? stats.means.speed ?? null : p.summary.speed, units)],
    ["Heart rate", `${formatChannel("heart_rate", selection ? stats.means.heart_rate : p.summary.heartRate ?? stats.means.heart_rate, units)} bpm`],
    ["Cadence", `${formatChannel("cadence", selection ? stats.means.cadence : p.summary.cadence ?? stats.means.cadence, units)} spm`],
    [selection ? "Average elevation" : "Elevation gain", `${formatChannel("altitude", selection ? stats.means.altitude : p.summary.ascent, units)} ${channelUnit("altitude", units)}`],
  ];
  return <>
    <header className={styles.activityHeader}>
      <div><div className={styles.eyebrow}>{p.source.origin === "browser" ? "LOCAL ACTIVITY" : "COMPLETED ACTIVITY"} <span className={styles.statusDot} /> {p.activity.sport}</div>
        <h1>{p.activity.title}</h1><p>{p.activity.startedAt ? new Date(p.activity.startedAt).toLocaleString(undefined, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : "Date not recorded"}</p></div>
      <span className={styles.badge}>{p.quality.samples.toLocaleString()} samples · {available.length} channels</span>
    </header>
    <div className={styles.contextLine}><span>{p.activity.calendarItemId ? "Linked to your training plan" : "Completed workout"}</span><span>{p.streams.channels.temperature ? `Device ${formatChannel("temperature", stats.means.temperature, units)} ${channelUnit("temperature", units)}` : "Ambient weather not available"}</span><span>{p.quality.flags.length ? "Partial data · details below" : "Ready to explore"}</span></div>
    <div className={styles.metrics} aria-label={selection ? "Selected range metrics" : "Activity metrics"}>{cards.map(([label, value], i) => <article key={label}><span>{label}</span><strong style={{ color: i === 0 ? "#91ebc8" : undefined }}>{value}</strong></article>)}</div>
    <nav className={styles.tabs} aria-label="Analysis views">{views.map(v => <button key={v} aria-pressed={view === v} className={view === v ? styles.activeTab : ""} onClick={() => setView(v)}>{v}</button>)}</nav>

    {selection && <div className={styles.selectionBanner} role="status"><span>Selected <strong>{formatDuration(p.streams.elapsed[selection[0]])} – {formatDuration(p.streams.elapsed[selection[1]])}</strong> · {formatDistance(stats.distance, units)}</span><button onClick={() => setSelection(null)}>Clear selection</button></div>}

    {["Overview", "Timeline", "Dynamics"].includes(view) && <div className={view === "Overview" ? styles.analysisGrid : styles.singleGrid}>
      <section className={styles.panel}>
        <div className={styles.panelHeading}><div><span className={styles.eyebrow}>YOUR EFFORT</span><h3>{view === "Dynamics" ? "Running dynamics" : "One run. Every signal."}</h3></div><span className={styles.badge}>{mode}</span></div>
        <div className={styles.toolbar}>
          <label>Axis<select aria-label="Timeline axis" value={axis} onChange={e => setAxis(e.target.value as Axis)}><option value="time">Time</option><option value="distance" disabled={!distanceAvailable}>Distance</option></select></label>
          <label>Layout<select aria-label="Chart layout" value={mode} onChange={e => setMode(e.target.value as "stacked" | "overlay")}><option value="stacked">Stacked</option><option value="overlay">Overlay</option></select></label>
          <label>Smoothing<select aria-label="Chart smoothing" value={smoothing} onChange={e => setSmoothing(Number(e.target.value))}>{[0, 5, 15, 30, 60].map(v => <option key={v} value={v}>{v ? `${v}s` : "Off"}</option>)}</select></label>
          <button disabled={!selection || selection[0] === selection[1]} onClick={() => setZoom(selection)}>Zoom selection</button><button disabled={!zoom} onClick={() => setZoom(null)}>Reset zoom</button>
        </div>
        <div className={styles.channelPills} aria-label="Visible channels">{visibleChannels.map((key, i) => <div key={key} style={{ borderColor: `${CHANNELS[key].color}55` }}><span style={{ color: CHANNELS[key].color }}>●</span>{CHANNELS[key].label}{view !== "Dynamics" && <><button aria-label={`Move ${CHANNELS[key].label} earlier`} disabled={i === 0} onClick={() => setChannels(existing => { const next = [...existing]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; return next; })}>←</button><button aria-label={`Hide ${CHANNELS[key].label}`} disabled={channels.length === 1} onClick={() => setChannels(existing => existing.filter(k => k !== key))}>×</button></>}</div>)}
          {view !== "Dynamics" && channels.length < 5 && <select aria-label="Add chart channel" value="" onChange={e => { if (e.target.value) setChannels(c => [...c, e.target.value as Channel]); }}><option value="">+ Add channel</option>{available.filter(k => !channels.includes(k)).map(k => <option key={k} value={k}>{CHANNELS[k].label}</option>)}</select>}</div>
        <div className={styles.inspection} aria-label="Inspected sample"><strong>{hover === null ? "Hover to inspect" : `${formatDuration(p.streams.elapsed[hover])} · ${formatDistance(p.streams.distance[hover], units)}`}</strong>{visibleChannels.map(k => <span key={k} style={{ color: CHANNELS[k].color }}>{formatChannel(k, hover === null ? null : p.streams.channels[k]?.[hover], units)} <small>{channelUnit(k, units)}</small></span>)}</div>
        <Timeline projection={p} channels={visibleChannels} mode={mode} axis={axis} units={units} smoothing={smoothing} resolution={resolution} zones={zoneBands} hover={hover} selection={selection} zoom={zoom} onHover={onHover} onSelect={onSelect} />
        <details className={styles.details}><summary>Selection & chart options</summary>
          <div className={styles.toolbar}><label className={styles.check}><input type="checkbox" checked={zoneBands} onChange={e => setZoneBands(e.target.checked)} />Configured zone bands</label><label>Display detail<select value={resolution} onChange={e => setResolution(Number(e.target.value))}><option value={1200}>Light</option><option value={2400}>Balanced</option><option value={6000}>Detailed</option></select></label></div>
          {!Object.keys(p.zones).length && <p className={styles.quiet}>No zones are configured for this sport and activity date.</p>}
          {hasSamples && <div className={styles.rangeControls}>
            <label>Inspect sample<input aria-label="Inspect sample" type="range" min={0} max={p.streams.elapsed.length - 1} value={hover ?? 0} onChange={e => setHover(Number(e.target.value))} /></label>
            <label>Selection start<input aria-label="Selection start" type="range" min={0} max={p.streams.elapsed.length - 1} value={selection?.[0] ?? 0} onChange={e => { const start = Number(e.target.value); setSelection([start, Math.max(start, selection?.[1] ?? p.streams.elapsed.length - 1)]); }} /></label>
            <label>Selection end<input aria-label="Selection end" type="range" min={0} max={p.streams.elapsed.length - 1} value={selection?.[1] ?? p.streams.elapsed.length - 1} onChange={e => { const end = Number(e.target.value); setSelection([Math.min(selection?.[0] ?? 0, end), end]); }} /></label>
          </div>}
        </details>
      </section>
      {view === "Overview" && <div className={styles.mapColumn}><RouteMap projection={p} units={units} hover={hover} selection={selection} onHover={onHover} onSelect={onSelect} /><section className={styles.noteCard}><span className={styles.eyebrow}>CONNECTED ANALYSIS</span><h3>Follow the same moment</h3><p>Move across the timeline or route to inspect every signal together. Select a section to focus the map, laps and summary on that effort.</p></section></div>}
    </div>}

    {view === "Intervals / laps" && <section className={styles.panel}><div className={styles.panelHeading}><div><h3>Recorded laps</h3><p className={styles.quiet}>Select a lap to update the charts, route and summary.</p></div><button onClick={() => setView("Overview")}>Show on overview</button></div>
      {!p.laps.length ? <p className={styles.empty}>No laps were recorded. Select a custom range on the timeline.</p> : <div className={styles.tableScroll}><table><thead><tr><th>Lap</th><th>Time</th><th>Distance</th><th>Pace</th><th>Heart rate</th></tr></thead><tbody>{p.laps.map(l => <tr key={l.id} className={selection && l.start <= selection[1] && l.end >= selection[0] ? styles.selectedRow : ""}><td><button onClick={() => setSelection([l.start, l.end])}>{l.label}</button></td><td>{formatDuration(l.duration)}</td><td>{formatDistance(l.distance, units)}</td><td>{formatPace(l.distance !== null && l.duration ? l.distance / l.duration : null, units)}</td><td>{l.heartRate ?? "—"} bpm</td></tr>)}</tbody></table></div>}
    </section>}
    {view === "Zones" && <section className={styles.panel}><h3>Your configured zones</h3><p className={styles.quiet}>Zones effective on the activity date. Enable zone bands in chart options to see these against your effort.</p>{!Object.keys(p.zones).length ? <p className={styles.empty}>No zone settings are available for this activity. Local files do not load account data automatically.</p> : Object.entries(p.zones).map(([k, zones]) => <div key={k}><h4>{CHANNELS[k as Channel].label}</h4>{zones.map(z => <p key={z.name} style={{ color: z.color }}>{z.name} · {formatChannel(k as Channel, z.lower, units)} – {formatChannel(k as Channel, z.upper, units)} {channelUnit(k as Channel, units)}</p>)}</div>)}</section>}
    {view === "Best efforts" && <section className={styles.panel}><h3>Best efforts</h3><p className={styles.empty}>Best-effort calculations are not available yet. You can inspect an effort now by selecting a range on the timeline.</p><button onClick={() => setView("Timeline")}>Explore timeline</button></section>}
    {view === "Raw data" && (raw ? <RawData decoded={raw} name={p.source.name} /> : <section className={styles.panel} role="status">{rawLoading ? "Loading complete FIT data…" : rawError || "Opening raw data…"}{rawError && <button onClick={() => { setView("Overview"); }}>Return to overview</button>}</section>)}
    <details className={styles.quality}><summary>Data quality & source <span>{p.quality.flags.length ? `${p.quality.flags.length} notes` : "All available streams ready"}</span></summary><p>{p.source.name} · {p.quality.inputRecords.toLocaleString()} original records · {p.quality.samples.toLocaleString()} aligned samples</p>{p.quality.flags.map(flag => <p key={flag}>{flag}</p>)}<p>Missing channels remain empty. Smoothed and reduced chart points are for display; range statistics use the original aligned samples.</p></details>
  </>;
}
