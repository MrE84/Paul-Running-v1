"use client";
import { useMemo, useState } from "react";
import { extractGroups, rowsToCsv, serialisable, unionKeys } from "../../lib/activity-analysis/core";
import type { DecodedFit } from "../../lib/activity-analysis/contracts";
import styles from "./analysis.module.css";

function download(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function cell(value: unknown) { return value == null ? "—" : typeof value === "object" ? JSON.stringify(serialisable(value)) : String(value); }

export default function RawData({ decoded, name }: { decoded: DecodedFit; name: string }) {
  const groups = useMemo(() => extractGroups(decoded), [decoded]);
  const [section, setSection] = useState("records");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [json, setJson] = useState(false);
  const group = groups.find(g => g.key === section) ?? groups[0];
  const keys = useMemo(() => unionKeys(group?.rows ?? []), [group]);
  const rows = useMemo(() => (group?.rows ?? []).filter(r => !query || cell(r).toLowerCase().includes(query.toLowerCase())), [group, query]);
  const pages = Math.max(1, Math.ceil(rows.length / 100)), current = Math.min(page, pages - 1);
  return <section className={styles.panel}>
    <div className={styles.panelHeading}><div><h3>Original decoded data</h3><p className={styles.quiet}>Complete FIT messages. Exports include unmasked locations.</p></div>
      <button onClick={() => download(JSON.stringify(serialisable(decoded), null, 2), `${name.replace(/\.fit$/i, "")}-decoded.json`, "application/json")}>Export complete JSON</button></div>
    <div className={styles.toolbar}><label>Section<select value={group?.key ?? ""} onChange={e => { setSection(e.target.value); setPage(0); setQuery(""); }}>{groups.map(g => <option key={g.key} value={g.key}>{g.key} ({g.count})</option>)}</select></label>
      <label>Search<input placeholder="Search fields and values" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} /></label>
      <button aria-pressed={json} onClick={() => setJson(v => !v)}>{json ? "Table view" : "JSON view"}</button>
      <button disabled={!group?.rows.length} onClick={() => download(rowsToCsv(group.rows), `${name}-${group.key}.csv`, "text/csv")}>Export section CSV</button></div>
    {json ? <pre className={styles.json}>{JSON.stringify(serialisable(rows.slice(current * 100, current * 100 + 100)), null, 2)}</pre> : <div className={styles.tableScroll}><table><thead><tr>{keys.map(k => <th key={k}>{k.replaceAll("_", " ")}</th>)}</tr></thead><tbody>{rows.slice(current * 100, current * 100 + 100).map((r, i) => <tr key={i}>{keys.map(k => <td key={k} title={cell(r[k])}>{cell(r[k]).slice(0, 180)}</td>)}</tr>)}</tbody></table></div>}
    <div className={styles.toolbar}><button disabled={current === 0} onClick={() => setPage(v => v - 1)}>Previous</button><span className={styles.quiet}>Page {current + 1} of {pages} · {rows.length.toLocaleString()} messages</span><button disabled={current >= pages - 1} onClick={() => setPage(v => v + 1)}>Next</button></div>
  </section>;
}
