"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Workout, WorkoutExecutionStep, WorkoutStep } from "../../../../lib/domain/contracts";
import type { CalculatedRange } from "../../../../lib/workouts/contracts";
import { summarizeWorkout } from "../../../../lib/workouts/summary";
import styles from "../../training-calendar.module.css";

const API_TOKEN_STORAGE_KEY = "pauls-running-api-token";

interface Props { workoutId: string; date?: string; time?: string; timezone?: string; status?: string }

function clock(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

function km(meters: number): string {
  return `${(meters / 1000).toFixed(meters % 1000 === 0 ? 0 : 2)} km`;
}

function rangeText(value: CalculatedRange | undefined, format: (n: number) => string, unknown: string): string {
  if (!value) return unknown;
  return value.exact ? format(value.min) : `${format(value.min)}–${format(value.max)}`;
}

function durationText(step: WorkoutExecutionStep): string {
  if (step.durationType === "open" || step.durationValue === undefined) return "Until lap press";
  if (step.durationType === "distance") return step.durationUnit === "meters" ? km(step.durationValue) : `${step.durationValue} ${step.durationUnit ?? ""}`;
  return step.durationUnit === "seconds" ? clock(step.durationValue) : `${step.durationValue} ${step.durationUnit ?? ""}`;
}

function targetText(step: WorkoutExecutionStep): string {
  const { targetType, targetLow: low, targetHigh: high, targetUnit: unit } = step;
  if (targetType === "none" || (low === undefined && high === undefined)) return "No target";
  const pair = (format: (n: number) => string) => low !== undefined && high !== undefined && low !== high ? `${format(low)}–${format(high)}` : format((low ?? high)!);
  switch (targetType) {
    case "heart_rate": return `${pair(String)} bpm`;
    case "pace": return unit === "sec_per_km" ? `${pair(clock)} /km` : `${pair(String)} ${unit ?? ""}`;
    case "cadence": return `${pair(String)} spm`;
    case "power": return `${pair(String)} W`;
  }
}

const TARGET_LABEL: Record<WorkoutExecutionStep["targetType"], string> = { none: "", heart_rate: "Heart rate", pace: "Pace", cadence: "Cadence", power: "Power" };

function StepRows({ steps, depth = 0 }: { steps: WorkoutStep[]; depth?: number }) {
  return <>{[...steps].sort((a, b) => a.sequence - b.sequence).map((step) => step.kind === "repeat"
    ? <div key={step.id} className={styles.stepRepeat} style={{ marginLeft: depth * 14 }}>
        <strong>Repeat {step.repeatCount}×{step.name ? ` · ${step.name}` : ""}</strong>
        {step.instruction && <p>{step.instruction}</p>}
        <StepRows steps={step.children} depth={depth + 1} />
      </div>
    : <div key={step.id} className={styles.stepRow} style={{ marginLeft: depth * 14 }}>
        <span className={styles.stepPhase}>{step.phase ?? "step"}</span>
        <div>
          <strong>{step.name ?? step.instruction ?? durationText(step)}</strong>
          {step.name && step.instruction && <p>{step.instruction}</p>}
        </div>
        <span><small>Duration</small>{durationText(step)}</span>
        <span><small>{TARGET_LABEL[step.targetType] || "Target"}</small>{targetText(step)}</span>
      </div>)}</>;
}

export default function PlannedWorkoutClient({ workoutId, date, time, timezone, status }: Props) {
  const [workout, setWorkout] = useState<Workout | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let token: string | null = null;
    try { token = window.localStorage.getItem(API_TOKEN_STORAGE_KEY); } catch { /* storage blocked */ }
    if (!token) { setError("Connect on the Training Calendar first so this page can load the protected plan."); return; }
    const controller = new AbortController();
    fetch(`/api/v1/workouts/${encodeURIComponent(workoutId)}`, {
      headers: { Authorization: `Bearer ${token.trim()}`, "X-Client-Id": "pauls-running-web-calendar", "X-Request-Id": crypto.randomUUID() },
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as { data?: Workout; error?: { message?: string } };
        if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? `HTTP ${response.status}`);
        setWorkout(payload.data);
      })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(`Could not load this planned workout: ${reason instanceof Error ? reason.message : String(reason)}`); });
    return () => controller.abort();
  }, [workoutId]);

  const revision = workout?.currentRevision;
  const summary = revision ? summarizeWorkout(revision) : null;
  const when = date ? new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }) : null;

  return (
    <main className={styles.page}>
      <div className={styles.topbar}>
        <Link href="/training-calendar" className={styles.back}>← Training Calendar</Link>
        <span className={styles.badge}>{(status ?? "planned").toUpperCase()} RUN</span>
      </div>

      <section className={styles.hero}>
        <span className={styles.sectionEyebrow}>PLANNED SESSION{when ? ` · ${when}${time ? ` at ${time}` : ""}` : ""}{timezone ? ` · ${timezone}` : ""}</span>
        <h1>{revision?.name ?? "Planned run"}</h1>
        {revision?.description && <p>{revision.description}</p>}
        {summary && <div className={styles.planStats}>
          <div><small>Distance</small><strong>{rangeText(summary.totalDistanceMeters, km, "Depends on pace")}</strong></div>
          <div><small>Duration</small><strong>{rangeText(summary.totalDurationSeconds, clock, "Depends on pace")}</strong></div>
          <div><small>Steps</small><strong>{summary.executionStepCount}</strong></div>
          <div><small>Sport</small><strong style={{ textTransform: "capitalize" }}>{revision!.sport}</strong></div>
        </div>}
      </section>

      <section className={styles.panel}>
        <h2>Workout steps</h2>
        {error ? <p className={styles.message}>{error}</p>
          : !revision ? <p className={styles.empty}>Loading the planned workout…</p>
          : revision.steps.length === 0 ? <p className={styles.empty}>This workout has no structured steps.</p>
          : <div className={styles.stepList}><StepRows steps={revision.steps} /></div>}
        {summary && summary.openStepCount > 0 && <p>Open steps run until you press lap, so totals exclude them.</p>}
      </section>
    </main>
  );
}
