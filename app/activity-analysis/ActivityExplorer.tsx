"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CHART_METRICS,
  availableChartMetrics,
  buildChartSeries,
  buildRoute,
  formatDistance,
  formatDuration,
  formatPace,
  formatSpeed,
  loadBrowserFitFile,
  normaliseDate,
  rowsToCsv,
  safeNumber,
  serialisable,
  unionKeys,
  type AnalysedActivity,
  type ChartMetricKey,
  type DecodedGroup,
  type FitRow,
  type UnitSystem,
} from "../../lib/activity-analysis";
import styles from "./activity-explorer.module.css";

type Tab = "summary" | "charts" | "route" | "laps" | "records" | "data";

const tabs: Array<[Tab, string]> = [
  ["summary", "Summary"],
  ["charts", "Charts"],
  ["route", "Route"],
  ["laps", "Laps"],
  ["records", "Records"],
  ["data", "All decoded data"],
];

function titleCase(value: unknown): string {
  return String(value ?? "")
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: unknown, includeTime = true): string {
  const date = normaliseDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat(undefined, includeTime
    ? { dateStyle: "medium", timeStyle: "medium" }
    : { dateStyle: "medium" }).format(date);
}

function formatMetres(value: number | null, units: UnitSystem): string {
  if (value === null) return "—";
  return units === "metric" ? `${value.toFixed(0)} m` : `${(value * 3.280839895).toFixed(0)} ft`;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (value instanceof Date) return formatDate(value);
  if (typeof value === "number") return Number.isInteger(value) ? value.toLocaleString() : Number(value.toFixed(6)).toLocaleString();
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") {
    const text = JSON.stringify(serialisable(value));
    return text.length > 180 ? `${text.slice(0, 177)}…` : text;
  }
  return String(value);
}

