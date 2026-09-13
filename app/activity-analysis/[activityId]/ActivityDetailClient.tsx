"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import ActivityWorkspace from "../ActivityWorkspace";
import type { AnalysisProjection, ActivityListItem } from "../../../lib/activity-analysis/projection";
import type { DecodedFit, UnitSystem } from "../../../lib/activity-analysis/contracts";
import styles from "./activity-detail.module.css";

type ApiEnvelope<T> = { data?: T; error?: { message?: string } };

async function api<T>(path: string): Promise<T> {
  const response = await fetch(`/api/v1/${path}`, {
    cache: "no-store",
    headers: { "X-Client-Id": "activity-analysis-detail" },
  });
  const payload = await response.json().catch(() => ({})) as ApiEnvelope<T>;
  if (!response.ok || payload.data === undefined) throw new Error(payload.error?.message ?? `${response.status} ${response.statusText}`);
  return payload.data;
}

export default function ActivityDetailClient({ activityId }: { activityId: string }) {
  const [projection, setProjection] = useState<AnalysisProjection | null>(null);
  const [recent, setRecent] = useState<ActivityListItem[]>([]);
  const [units, setUnits] = useState<UnitSystem>("metric");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [analysis, list] = await Promise.all([
        api<AnalysisProjection>(`activities/${encodeURIComponent(activityId)}/analysis`),
        api<ActivityListItem[]>("activities?view=summary&limit=40"),
      ]);
      setProjection(analysis); setRecent(list);
    } catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { setLoading(false); }
  }, [activityId]);

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
  if (error || !projection) return <main className={styles.state}><Link href="/activity-analysis">← Activity Analysis</Link><strong>{error || "Activity unavailable"}</strong><span>Your secure activity session may have expired. Return to Activity Analysis and open the library again.</span><button onClick={() => void load()}>Retry</button></main>;

  return <main className={styles.page}>
    <header className={styles.topbar}>
      <div className={styles.breadcrumb}><Link href="/">Paul&apos;s Running</Link><span>/</span><Link href="/activity-analysis">Activity Analysis</Link><span>/</span><strong>{projection.activity.title}</strong></div>
      <div className={styles.actions}>
        {previous ? <Link href={`/activity-analysis/${encodeURIComponent(previous.id)}`}>← Older</Link> : <span className={styles.disabled}>← Older</span>}
        <label>Units<select value={units} onChange={event => setUnits(event.target.value as UnitSystem)}><option value="metric">Metric</option><option value="imperial">Imperial</option></select></label>
        {next ? <Link href={`/activity-analysis/${encodeURIComponent(next.id)}`}>Newer →</Link> : <span className={styles.disabled}>Newer →</span>}
      </div>
    </header>
    <section className={styles.workspace}><ActivityWorkspace projection={projection} units={units} loadRaw={loadRaw} loadWeather={loadWeather} /></section>
  </main>;
}
