"use client";

import { useState } from "react";
import Link from "next/link";
import {
  POST_HALF_RECOVERY_2026,
  POST_HALF_RECOVERY_START_DATE,
} from "../../lib/workouts/post-half-recovery";
import styles from "../training-calendar/training-calendar.module.css";

type ApiEnvelope<T> = { data: T };
type ApiErrorEnvelope = { error?: { code?: string; message?: string; details?: unknown } };

type Capabilities = {
  primaryAthleteId: string;
  storageMode: string;
  integrations: { intervalsIcuPublishingConfigured: boolean };
};

type Workout = { id: string; currentVersion: number; currentRevision: { name: string } };
type WorkoutCreate = { workout: Workout };
type TrainingPlan = { id: string; currentVersion: number };
type CalendarItem = {
  id: string;
  scheduledLocalDate: string;
  scheduledLocalTime: string;
};
type PlanApplication = { calendarItems: CalendarItem[] };
type PublishResult = {
  eligible: boolean;
  attempted: boolean;
  deliveryState: string;
  reason?: string;
  externalId?: string;
};

const APPROVAL_OPENS_AT = Date.parse("2026-09-20T11:00:00+01:00");

function errorText(value: unknown): string {
  if (value instanceof Error) return value.message;
  return String(value);
}

export default function RecoveryWeekClient() {
  const [token, setToken] = useState("");
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    "Review the recovery week now. Approval opens after the Cheltenham Half Marathon on Sunday 20 September.",
  );

  async function api<T>(path: string, init: RequestInit = {}, idempotencyKey?: string): Promise<T> {
    if (!token.trim()) throw new Error("Enter the production API token first.");
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token.trim()}`);
    headers.set("X-Client-Id", "pauls-running-recovery-week");
    headers.set("X-Request-Id", crypto.randomUUID());
    if (init.body) headers.set("Content-Type", "application/json");
    if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);

    const response = await fetch(`/api/v1/${path}`, { ...init, headers, cache: "no-store" });
    const payload = (await response.json().catch(() => ({}))) as ApiEnvelope<T> & ApiErrorEnvelope;
    if (!response.ok) {
      const code = payload.error?.code ? `${payload.error.code}: ` : "";
      throw new Error(`${code}${payload.error?.message ?? `HTTP ${response.status}`}`);
    }
    return payload.data;
  }

  async function connect() {
    setBusy(true);
    try {
      const found = await api<Capabilities>("capabilities");
      setCapabilities(found);
      setMessage(
        found.integrations.intervalsIcuPublishingConfigured
          ? "Connected. The recovery plan can be approved after the race and sent through the Garmin delivery pipeline."
          : "Connected to Paul’s Running, but Garmin delivery is not configured because the Intervals.icu transport key is missing.",
      );
    } catch (error) {
      setCapabilities(null);
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function approveAndSyncRecoveryWeek() {
    if (Date.now() < APPROVAL_OPENS_AT) {
      setMessage("Recovery-week approval is locked until after the half marathon. Finish the race first, then come back here and approve the week.");
      return;
    }
    if (!capabilities?.integrations.intervalsIcuPublishingConfigured) {
      setMessage("Garmin delivery is not configured. Connect first and confirm the Intervals.icu transport shows ready.");
      return;
    }

    setBusy(true);
    try {
      const existingWorkouts = await api<Workout[]>("workouts");
      const created: Record<string, WorkoutCreate> = {};

      for (const definition of POST_HALF_RECOVERY_2026) {
        const existingWorkout = existingWorkouts.find(
          (workout) => workout.currentRevision.name === definition.name,
        );
        created[definition.key] = existingWorkout
          ? { workout: existingWorkout }
          : await api<WorkoutCreate>(
              "workouts",
              {
                method: "POST",
                body: JSON.stringify({
                  name: definition.name,
                  description: definition.description,
                  sport: definition.sport,
                  steps: definition.steps,
                }),
              },
              `post-half-recovery-2026-${definition.key}-workout-v1`,
            );
      }

      const plan = await api<TrainingPlan>(
        "training-plans",
        {
          method: "POST",
          body: JSON.stringify({
            name: "Cheltenham Half - Recovery Week v1",
            description:
              "Recovery-first week after the Cheltenham Half Marathon. Tue/Thu/Sat are deliberately free of structured training. No threshold, strides, hill work, hard parkrun or leg-strength session.",
            items: POST_HALF_RECOVERY_2026.map((definition, sequence) => ({
              id: `post-half-recovery-2026-${definition.key}`,
              sequence,
              dayOffset: definition.dayOffset,
              localStartTime: definition.localStartTime,
              workoutId: created[definition.key].workout.id,
              workoutVersion: created[definition.key].workout.currentVersion,
            })),
          }),
        },
        "post-half-recovery-2026-plan-v1",
      );

      const application = await api<PlanApplication>(
        `training-plans/${plan.id}/apply`,
        {
          method: "POST",
          body: JSON.stringify({
            planVersion: plan.currentVersion,
            startDate: POST_HALF_RECOVERY_START_DATE,
            timezone: "Europe/London",
          }),
        },
        "post-half-recovery-2026-apply-v1",
      );

      const results: string[] = [];
      for (const item of application.calendarItems) {
        try {
          const result = await api<PublishResult>(
            `calendar-items/${item.id}/publish`,
            { method: "POST" },
            `post-half-recovery-2026-publish-${item.id}-v1`,
          );
          results.push(
            `${item.scheduledLocalDate} ${item.scheduledLocalTime}: ${result.deliveryState}${
              result.externalId ? ` · ${result.externalId}` : result.reason ? ` · ${result.reason}` : ""
            }`,
          );
        } catch (error) {
          results.push(`${item.scheduledLocalDate}: ${errorText(error)}`);
        }
      }

      setMessage(
        `Recovery week approved in Paul’s Running. ${results.join(" · ")} Open Garmin Connect, sync the Fenix 5, then confirm the workouts appear on the watch.`,
      );
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.topbar}>
        <Link href="/training-calendar" className={styles.back}>← Training Calendar</Link>
        <span className={styles.badge}>POST-RACE RECOVERY</span>
      </div>

      <section className={styles.hero}>
        <h1>Cheltenham Half Recovery Week</h1>
        <p>Monday 21 September to Sunday 27 September 2026. Review now; approve and send after the race.</p>
      </section>

      <section className={styles.panel}>
        <h2>Recovery plan</h2>
        <div className={styles.calendarList}>
          {POST_HALF_RECOVERY_2026.map((item) => (
            <article className={styles.calendarItem} key={item.key}>
              <div className={styles.dateBlock}>
                <strong>Day +{item.dayOffset}</strong>
                <span>{item.localStartTime} · Europe/London</span>
              </div>
              <div className={styles.workoutBlock}>
                <strong>{item.name}</strong>
                <span>{item.description}</span>
              </div>
            </article>
          ))}
        </div>
        <p>Tuesday, Thursday and Saturday: rest or gentle walking only. Saturday parkrun is not a race this week.</p>
      </section>

      <section className={styles.panel}>
        <h2>Approve &amp; send to Garmin</h2>
        <p>Your approval is the button press here. Paul’s Running creates the canonical plan, applies it to the week beginning 21 September, runs workout QA, then sends eligible workouts through the existing delivery bridge to Garmin Connect.</p>
        <div className={styles.inline}>
          <input
            className={styles.input}
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="PAUL_RUNNING_API_TOKEN"
            autoComplete="off"
            spellCheck={false}
          />
          <button className={styles.secondary} onClick={connect} disabled={busy || !token.trim()}>
            Connect
          </button>
          <button
            className={styles.primary}
            onClick={approveAndSyncRecoveryWeek}
            disabled={busy || !capabilities || Date.now() < APPROVAL_OPENS_AT}
          >
            {busy ? "Working…" : "Approve & sync recovery week"}
          </button>
        </div>
        <p className={styles.message}>{message}</p>
        {capabilities && (
          <div className={styles.statusRow}>
            <span>Storage: <strong>{capabilities.storageMode}</strong></span>
            <span>Garmin transport: <strong>{capabilities.integrations.intervalsIcuPublishingConfigured ? "ready" : "not configured"}</strong></span>
          </div>
        )}
      </section>
    </main>
  );
}
