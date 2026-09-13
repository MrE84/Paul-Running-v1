"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { buildActivityIntelligence } from "../../lib/activity-analysis/intelligence";
import { builtInLayout, normalizeLayout, type AnalysisCardId, type AnalysisLayout } from "../../lib/activity-analysis/layout";
import { applyCorrectionLayers, buildCorrectionLayer, detectAnalysisAnomalies, performanceProfile, privacySafeGpx, QUALITY_VERSION } from "../../lib/activity-analysis/quality";
import { CHANNELS, type AnalysisProjection, type Axis, type Channel, type IndexRange } from "../../lib/activity-analysis/projection";
import { channelUnit, formatChannel, rangeSummary, type PrivacyRegion } from "../../lib/activity-analysis/selection";
import { formatDistance, formatDuration, formatPace } from "../../lib/activity-analysis/core";
import type { DecodedFit, UnitSystem } from "../../lib/activity-analysis/contracts";
import { BestEffortsPanel, IntervalsPanel, ZonesPanel } from "./AnalysisPanels";
import AnalysisPanelBoundary from "./AnalysisPanelBoundary";
import WorkspaceLayoutControls from "./WorkspaceLayoutControls";
import styles from "./analysis.module.css";

const Timeline = dynamic(() => import("./AnalysisTimeline"), { ssr: false, loading: () => <div className={styles.skeleton}>Preparing timeline…</div> });
const RouteMap = dynamic(() => import("./AnalysisMap"), { ssr: false, loading: () => <div className={styles.skeleton}>Preparing route…</div> });
const RawData = dynamic(() => import("./RawData"), { loading: () => <div className={styles.skeleton}>Opening raw data…</div> });
const views = ["Overview", "Timeline", "Intervals / laps", "Zones", "Best efforts", "Dynamics", "Raw data"] as const;
type AnalysisView = typeof views[number];

const cardView: Partial<Record<AnalysisCardId, AnalysisView>> = {
  timeline: "Timeline",
  map: "Overview",
  elevation: "Overview",
  intervals: "Intervals / laps",
  zones: "Zones",
  records: "Best efforts",
  derived: "Best efforts",
  dynamics: "Dynamics",
};

