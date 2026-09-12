"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { analyseDecodedFit, formatDistance, formatDuration, formatPace, normaliseDate } from "../../lib/activity-analysis";
import styles from "./activity-hub.module.css";

type StoredActivity = {
  id: string;
  startedAt: string;
  normalizedData: Record<string, unknown>;
  sourceFileName?: string;
  sourceMetadata: Record<string, unknown>;
};

type ApiEnvelope<T> = { data: T; error?: { message?: string } };

type ActivityImportResult = {
  imported: number;
  alreadyImported: number;
  failed: number;
};

function sourceFor(item: StoredActivity) {
  const externalId = typeof item.sourceMetadata.externalId === "string" ? item.sourceMetadata.externalId : undefined;
  return {
    id: item.id,
    name: item.sourceFileName ?? `${externalId ?? item.id}.fit`,
    origin: "backend" as const,
    externalId,
  };
}

function activityTitle(item: StoredActivity): string {
  const analysed = analyseDecodedFit(sourceFor(item), item.normalizedData);
  const session = analysed.summary.session;
  const raw = session.sport_profile_name ?? session.sub_sport ?? session.sport ?? "Activity";
  return String(raw).replaceAll("_", " ").replace(/\b\w/g, (value) => value.toUpperCase());
}

export default function ActivityHub() {
  const [token, setToken] = useState("");
  const [activities, setActivities] = useState<StoredActivity[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Enter your Paul’s Running API token to load canonical Garmin activities.");

  useEffect(() => {
    const saved = window.sessionStorage.getItem("pauls-running-api-token") ?? "";
    if (saved) {
      setToken(saved);
      void load(saved, false);
    }
  }, []);

  async function api<T>(path: string, activeToken = token, init: RequestInit = {}): Promise<T> {
    if (!activeToken.trim()) throw new Error("Enter PAUL_RUNNING_API_TOKEN first.");
    const response = await fetch(`/api/v1/${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${activeToken.trim()}`,
        "X-Client-Id": "activity-analysis-hub",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    });
    const payload = await response.json().catch(() => ({})) as ApiEnvelope<T>;
    if (!response.ok) throw new Error(payload.error?.message ?? `${response.status} ${response.statusText}`);
    return payload.data;
  }

  async function load(activeToken = token, announce = true) {
    setBusy(true);
    try {
      window.sessionStorage.setItem("pauls-running-api-token", activeToken.trim());
      const rows = await api<StoredActivity[]>("activities?limit=30", activeToken);
      setActivities(rows);
      if (announce) setMessage(rows.length ? `${rows.length} canonical activities loaded.` : "No canonical activities are stored yet.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function sync() {
    setBusy(true);
    try {
      const requestKey = typeof crypto !== "undefined" && "randomUUID" in crypto
        ? `activity-import-${crypto.randomUUID()}`
        : `activity-import-${Date.now()}`;
      const result = await api<ActivityImportResult>("activities/import", token, {
        method: "POST",
        headers: { "Idempotency-Key": requestKey },
        body: JSON.stringify({ maxPages: 1 }),
      });
      const rows = await api<StoredActivity[]>("activities?limit=30");
      setActivities(rows);
      window.sessionStorage.setItem("pauls-running-api-token", token.trim());
      setMessage(`Sync complete: ${result.imported} new · ${result.alreadyImported} existing · ${result.failed} failed.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return activities;
    return activities.filter((item) => {
      const analysed = analyseDecodedFit(sourceFor(item), item.normalizedData);
      return [activityTitle(item), item.startedAt, item.sourceFileName, analysed.summary.session.sub_sport, analysed.summary.session.sport]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [activities, query]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <Link href="/" className={styles.back}>← Paul&apos;s Running</Link>
          <span className={styles.eyebrow}>PREMIUM ACTIVITY INTELLIGENCE</span>
          <h1>Activity Analysis</h1>
          <p>Open a completed Garmin activity directly, inspect synchronized physiology and route data, or use a private local FIT file when you do not want to persist anything.</p>
        </div>
        <Link className={styles.secondaryAction} href="/activity-analysis/legacy">Open local FIT explorer</Link>
      </header>

      <section className={styles.authCard}>
        <div>
          <strong>Canonical Garmin library</strong>
          <span>Token stays in this browser tab/session and is reused when you open an activity detail URL.</span>
        </div>
        <div className={styles.authControls}>
          <input
            type="password"
            value={token}
            placeholder="PAUL_RUNNING_API_TOKEN"
            autoComplete="off"
            onChange={(event) => setToken(event.target.value)}
          />
          <button disabled={busy || !token.trim()} onClick={() => void load()}>{busy ? "Working…" : "Load stored"}</button>
          <button disabled={busy || !token.trim()} onClick={() => void sync()}>Sync latest</button>
        </div>
        <small>{message}</small>
      </section>

      <section className={styles.library}>
        <div className={styles.libraryHeader}>
          <div><h2>Recent activities</h2><p>Deep-linked analysis opens in one click.</p></div>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search sport, date or filename" />
        </div>

        {!filtered.length ? (
          <div className={styles.empty}>Load stored activities to populate the premium workspace. Local FIT analysis remains available without an API token.</div>
        ) : (
          <div className={styles.grid}>
            {filtered.map((item) => {
              const analysed = analyseDecodedFit(sourceFor(item), item.normalizedData);
              const date = normaliseDate(analysed.summary.start ?? item.startedAt);
              return (
                <Link key={item.id} href={`/activity-analysis/${encodeURIComponent(item.id)}`} className={styles.activityCard}>
                  <div className={styles.activityTop}>
                    <div><span>{date ? date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "Activity"}</span><h3>{activityTitle(item)}</h3></div>
                    <span className={styles.open}>Open →</span>
                  </div>
                  <div className={styles.metrics}>
                    <span><small>Distance</small><strong>{formatDistance(analysed.summary.distance, "metric")}</strong></span>
                    <span><small>Time</small><strong>{formatDuration(analysed.summary.timerTime)}</strong></span>
                    <span><small>Avg pace</small><strong>{formatPace(analysed.summary.avgSpeed, "metric")}</strong></span>
                    <span><small>Avg HR</small><strong>{analysed.summary.session.avg_heart_rate ? `${analysed.summary.session.avg_heart_rate} bpm` : "—"}</strong></span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