function download(content: string, type: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function basename(name: string): string {
  return name.replace(/\.fit$/i, "");
}

function DataTable({ rows, columns, limit }: { rows: FitRow[]; columns?: string[]; limit?: number }) {
  if (!rows.length) return <div className={styles.emptyPanel}>No rows in this section.</div>;
  const keys = columns ?? unionKeys(rows);
  const visible = limit ? rows.slice(0, limit) : rows;
  return (
    <div className={styles.tableScroll}>
      <table>
        <thead><tr>{keys.map((key) => <th key={key}>{titleCase(key)}</th>)}</tr></thead>
        <tbody>
          {visible.map((row, index) => (
            <tr key={index}>{keys.map((key) => <td key={key} title={formatCell(row?.[key])}>{formatCell(row?.[key])}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SummaryPanel({ activity, units }: { activity: AnalysedActivity; units: UnitSystem }) {
  const summary = activity.summary;
  const session = summary.session;
  const cards = [
    ["Activity", [session.sport_profile_name, session.sub_sport, session.sport].filter(Boolean).map(titleCase).join(" · ") || "FIT activity"],
    ["Start", formatDate(summary.start)],
    ["Moving time", formatDuration(summary.timerTime)],
    ["Elapsed time", formatDuration(summary.elapsedTime)],
    ["Distance", formatDistance(summary.distance, units)],
    ["Average pace", formatPace(summary.avgSpeed, units)],
    ["Average speed", formatSpeed(summary.avgSpeed, units)],
    ["Maximum speed", formatSpeed(summary.maxSpeed, units)],
    ["Average heart rate", safeNumber(session.avg_heart_rate) === null ? "—" : `${session.avg_heart_rate} bpm`],
    ["Maximum heart rate", safeNumber(session.max_heart_rate) === null ? "—" : `${session.max_heart_rate} bpm`],
    ["Average cadence", summary.avgCadence === null ? "—" : `${Math.round(summary.avgCadence)} spm`],
    ["Maximum cadence", summary.maxCadence === null ? "—" : `${Math.round(summary.maxCadence)} spm`],
    ["Calories", safeNumber(session.total_calories) === null ? "—" : `${session.total_calories} kcal`],
    ["Elevation gain", formatMetres(summary.totalAscent, units)],
    ["Elevation loss", formatMetres(summary.totalDescent, units)],
    ["Aerobic training effect", formatCell(session.total_training_effect)],
    ["Anaerobic training effect", formatCell(session.total_anaerobic_training_effect)],
    ["Temperature", safeNumber(session.avg_temperature) === null ? "—" : `${Number(session.avg_temperature).toFixed(1)} °C`],
    ["Laps", summary.lapCount.toLocaleString()],
    ["Record points", summary.recordCount.toLocaleString()],
    ["Decoded sections", summary.decodedSectionCount.toLocaleString()],
    ["Data fields", summary.recordFields.length.toLocaleString()],
  ];
  return (
    <>
      <div className={styles.metricGrid}>
        {cards.map(([label, value]) => <article className={styles.metricCard} key={String(label)}><span>{label}</span><strong>{value}</strong></article>)}
      </div>
      <section className={styles.panel}>
        <div className={styles.panelHeading}><div><h3>Session details</h3><p>Core FIT session metadata</p></div></div>
        <dl className={styles.detailsGrid}>
          <div><dt>Sport</dt><dd>{titleCase(session.sport || "—")}</dd></div>
          <div><dt>Sub-sport</dt><dd>{titleCase(session.sub_sport || "—")}</dd></div>
          <div><dt>Trigger</dt><dd>{titleCase(session.trigger || "—")}</dd></div>
          <div><dt>Cycles / strides</dt><dd>{formatCell(session.total_cycles ?? session.total_strides)}</dd></div>
          <div><dt>Start</dt><dd>{formatDate(summary.start)}</dd></div>
          <div><dt>End</dt><dd>{formatDate(summary.end)}</dd></div>
          <div><dt>FIT protocol</dt><dd>{formatCell(activity.parsed.protocolVersion)}</dd></div>
          <div><dt>FIT profile</dt><dd>{formatCell(activity.parsed.profileVersion)}</dd></div>
        </dl>
      </section>
    </>
  );
}

function ChartPanel({ activity, units, metric, setMetric }: { activity: AnalysedActivity; units: UnitSystem; metric: ChartMetricKey; setMetric: (metric: ChartMetricKey) => void }) {
  const available = useMemo(() => availableChartMetrics(activity.records), [activity]);
  useEffect(() => {
    if (available.length && !available.some((candidate) => candidate.key === metric)) setMetric(available[0].key);
  }, [available, metric, setMetric]);
  const points = useMemo(() => buildChartSeries(activity.parsed, metric, units), [activity, metric, units]);
  const definition = CHART_METRICS.find((candidate) => candidate.key === metric);
  if (!available.length) return <div className={styles.emptyPanel}>No chartable record fields were decoded.</div>;

  const width = 900;
  const height = 330;
  const pad = 40;
  const minX = points.length ? Math.min(...points.map((point) => point.x)) : 0;
  const maxX = points.length ? Math.max(...points.map((point) => point.x)) : 1;
  let minY = points.length ? Math.min(...points.map((point) => point.y)) : 0;
  let maxY = points.length ? Math.max(...points.map((point) => point.y)) : 1;
  if (minY === maxY) { minY -= 1; maxY += 1; }
  const x = (value: number) => pad + ((value - minX) / Math.max(1, maxX - minX)) * (width - pad * 2);
  const y = (value: number) => height - pad - ((value - minY) / Math.max(1, maxY - minY)) * (height - pad * 2);
  const polyline = points.map((point) => `${x(point.x).toFixed(1)},${y(point.y).toFixed(1)}`).join(" ");

  const unit = metric === "heart_rate" ? "bpm"
    : metric === "pace" ? (units === "metric" ? "min/km" : "min/mi")
      : metric === "speed" ? (units === "metric" ? "km/h" : "mph")
        : metric === "cadence" ? "spm"
          : metric === "altitude" ? (units === "metric" ? "m" : "ft")
            : metric === "power" ? "W"
              : metric === "temperature" ? "°C"
                : metric === "distance" ? (units === "metric" ? "km" : "mi")
                  : metric === "grade" ? "%"
                    : metric === "vertical_oscillation" ? "mm"
                      : metric === "ground_contact_time" ? "ms" : "brpm";

  return (
    <section className={styles.panel}>
      <div className={styles.panelHeading}>
        <div><h3>{definition?.label ?? titleCase(metric)} over time</h3><p>{points.length.toLocaleString()} decoded points · {unit}</p></div>
        <select value={metric} onChange={(event) => setMetric(event.target.value as ChartMetricKey)}>
          {available.map((candidate) => <option key={candidate.key} value={candidate.key}>{candidate.label}</option>)}
        </select>
      </div>
      {points.length < 2 ? <div className={styles.emptyPanel}>There are not enough points for this metric.</div> : (
        <div className={styles.chartBox}>
          <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${definition?.label ?? metric} chart`}>
            {[0, 1, 2, 3, 4].map((index) => {
              const gridY = pad + index * ((height - pad * 2) / 4);
              return <line key={index} x1={pad} y1={gridY} x2={width - pad} y2={gridY} className={styles.gridLine} />;
            })}
            <polyline points={polyline} fill="none" className={styles.chartLine} />
            <text x={pad} y={height - 12} className={styles.svgLabel}>{formatDuration(minX)}</text>
            <text x={width - pad} y={height - 12} textAnchor="end" className={styles.svgLabel}>{formatDuration(maxX)}</text>
            <text x={pad + 4} y={20} className={styles.svgLabel}>{metric === "pace" ? `${formatDuration(maxY)} ${unit}` : `${maxY.toFixed(1)} ${unit}`}</text>
            <text x={pad + 4} y={height - pad - 6} className={styles.svgLabel}>{metric === "pace" ? `${formatDuration(minY)} ${unit}` : `${minY.toFixed(1)} ${unit}`}</text>
          </svg>
        </div>
      )}
    </section>
  );
}

function RoutePanel({ activity }: { activity: AnalysedActivity }) {
  const points = useMemo(() => buildRoute(activity.parsed), [activity]);
  if (points.length < 2) return <div className={styles.emptyPanel}>No usable GPS route was decoded from this FIT file.</div>;
  const width = 900;
  const height = 420;
  const pad = 30;
  const minLat = Math.min(...points.map((point) => point.lat));
  const maxLat = Math.max(...points.map((point) => point.lat));
  const minLon = Math.min(...points.map((point) => point.lon));
  const maxLon = Math.max(...points.map((point) => point.lon));
  const latSpan = maxLat - minLat || 0.001;
  const lonSpan = maxLon - minLon || 0.001;
  const x = (lon: number) => pad + ((lon - minLon) / lonSpan) * (width - pad * 2);
  const y = (lat: number) => height - pad - ((lat - minLat) / latSpan) * (height - pad * 2);
  const path = points.map((point) => `${x(point.lon).toFixed(1)},${y(point.lat).toFixed(1)}`).join(" ");
  return (
    <section className={styles.panel}>
      <div className={styles.panelHeading}><div><h3>Recorded route</h3><p>{points.length.toLocaleString()} GPS points · browser-local rendering</p></div></div>
      <div className={styles.routeBox}>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Recorded GPS route">
          {[1,2,3,4].map((index) => <line key={`v${index}`} x1={(width / 5) * index} y1="0" x2={(width / 5) * index} y2={height} className={styles.gridLine} />)}
          {[1,2,3,4].map((index) => <line key={`h${index}`} x1="0" y1={(height / 5) * index} x2={width} y2={(height / 5) * index} className={styles.gridLine} />)}
          <polyline points={path} fill="none" className={styles.routeLine} />
          <circle cx={x(points[0].lon)} cy={y(points[0].lat)} r="7" className={styles.routePoint} />
          <circle cx={x(points.at(-1)!.lon)} cy={y(points.at(-1)!.lat)} r="10" fill="none" className={styles.routeEnd} />
        </svg>
      </div>
      <p className={styles.coordinateNote}>{minLat.toFixed(5)}, {minLon.toFixed(5)} → {maxLat.toFixed(5)}, {maxLon.toFixed(5)}</p>
    </section>
  );
}

function LapsPanel({ activity, units }: { activity: AnalysedActivity; units: UnitSystem }) {
  const session = activity.summary.session;
  const rows = activity.laps.map((lap, index) => {
    const distance = safeNumber(lap.total_distance);
    const timer = safeNumber(lap.total_timer_time) ?? safeNumber(lap.total_elapsed_time);
    const speed = safeNumber(lap.enhanced_avg_speed) ?? safeNumber(lap.avg_speed) ?? (distance !== null && timer !== null && timer > 0 ? distance / timer : null);
    const cadence = safeNumber(lap.avg_cadence);
    return {
      lap: index + 1,
      start_time: formatDate(lap.start_time),
      duration: formatDuration(timer),
      distance: formatDistance(distance, units),
      average_pace: formatPace(speed, units),
      average_heart_rate: safeNumber(lap.avg_heart_rate) === null ? "—" : `${lap.avg_heart_rate} bpm`,
      maximum_heart_rate: safeNumber(lap.max_heart_rate) === null ? "—" : `${lap.max_heart_rate} bpm`,
      average_cadence: cadence === null ? "—" : `${Math.round(String(session.sport).toLowerCase() === "running" ? cadence * 2 : cadence)} spm`,
      calories: safeNumber(lap.total_calories) === null ? "—" : `${lap.total_calories} kcal`,
      trigger: lap.lap_trigger ?? "—",
    };
  });
  return (
    <>
      <section className={styles.panel}><div className={styles.panelHeading}><div><h3>Lap summary</h3><p>{rows.length.toLocaleString()} laps</p></div></div><DataTable rows={rows} /></section>
      <section className={styles.panel}><div className={styles.panelHeading}><div><h3>Raw lap messages</h3><p>All decoded lap fields</p></div></div><DataTable rows={activity.laps} /></section>
    </>
  );
}

function RecordsPanel({ activity, units }: { activity: AnalysedActivity; units: UnitSystem }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 100;
  useEffect(() => { setPage(1); setQuery(""); }, [activity.source.id]);
  const columns = useMemo(() => {
    const all = unionKeys(activity.records);
    const preferred = ["timestamp", "elapsed_time", "timer_time", "distance", "heart_rate", "enhanced_speed", "speed", "cadence", "enhanced_altitude", "altitude", "power", "temperature"];
    return [...preferred.filter((key) => all.includes(key)), ...all.filter((key) => !preferred.includes(key))];
  }, [activity]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return activity.records;
    return activity.records.filter((record) => columns.some((column) => `${titleCase(column)} ${formatCell(record?.[column])}`.toLowerCase().includes(normalized)));
  }, [activity, columns, query]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((record) => ({ ...record }));
  const displayRows = visible.map((record) => {
    const row = { ...record };
    if (row.timestamp) row.timestamp = formatDate(row.timestamp);
    if (safeNumber(row.elapsed_time) !== null) row.elapsed_time = formatDuration(row.elapsed_time, true);
    if (safeNumber(row.timer_time) !== null) row.timer_time = formatDuration(row.timer_time, true);
    if (safeNumber(row.distance) !== null) row.distance = formatDistance(row.distance, units, 3);
    if (safeNumber(row.enhanced_speed) !== null) row.enhanced_speed = formatSpeed(row.enhanced_speed, units, 2);
    if (safeNumber(row.speed) !== null) row.speed = formatSpeed(row.speed, units, 2);
    return row;
  });
  return (
    <section className={styles.panel}>
      <div className={styles.recordsToolbar}>
        <div><h3>Record messages</h3><p>{filtered.length.toLocaleString()} of {activity.records.length.toLocaleString()} records</p></div>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search records or fields" />
      </div>
      <DataTable rows={displayRows} columns={columns} />
      <div className={styles.pager}>
        <button disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button>
        <span>Page {currentPage} of {pages}</span>
        <button disabled={currentPage >= pages} onClick={() => setPage((value) => Math.min(pages, value + 1))}>Next</button>
      </div>
    </section>
  );
}

function DataPanel({ activity }: { activity: AnalysedActivity }) {
  const [selected, setSelected] = useState(activity.groups[0]?.key ?? "");
  const [view, setView] = useState<"table" | "json">("table");
  useEffect(() => { setSelected(activity.groups[0]?.key ?? ""); setView("table"); }, [activity.source.id, activity.groups]);
  const group: DecodedGroup | undefined = activity.groups.find((candidate) => candidate.key === selected) ?? activity.groups[0];
  return (
    <div className={styles.dataExplorer}>
      <aside className={styles.groupList}>
        {activity.groups.map((candidate) => (
          <button key={candidate.key} className={candidate.key === group?.key ? styles.groupActive : ""} onClick={() => setSelected(candidate.key)}>
            <span>{titleCase(candidate.key)}</span><strong>{candidate.count.toLocaleString()}</strong>
          </button>
        ))}
      </aside>
      <section className={styles.panelInline}>
        {!group ? <div className={styles.emptyPanel}>No decoded sections.</div> : <>
          <div className={styles.panelHeading}>
            <div><h3>{titleCase(group.key)}</h3><p>{group.count.toLocaleString()} item{group.count === 1 ? "" : "s"} · {unionKeys(group.rows).length.toLocaleString()} fields</p></div>
            <div className={styles.viewSwitch}><button className={view === "table" ? styles.selectedButton : ""} onClick={() => setView("table")}>Table</button><button className={view === "json" ? styles.selectedButton : ""} onClick={() => setView("json")}>JSON</button></div>
          </div>
          {view === "table" ? <><DataTable rows={group.rows} limit={500} />{group.rows.length > 500 && <p className={styles.coordinateNote}>Table limited to first 500 rows; JSON export remains complete.</p>}</> : <pre className={styles.jsonView}>{JSON.stringify(serialisable(group.value), null, 2)}</pre>}
        </>}
      </section>
    </div>
  );
}

export default function ActivityExplorer() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [activities, setActivities] = useState<AnalysedActivity[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("summary");
  const [units, setUnits] = useState<UnitSystem>("metric");
  const [metric, setMetric] = useState<ChartMetricKey>("heart_rate");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem("pauls-running-fit-units");
    if (stored === "metric" || stored === "imperial") setUnits(stored);
  }, []);
  useEffect(() => { window.localStorage.setItem("pauls-running-fit-units", units); }, [units]);

  const activity = activities.find((candidate) => candidate.source.id === currentId) ?? activities[0] ?? null;

  async function ingest(files: FileList | File[]) {
    const fits = Array.from(files).filter((file) => file.name.toLowerCase().endsWith(".fit"));
    if (!fits.length) { setMessage("Choose one or more .fit files."); return; }
    setBusy(true);
    setMessage(null);
    const loaded: AnalysedActivity[] = [];
    const errors: string[] = [];
    for (const file of fits) {
      try { loaded.push(await loadBrowserFitFile(file)); }
      catch (error) { errors.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    if (loaded.length) {
      setActivities((existing) => {
        const byId = new Map(existing.map((item) => [item.source.id, item]));
        loaded.forEach((item) => byId.set(item.source.id, item));
        return [...loaded, ...[...byId.values()].filter((item) => !loaded.some((newItem) => newItem.source.id === item.source.id))];
      });
      setCurrentId(loaded[0].source.id);
      setTab("summary");
    }
    setMessage(errors.length ? errors.join(" · ") : `${loaded.length} FIT file${loaded.length === 1 ? "" : "s"} decoded locally.`);
    setBusy(false);
  }

  function removeActivity(id: string) {
    setActivities((existing) => {
      const next = existing.filter((candidate) => candidate.source.id !== id);
      if (currentId === id) setCurrentId(next[0]?.source.id ?? null);
      return next;
    });
  }

  function exportJson() {
    if (!activity) return;
    download(JSON.stringify(serialisable(activity.parsed), null, 2), "application/json;charset=utf-8", `${basename(activity.source.name)}-decoded.json`);
  }
  function exportCsv(kind: "records" | "laps") {
    if (!activity) return;
    const rows = kind === "records" ? activity.records : activity.laps;
    if (!rows.length) { setMessage(`This activity contains no ${kind}.`); return; }
    download(rowsToCsv(rows), "text/csv;charset=utf-8", `${basename(activity.source.name)}-${kind}.csv`);
  }

  return (
    <main className={styles.shell}>
      <aside className={styles.sidebar}>
        <Link href="/" className={styles.backLink}>← Paul&apos;s Running</Link>
        <div className={styles.brand}><div className={styles.brandMark}>FIT</div><div><h1>Activity Explorer</h1><p>Integrated analysis workspace</p></div></div>
        <input ref={inputRef} className={styles.hiddenInput} type="file" accept=".fit" multiple onChange={(event) => { if (event.target.files) void ingest(event.target.files); event.target.value = ""; }} />
        <button
          className={`${styles.dropZone} ${busy ? styles.busy : ""}`}
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => { event.preventDefault(); void ingest(event.dataTransfer.files); }}
        >
          <strong>{busy ? "Decoding…" : "Drop FIT files here"}</strong>
          <span>or click to browse · multiple files supported</span>
        </button>
        <div className={styles.sidebarTitle}><span>Loaded activities</span><strong>{activities.length}</strong></div>
        <div className={styles.fileList}>
          {!activities.length && <p className={styles.muted}>No FIT files loaded yet.</p>}
          {activities.map((candidate) => (
            <div key={candidate.source.id} className={`${styles.fileCard} ${candidate.source.id === activity?.source.id ? styles.fileActive : ""}`}>
              <button className={styles.fileSelect} onClick={() => { setCurrentId(candidate.source.id); setTab("summary"); }}>
                <strong>{candidate.source.name}</strong>
                <span>{formatDate(candidate.summary.start, false)} · {formatDistance(candidate.summary.distance, units)}</span>
              </button>
              <button className={styles.remove} aria-label={`Remove ${candidate.source.name}`} onClick={() => removeActivity(candidate.source.id)}>×</button>
            </div>
          ))}
        </div>
        <div className={styles.privacy}><strong>Local-first privacy</strong><span>Uploaded FIT files are decoded in this browser. They are not sent to Paul&apos;s Running or Vercel.</span></div>
      </aside>

      <section className={styles.workspace}>
        {!activity ? (
          <div className={styles.welcome}>
            <span className={styles.welcomeIcon}>⌁</span>
            <h2>Analyse a FIT activity</h2>
            <p>This integration preserves the FIT Explorer workflow: summary metrics, charts, route, laps, record messages, raw decoded data and exports.</p>
            <button onClick={() => inputRef.current?.click()}>Choose FIT files</button>
            <div className={styles.features}><span><strong>Private</strong>Browser-local decoding</span><span><strong>Reusable</strong>Same core for backend FIT data</span><span><strong>Complete</strong>Raw messages remain available</span></div>
          </div>
        ) : <>
          <header className={styles.header}>
            <div>
              <div className={styles.eyebrow}>{activity.source.origin === "browser" ? "LOCAL FIT FILE" : "BACKEND ACTIVITY"}</div>
              <h2>{activity.summary.session.sport_profile_name || titleCase(activity.summary.session.sub_sport || activity.summary.session.sport || "FIT activity")}</h2>
              <p>{formatDate(activity.summary.start)} · {formatDistance(activity.summary.distance, units)} · {formatDuration(activity.summary.timerTime)}</p>
              <small>{activity.source.name} · {activity.source.size ? `${(activity.source.size / 1024).toFixed(1)} KB · ` : ""}FIT protocol {formatCell(activity.parsed.protocolVersion)} · profile {formatCell(activity.parsed.profileVersion)}</small>
            </div>
            <div className={styles.headerControls}>
              <select value={units} onChange={(event) => setUnits(event.target.value as UnitSystem)}><option value="metric">Metric</option><option value="imperial">Imperial</option></select>
              <button onClick={exportJson}>Export JSON</button>
              <button onClick={() => exportCsv("records")}>Records CSV</button>
              <button onClick={() => exportCsv("laps")}>Laps CSV</button>
            </div>
          </header>

          {message && <div className={styles.notice}>{message}</div>}
          <nav className={styles.tabs}>{tabs.map(([key, label]) => <button key={key} className={tab === key ? styles.tabActive : ""} onClick={() => setTab(key)}>{label}</button>)}</nav>
          {tab === "summary" && <SummaryPanel activity={activity} units={units} />}
          {tab === "charts" && <ChartPanel activity={activity} units={units} metric={metric} setMetric={setMetric} />}
          {tab === "route" && <RoutePanel activity={activity} />}
          {tab === "laps" && <LapsPanel activity={activity} units={units} />}
          {tab === "records" && <RecordsPanel activity={activity} units={units} />}
          {tab === "data" && <DataPanel activity={activity} />}
        </>}
      </section>
    </main>
  );
}
