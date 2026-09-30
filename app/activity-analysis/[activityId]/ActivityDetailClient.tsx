"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import ActivityWorkspace from "../ActivityWorkspace";
import DebriefPanel from "./DebriefPanel";
import type { AnalysisProjection, ActivityListItem } from "../../../lib/activity-analysis/projection";
import type { DecodedFit, UnitSystem } from "../../../lib/activity-analysis/contracts";
import styles from "./activity-detail.module.css";

type ApiEnvelope<T> = { data?: T; error?: { message?: string } };

const API_TOKEN_STORAGE_KEY = "pauls-running-api-token";

class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** Activity pages authenticate with a 12-hour cookie created from the API token. */
async function establishSession(token: string): Promise<boolean> {
  try {
    const response = await fetch("/api/analysis-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token.trim() }),
    });
    return response.ok;
  } catch { return false; }
}

function storedToken(): string | null {
  try { return window.localStorage.getItem(API_TOKEN_STORAGE_KEY); } catch { return null; }
}

async function api<T>(path: string): Promise<T> {
  const response = await fetch(`/api/v1/${path}`, {
    cache: "no-store",
    headers: { "X-Client-Id": "activity-analysis-detail" },
  });
  const payload = await response.json().catch(() => ({})) as ApiEnvelope<T>;
  if (!response.ok || payload.data === undefined) throw new ApiError(payload.error?.message ?? `${response.status} ${response.statusText}`, response.status);
  return payload.data;
}

export default function ActivityDetailClient({ activityId }: { activityId: string }) {
  const [projection, setProjection] = useState<AnalysisProjection | null>(null);
  const [recent, setRecent] = useState<ActivityListItem[]>([]);
  const [units, setUnits] = useState<UnitSystem>("metric");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [needsToken, setNeedsToken] = useState(false);
  const [tokenInput, setTokenInput] = useState("");

  const fetchAll = useCallback(() => Promise.all([
    api<AnalysisProjection>(`activities/${encodeURIComponent(activityId)}/analysis`),
    api<ActivityListItem[]>("activities?view=summary&limit=40"),
  ]), [activityId]);

  const load = useCallback(async (suppliedToken?: string) => {
    setLoading(true); setError(""); setNeedsToken(false);
    try {
      let result;
      try {
        if (suppliedToken && !(await establishSession(suppliedToken))) throw new ApiError("The access token is not valid.", 401);
        result = await fetchAll();
      } catch (value) {
        // Expired or missing session cookie: re-create it from the saved token and retry once.
        if (!(value instanceof ApiError) || value.status !== 401) throw value;
        const saved = suppliedToken ? null : storedToken();
        if (saved && await establishSession(saved)) result = await fetchAll();
        else throw value;
      }
      if (suppliedToken) {
        try { window.localStorage.setItem(API_TOKEN_STORAGE_KEY, suppliedToken.trim()); } catch { /* storage blocked */ }
      }
      setProjection(result[0]); setRecent(result[1]);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
      setNeedsToken(value instanceof ApiError && value.status === 401);
    }
    finally { setLoading(false); }
  }, [fetchAll]);

  useEffect(() => { void load(); }, [load]);

  const index = useMemo(() => recent.findIndex(item => item.id === activityId), [recent, activityId]);
  const previous = index >= 0 ? recent[index + 1] : undefined;
  const next = index > 0 ? recent[index - 1] : undefined;
  const loadRaw = useCallback(() => api<DecodedFit>(`activities/${encodeURIComponent(activityId)}/raw`), [activityId]);
  const loadWeather = useCallback(async () => {
    const enriched = await api<AnalysisProjection>(`activities/${encodeURIComponent(activityId)}/weather`);
    setProjection(enriched);
    return enriched;
  }, [activityId]);

  if (loading) return <main className={styles.state}><Link href="/activity-analysis">← Activity Analysis</Link><strong>Building activity workspace…</strong><span>The server is loading the versioned projection; raw FIT messages remain lazy.</span></main>;
  if (needsToken) return <main className={styles.state}>
    <Link href="/activity-analysis">← Activity Analysis</Link>
    <strong>Sign in to view this activity</strong>
    <span>Enter PAUL_RUNNING_API_TOKEN once on this device. It is saved in this browser so you will not be asked again.</span>
    <form onSubmit={event => { event.preventDefault(); if (tokenInput.trim()) void load(tokenInput); }} style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
      <input type="password" value={tokenInput} onChange={event => setTokenInput(event.target.value)} placeholder="PAUL_RUNNING_API_TOKEN" autoComplete="off" spellCheck={false} style={{ background: "#071522", border: "1px solid #315577", color: "#fff", borderRadius: 9, padding: "9px 12px", minWidth: 260 }} />
      <button type="submit" disabled={!tokenInput.trim()}>Sign in</button>
    </form>
  </main>;
  if (error || !projection) return <main className={styles.state}><Link href="/activity-analysis">← Activity Analysis</Link><strong>{error || "Activity unavailable"}</strong><button onClick={() => void load()}>Retry</button></main>;

  return <main className={styles.page}>
    <header className={styles.topbar}>
      <div className={styles.breadcrumb}><Link href="/">Paul&apos;s Running</Link><span>/</span><Link href="/activity-analysis">Activity Analysis</Link><span>/</span><strong>{projection.activity.title}</strong></div>
      <div className={styles.actions}>
        {previous ? <Link href={`/activity-analysis/${encodeURIComponent(previous.id)}`}>← Older</Link> : <span className={styles.disabled}>← Older</span>}
        <label>Units<select value={units} onChange={event => setUnits(event.target.value as UnitSystem)}><option value="metric">Metric</option><option value="imperial">Imperial</option></select></label>
        {next ? <Link href={`/activity-analysis/${encodeURIComponent(next.id)}`}>Newer →</Link> : <span className={styles.disabled}>Newer →</span>}
      </div>
    </header>
    <section className={styles.workspace}><DebriefPanel activityId={activityId} /><ActivityWorkspace projection={projection} units={units} loadRaw={loadRaw} loadWeather={loadWeather} /></section>
  </main>;
}