export default function ActivityWorkspace({ projection: p, units, loadRaw, loadWeather }: { projection: AnalysisProjection; units: UnitSystem; loadRaw: () => Promise<DecodedFit>; loadWeather?: () => Promise<AnalysisProjection> }) {
  const available = useMemo(() => Object.keys(p.streams.channels) as Channel[], [p]);
  const [layout, setLayout] = useState<AnalysisLayout>(() => normalizeLayout(builtInLayout("auto", p.activity.sport), p.activity.sport, available));
  const [view, setView] = useState<AnalysisView>("Overview");
  const [resolution, setResolution] = useState(() => performanceProfile(p).recommendedTimelinePoints);
  const [hover, setHover] = useState<number | null>(null);
  const [selection, setSelection] = useState<IndexRange | null>(null);
  const [zoom, setZoom] = useState<IndexRange | null>(null);
  const [raw, setRaw] = useState<DecodedFit | null>(null);
  const [rawError, setRawError] = useState("");
  const [rawLoading, setRawLoading] = useState(false);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState("");
  const [corrections, setCorrections] = useState(false);
  const [privacy, setPrivacy] = useState<{ endpointRadius: number; regions: PrivacyRegion[] }>({ endpointRadius: 200, regions: [] });
  const channels = layout.channels;
  const axis = layout.axis;
  const mode = layout.mode;
  const smoothing = layout.smoothingSeconds;
  const zoneBands = layout.showZoneBands;
  const anomalies = useMemo(() => detectAnalysisAnomalies(p), [p]);
  const correctionLayers = useMemo(() => available.map(channel => buildCorrectionLayer(p, channel, anomalies)).filter(layer => layer.correctedIndices.length), [p, available, anomalies]);
  const displayProjection = useMemo(() => corrections ? applyCorrectionLayers(p, correctionLayers) : p, [p, corrections, correctionLayers]);
  const profile = useMemo(() => performanceProfile(p), [p]);
  const stats = useMemo(() => rangeSummary(p, selection), [p, selection]);
  const intelligence = useMemo(() => p.intelligence ?? buildActivityIntelligence(p), [p]);
  const planned = useMemo(() => intelligence.intervals.filter(interval => interval.source === "planned"), [intelligence]);
  const onHover = useCallback((index: number | null) => setHover(index), []);
  const onSelect = useCallback((range: IndexRange | null) => setSelection(range), []);
  const dynamics = useMemo(() => available.filter(k => ["cadence", "vertical_oscillation", "ground_contact_time", "respiration_rate", "power"].includes(k)).slice(0, 5), [available]);
  const visibleChannels = view === "Dynamics" ? dynamics : channels;
  const distanceAvailable = p.streams.distance.filter(v => v !== null).length > 1;
  const hasSamples = p.streams.elapsed.length > 0;
  const readiness = p.activity.readiness;
  const visibleViews = useMemo(() => {
    const ordered = layout.cards.filter(card => card.visible).flatMap(card => cardView[card.id] ? [cardView[card.id]!] : []);
    return [...new Set([...ordered, "Raw data" as const])];
  }, [layout.cards]);
  const card = useCallback((id: AnalysisCardId) => layout.cards.find(value => value.id === id), [layout.cards]);
  const onLayoutChange = useCallback((value: AnalysisLayout) => setLayout(normalizeLayout(value, p.activity.sport, available)), [p.activity.sport, available]);
  const updateLayout = useCallback((patch: Partial<AnalysisLayout>) => setLayout(current => normalizeLayout({ ...current, ...patch }, p.activity.sport, available)), [p.activity.sport, available]);

  useEffect(() => {
    if (view !== "Raw data" || raw) return;
    let cancelled = false;
    setRawLoading(true); setRawError("");
    loadRaw().then(value => { if (!cancelled) setRaw(value); }).catch(error => { if (!cancelled) setRawError(error instanceof Error ? error.message : "Could not load raw data."); }).finally(() => { if (!cancelled) setRawLoading(false); });
    return () => { cancelled = true; };
  }, [view, raw, loadRaw]);

  useEffect(() => {
    if (!visibleViews.includes(view)) setView(visibleViews[0] ?? "Raw data");
  }, [view, visibleViews]);

  useEffect(() => {
    if (!distanceAvailable && layout.axis === "distance") updateLayout({ axis: "time" });
  }, [distanceAvailable, layout.axis, updateLayout]);

  const onPrivacyChange = useCallback((value: { endpointRadius: number; regions: PrivacyRegion[] }) => setPrivacy(value), []);

  function downloadPrivateGpx() {
    const gpx = privacySafeGpx(p, privacy.endpointRadius, privacy.regions);
    const link = document.createElement("a");
    const url = URL.createObjectURL(new Blob([gpx], { type: "application/gpx+xml" }));
    link.href = url;
    link.download = `${p.activity.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "activity"}-privacy-safe.gpx`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

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
      <div className={styles.headerTools}>{hasSamples && <Link href={`/activity-analysis/compare?id=${encodeURIComponent(p.activity.id)}`}>Add to comparison</Link>}<Link href="/activity-analysis/trends">Performance trends</Link><span className={styles.badge}>{readiness ? readiness.state.replaceAll("_", " ") : `${p.quality.samples.toLocaleString()} samples`} · {available.length} channels</span></div>
    </header>
    <div className={styles.contextLine}><span>{p.activity.calendarItemId ? "Linked to your training plan" : "Completed workout"}</span><span>{p.weather?.status === "available" ? `Ambient ${formatChannel("ambient_temperature", selection ? stats.means.ambient_temperature : p.weather.summary.temperatureC, units)} ${channelUnit("ambient_temperature", units)}` : p.streams.channels.temperature ? `Device ${formatChannel("temperature", stats.means.temperature, units)} ${channelUnit("temperature", units)} · ambient not loaded` : "Ambient weather not loaded"}</span><span>{!hasSamples ? "Detailed FIT data unavailable" : p.quality.flags.length ? "Partial data · details below" : "Ready to explore"}</span></div>
    <div className={styles.metrics} aria-label={selection ? "Selected range metrics" : "Activity metrics"}>{cards.map(([label, value], i) => <article key={label}><span>{label}</span><strong style={{ color: i === 0 ? "#91ebc8" : undefined }}>{value}</strong></article>)}</div>
    {!hasSamples && <section className={styles.panel} role="status"><div className={styles.panelHeading}><div><span className={styles.eyebrow}>RECOVERY AVAILABLE</span><h3>{readiness?.state === "invalid" ? "This activity needs its FIT data restored" : "This activity currently has summary data only"}</h3></div></div><p>{readiness?.reasons[0] ?? "Detailed FIT records are not available for analysis."}</p><p>Return to the activity library and choose Repair incomplete. The existing activity link will stay the same, and stored data is replaced only after a successful decode.</p><Link href="/activity-analysis">Open activity library</Link></section>}
    {hasSamples && <WorkspaceLayoutControls sport={p.activity.sport} availableChannels={available} layout={layout} onChange={onLayoutChange} />}
    {hasSamples && <nav className={styles.tabs} aria-label="Analysis views">{visibleViews.map(v => <button key={v} aria-pressed={view === v} className={view === v ? styles.activeTab : ""} onClick={() => setView(v)}>{v}</button>)}</nav>}

    {hasSamples && selection && <div className={styles.selectionBanner} role="status"><span>Selected <strong>{formatDuration(p.streams.elapsed[selection[0]])} – {formatDuration(p.streams.elapsed[selection[1]])}</strong> · {formatDistance(stats.distance, units)}</span><button onClick={() => setSelection(null)}>Clear selection</button></div>}

    {hasSamples && ["Overview", "Timeline", "Dynamics"].includes(view) && <div className={view === "Overview" ? styles.analysisGrid : styles.singleGrid}>
      {(view !== "Overview" || card("timeline")?.visible || card("elevation")?.visible) && <section className={styles.panel} data-card-size={card(view === "Dynamics" ? "dynamics" : "timeline")?.size ?? "full"} style={{ order: card(view === "Dynamics" ? "dynamics" : "timeline") ? layout.cards.indexOf(card(view === "Dynamics" ? "dynamics" : "timeline")!) : 0 }}>
        <div className={styles.panelHeading}><div><span className={styles.eyebrow}>YOUR EFFORT</span><h3>{view === "Dynamics" ? "Running dynamics" : "One run. Every signal."}</h3></div><span className={styles.badge}>{mode}</span></div>
        <div className={styles.toolbar}>
          <label>Axis<select aria-label="Timeline axis" value={axis} onChange={e => updateLayout({ axis: e.target.value as Axis })}><option value="time">Time</option><option value="distance" disabled={!distanceAvailable}>Distance</option></select></label>
          <label>Layout<select aria-label="Chart layout" value={mode} onChange={e => updateLayout({ mode: e.target.value as "stacked" | "overlay" })}><option value="stacked">Stacked</option><option value="overlay">Overlay</option></select></label>
          <label>Smoothing<select aria-label="Chart smoothing" value={smoothing} onChange={e => updateLayout({ smoothingSeconds: Number(e.target.value) })}>{[0, 5, 15, 30, 60].map(v => <option key={v} value={v}>{v ? `${v}s` : "Off"}</option>)}</select></label>
          <button disabled={!selection || selection[0] === selection[1]} onClick={() => setZoom(selection)}>Zoom selection</button><button disabled={!zoom} onClick={() => setZoom(null)}>Reset zoom</button>
        </div>
        <div className={styles.channelPills} aria-label="Visible channels">{visibleChannels.map((key, i) => <div key={key} style={{ borderColor: `${CHANNELS[key].color}55` }}><span style={{ color: CHANNELS[key].color }}>●</span>{CHANNELS[key].label}{view !== "Dynamics" && <><button aria-label={`Move ${CHANNELS[key].label} earlier`} disabled={i === 0} onClick={() => { const next = [...channels]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; updateLayout({ channels: next }); }}>←</button><button aria-label={`Hide ${CHANNELS[key].label}`} disabled={channels.length === 1} onClick={() => updateLayout({ channels: channels.filter(k => k !== key) })}>×</button></>}</div>)}
          {view !== "Dynamics" && channels.length < 5 && <select aria-label="Add chart channel" value="" onChange={e => { if (e.target.value) updateLayout({ channels: [...channels, e.target.value as Channel] }); }}><option value="">+ Add channel</option>{available.filter(k => !channels.includes(k)).map(k => <option key={k} value={k}>{CHANNELS[k].label}</option>)}</select>}</div>
        <div className={styles.inspection} aria-label="Inspected sample"><strong>{hover === null ? "Hover to inspect" : `${formatDuration(p.streams.elapsed[hover])} · ${formatDistance(p.streams.distance[hover], units)}`}</strong>{visibleChannels.map(k => <span key={k} style={{ color: CHANNELS[k].color }}>{formatChannel(k, hover === null ? null : displayProjection.streams.channels[k]?.[hover], units)} <small>{channelUnit(k, units)}</small></span>)}</div>
        <AnalysisPanelBoundary activityId={p.activity.id} name="Signal timeline"><Timeline projection={displayProjection} channels={visibleChannels} mode={mode} axis={axis} units={units} smoothing={smoothing} resolution={resolution} zones={zoneBands} plannedIntervals={planned} hover={hover} selection={selection} zoom={zoom} onHover={onHover} onSelect={onSelect} /></AnalysisPanelBoundary>
        <details className={styles.details}><summary>Selection & chart options</summary>
          <div className={styles.toolbar}><label className={styles.check}><input type="checkbox" checked={zoneBands} onChange={e => updateLayout({ showZoneBands: e.target.checked })} />Configured zone bands</label><label>Display detail<select value={resolution} onChange={e => setResolution(Number(e.target.value))}><option value={1200}>Light</option><option value={2400}>Balanced</option><option value={6000}>Detailed</option></select></label></div>
          {!Object.keys(p.zones).length && <p className={styles.quiet}>No zones are configured for this sport and activity date.</p>}
          {hasSamples && <div className={styles.rangeControls}>
            <label>Inspect sample<input aria-label="Inspect sample" type="range" min={0} max={p.streams.elapsed.length - 1} value={hover ?? 0} onChange={e => setHover(Number(e.target.value))} /></label>
            <label>Selection start<input aria-label="Selection start" type="range" min={0} max={p.streams.elapsed.length - 1} value={selection?.[0] ?? 0} onChange={e => { const start = Number(e.target.value); setSelection([start, Math.max(start, selection?.[1] ?? p.streams.elapsed.length - 1)]); }} /></label>
            <label>Selection end<input aria-label="Selection end" type="range" min={0} max={p.streams.elapsed.length - 1} value={selection?.[1] ?? p.streams.elapsed.length - 1} onChange={e => { const end = Number(e.target.value); setSelection([Math.min(selection?.[0] ?? 0, end), end]); }} /></label>
          </div>}
        </details>
      </section>}
      {view === "Overview" && card("map")?.visible && <div className={styles.mapColumn} data-card-size={card("map")?.size ?? "half"} style={{ order: layout.cards.indexOf(card("map")!) }}><AnalysisPanelBoundary activityId={p.activity.id} name="Route map"><RouteMap projection={displayProjection} units={units} hover={hover} selection={selection} onHover={onHover} onSelect={onSelect} privacy={privacy} onPrivacyChange={onPrivacyChange} /></AnalysisPanelBoundary>
        <section className={styles.noteCard}><span className={styles.eyebrow}>ROUTE WEATHER</span><h3>{p.weather?.status === "available" ? "Conditions along the run" : "Add historical conditions"}</h3>
          {p.weather?.status === "available" ? <><p>{selection ? "Selected segment" : "Whole route"}: {formatChannel("ambient_temperature", selection ? stats.means.ambient_temperature : p.weather.summary.temperatureC, units)} {channelUnit("ambient_temperature", units)} · {formatChannel("humidity", selection ? stats.means.humidity : p.weather.summary.relativeHumidityPercent, units)}% humidity · {formatChannel("wind_speed", selection ? stats.means.wind_speed : p.weather.summary.windSpeedMps, units)} {channelUnit("wind_speed", units)} wind · {formatChannel("headwind", selection ? stats.means.headwind : p.weather.summary.headwindMps, units)} {channelUnit("headwind", units)} headwind.</p><p>Open-Meteo archive · {p.weather.model} · {p.weather.version}. Device temperature remains a separate FIT channel.</p></> : <><p>{p.weather?.message ?? "Sample ambient temperature, humidity, precipitation and wind along the actual route and activity time."}</p>{loadWeather && <button disabled={weatherLoading} onClick={() => { setWeatherLoading(true); setWeatherError(""); loadWeather().catch(error => setWeatherError(error instanceof Error ? error.message : "Weather could not be loaded.")).finally(() => setWeatherLoading(false)); }}>{weatherLoading ? "Loading route weather…" : "Load route weather"}</button>}{weatherError && <p role="status">{weatherError}</p>}</>}
        </section>
        <section className={styles.noteCard}><span className={styles.eyebrow}>CONNECTED ANALYSIS</span><h3>Follow the same moment</h3><p>Move across the timeline or route to inspect every signal together. Select a section to focus the map, laps and summary on that effort.</p></section></div>}
    </div>}

    {hasSamples && view === "Intervals / laps" && <AnalysisPanelBoundary activityId={p.activity.id} name="Intervals and laps"><IntervalsPanel projection={p} intelligence={intelligence} selection={selection} onSelect={onSelect} units={units} /></AnalysisPanelBoundary>}
    {hasSamples && view === "Zones" && <AnalysisPanelBoundary activityId={p.activity.id} name="Zones and relationships"><ZonesPanel projection={p} selection={selection} onSelect={onSelect} units={units} /></AnalysisPanelBoundary>}
    {hasSamples && view === "Best efforts" && <AnalysisPanelBoundary activityId={p.activity.id} name="Best efforts"><BestEffortsPanel projection={p} intelligence={intelligence} selection={selection} onSelect={onSelect} units={units} /></AnalysisPanelBoundary>}
    {hasSamples && view === "Raw data" && <AnalysisPanelBoundary activityId={p.activity.id} name="Raw data">{raw ? <RawData decoded={raw} name={p.source.name} /> : <section className={styles.panel} role="status">{rawLoading ? "Loading complete FIT data…" : rawError || "Opening raw data…"}{rawError && <button onClick={() => { setView(visibleViews.find(value => value !== "Raw data") ?? "Raw data"); }}>Return to analysis</button>}</section>}</AnalysisPanelBoundary>}
    <details className={styles.quality}><summary>Data quality, corrections & export <span>{p.quality.flags.length + anomalies.length ? `${p.quality.flags.length + anomalies.length} notes` : "All available streams ready"}</span></summary>
      <div className={styles.qualityActions}><label><input type="checkbox" checked={corrections} disabled={!correctionLayers.length} onChange={event => setCorrections(event.target.checked)} />Interpolate flagged signal samples for display</label><button disabled={!hasSamples} onClick={downloadPrivateGpx}>Download privacy-safe GPX</button></div>
      <p>{p.source.name} · {p.quality.inputRecords.toLocaleString()} original records · {p.quality.samples.toLocaleString()} aligned samples · quality algorithm {QUALITY_VERSION}</p>
      {p.quality.flags.map(flag => <p key={flag}>{flag}</p>)}
      {anomalies.length > 0 && <div className={styles.anomalyList} aria-label="Detected activity anomalies">{anomalies.slice(0, 40).map(anomaly => <button key={anomaly.id} onClick={() => { setHover(anomaly.index); setSelection([anomaly.index, anomaly.index]); }}><span><strong>{anomaly.channel === "gps" ? "GPS" : CHANNELS[anomaly.channel].label}</strong><small>{anomaly.kind.replaceAll("_", " ")} · {formatDuration(anomaly.elapsedSeconds)}</small></span><span>{anomaly.message}</span></button>)}{anomalies.length > 40 && <p>{anomalies.length - 40} additional flags are retained in the analysis result.</p>}</div>}
      <p>{corrections ? `${correctionLayers.reduce((sum, layer) => sum + layer.correctedIndices.length, 0)} flagged values are interpolated in the visible timeline. ` : ""}Corrections are an optional display layer with recorded provenance; raw FIT data, canonical range statistics and persisted activity records are unchanged.</p>
      <p>{profile.largeActivity ? "Large-activity mode is active. " : ""}{profile.estimatedRawNumericValues.toLocaleString()} aligned numeric values · {resolution.toLocaleString()} peak-preserving timeline points requested · {(profile.reductionRatio * 100).toFixed(0)}% recommended display ratio.</p>
      <p>The GPX download applies the current {privacy.endpointRadius} m endpoint mask and {privacy.regions.length} custom region {privacy.regions.length === 1 ? "mask" : "masks"}. Missing channels remain empty; panel failures are isolated so one corrupt stream cannot take down the page.</p>
    </details>
  </>;
}
