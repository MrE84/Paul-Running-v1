"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatDistance, formatDuration, formatPace } from "../../lib/activity-analysis/core";
import type { ActivityListItem } from "../../lib/activity-analysis/projection";
import styles from "./activity-hub.module.css";

type ApiEnvelope<T> = { data?: T; error?: { message?: string } };
type ActivityImportResult = { imported: number; alreadyImported: number; failed: number };

function dateLabel(value: string | null): string {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Date unavailable" : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export default function ActivityHub() {
  const [token, setToken] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [activities, setActivities] = useState<ActivityListItem[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Checking your secure activity session…");

  useEffect(() => { void restoreSession(); }, []);

  async function restoreSession() {
    try {
      const response = await fetch("/api/analysis-session", { cache: "no-store" });
      const status = await response.json() as { authenticated?: boolean };
      if (status.authenticated) {
        setAuthenticated(true);
        await loadActivities(false);
      } else setMessage("Enter PAUL_RUNNING_API_TOKEN once to open your canonical Garmin library.");
    } catch { setMessage("Could not check the activity session."); }
  }

  async function establishSession() {
    if (!token.trim()) return;
    setBusy(true);
    try {
      const response = await fetch("/api/analysis-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim() }),
      });
      const body = await response.json().catch(() => ({})) as { authenticated?: boolean; error?: string };
      if (!response.ok || !body.authenticated) throw new Error(body.error ?? "Could not authenticate activity access.");
      setToken("");
      setAuthenticated(true);
      await loadActivities(true);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`/api/v1/${path}`, {
      ...init,
      headers: {
        "X-Client-Id": "activity-analysis-browser",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({})) as ApiEnvelope<T>;
    if (!response.ok || payload.data === undefined) throw new Error(payload.error?.message ?? `${response.status} ${response.statusText}`);
    return payload.data;
  }

  async function loadActivities(announce = true) {
    setBusy(true);
    try {
      const rows = await api<ActivityListItem[]>("activities?view=summary&limit=40");
      setActivities(rows);
      if (announce) setMessage(rows.length ? `${rows.length} recent activities ready. Raw FIT data has not been downloaded.` : "No canonical activities are stored yet.");
    } catch (error) {
      setAuthenticated(false);
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  }

  async function sync() {
    setBusy(true);
    try {
      const requestKey = typeof crypto !== "undefined" && "randomUUID" in crypto ? `activity-import-${crypto.randomUUID()}` : `activity-import-${Date.now()}`;
      const result = await api<ActivityImportResult>("activities/import", { method: "POST", headers: { "Idempotency-Key": requestKey }, body: JSON.stringify({ maxPages: 1 }) });
      const rows = await api<ActivityListItem[]>("activities?view=summary&limit=40");
      setActivities(rows);
      setMessage(`Sync complete: ${result.imported} new · ${result.alreadyImported} existing · ${result.failed} failed.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function signOut() {
    await fetch("/api/analysis-session", { method: "DELETE" }).catch(() => undefined);
    setAuthenticated(false); setActivities([]); setMessage("Activity session closed.");
  }

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return activities;
    return activities.filter(item => [item.title, item.sport, item.startedAt].filter(Boolean).some(value => String(value).toLowerCase().includes(needle)));
  }, [activities, query]);

  return <main className={styles.page}>
    <header className={styles.header}>
      <div><Link href="/" className={styles.back}>← Paul&apos;s Running</Link><span className={styles.eyebrow}>PREMIUM ACTIVITY INTELLIGENCE</span><h1>Activity Analysis</h1><p>Open a completed Garmin activity directly into synchronized physiology, route and lap analysis. The recent list is summary-only; full FIT data loads only when you explicitly open Raw Data.</p></div>
      <nav className={styles.headerActions} aria-label="Activity intelligence views">
        <Link className={styles.primaryAction} href="/activity-analysis/compare">Compare activities</Link>
        <Link className={styles.secondaryAction} href="/activity-analysis/trends">Performance trends</Link>
        <Link className={styles.secondaryAction} href="/activity-analysis/legacy">Open local FIT explorer</Link>
      </nav>
    </header>

    <section className={styles.authCard}>
      <div><strong>Canonical Garmin library</strong><span>{authenticated ? "Secure HTTP-only activity session active. The API token is not stored in browser JavaScript storage." : "Authenticate once for this activity-analysis session."}</span></div>
      <div className={styles.authControls}>
        {!authenticated ? <><input type="password" value={token} placeholder="PAUL_RUNNING_API_TOKEN" autoComplete="off" onChange={event => setToken(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void establishSession(); }} /><button disabled={busy || !token.trim()} onClick={() => void establishSession()}>{busy ? "Opening…" : "Open library"}</button></> : <><button disabled={busy} onClick={() => void loadActivities()}>{busy ? "Working…" : "Refresh"}</button><button disabled={busy} onClick={() => void sync()}>Sync latest</button><button disabled={busy} onClick={() => void signOut()}>Close session</button></>}
      </div>
      <small>{message}</small>
    </section>

    <section className={styles.library}>
      <div className={styles.libraryHeader}><div><h2>Recent activities</h2><p>Stable deep links; one click opens the analysis projection.</p></div><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search activity, sport or date" /></div>
      {!filtered.length ? <div className={styles.empty}>{authenticated ? "No matching recent activities." : "Open the canonical library, or use the local FIT explorer without signing in."}</div> : <div className={styles.grid}>{filtered.map(item => {
        const speed = item.distance !== null && item.duration ? item.distance / item.duration : null;
        return <Link key={item.id} href={`/activity-analysis/${encodeURIComponent(item.id)}`} className={styles.activityCard}>
          <div className={styles.activityTop}><div><span>{dateLabel(item.startedAt)}</span><h3>{item.title}</h3></div><span className={styles.open}>Open →</span></div>
          <div className={styles.metrics}><span><small>Distance</small><strong>{formatDistance(item.distance, "metric")}</strong></span><span><small>Time</small><strong>{formatDuration(item.duration)}</strong></span><span><small>Avg pace</small><strong>{formatPace(speed, "metric")}</strong></span><span><small>Sport</small><strong>{item.sport.replaceAll("_", " ")}</strong></span></div>
        </Link>;
      })}</div>}
    </section>
  </main>;
}
