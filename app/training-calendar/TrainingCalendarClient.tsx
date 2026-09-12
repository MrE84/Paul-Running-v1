"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { advancedLunchWalkSteps, RACE_WEEK_2026 } from "../../lib/workouts/race-week";
import { classifyRaceWeekCalendar } from "../../lib/workouts/race-week-reconcile";
import styles from "./training-calendar.module.css";

type ApiEnvelope<T> = { data: T };
type ApiErrorEnvelope = { error?: { code?: string; message?: string; details?: unknown } };

type Capabilities = {
  primaryAthleteId: string;
  storageMode: string;
  integrations: { intervalsIcuPublishingConfigured: boolean };
};

type Workout = { id: string; currentVersion: number; currentRevision: { name: string } };
type CalendarItem = {
  id: string;
  scheduledStart: string;
  scheduledLocalDate: string;
  scheduledLocalTime: string;
  timezone: string;
  status: string;
  createdAt?: string;
  workout: { id: string; version: number };
};
type SyncStatus = {
  state: "planned" | "queued" | "sent" | "failed";
  externalReference?: { externalId?: string };
  latestJob?: { lastErrorMessage?: string };
};
type WorkoutCreate = { workout: Workout };
type TrainingPlan = { id: string; currentVersion: number };
type PlanApplication = { calendarItems: CalendarItem[] };
type PublishResult = {
  eligible: boolean;
  attempted: boolean;
  deliveryState: string;
  reason?: string;
  externalId?: string;
};

type CalendarSnapshot = {
  items: CalendarItem[];
  workoutList: Workout[];
  workoutMap: Record<string, Workout>;
};

const RACE_WEEK_START_DATE = "2026-09-14";

function errorText(value: unknown): string {
  if (value instanceof Error) return value.message;
  return String(value);
}

export default function TrainingCalendarClient() {
  const [token, setToken] = useState("");
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [calendar, setCalendar] = useState<CalendarItem[]>([]);
  const [workouts, setWorkouts] = useState<Record<string, Workout>>({});
  const [sync, setSync] = useState<Record<string, SyncStatus>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Enter the production API token to load protected training data.");
  const [lunchDate, setLunchDate] = useState("");
  const [lunchTime, setLunchTime] = useState("");

  async function api<T>(path: string, init: RequestInit = {}, idempotencyKey?: string): Promise<T> {
    if (!token.trim()) throw new Error("Enter the production API token first.");
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token.trim()}`);
    headers.set("X-Client-Id", "pauls-running-web-calendar");
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

  async function loadCalendarSnapshot(): Promise<CalendarSnapshot> {
    const now = new Date();
    const from = new Date(now.getTime() - 2 * 86400000).toISOString();
    const to = new Date(now.getTime() + 45 * 86400000).toISOString();
    const [items, workoutList] = await Promise.all([
      api<CalendarItem[]>(`calendar-items?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
      api<Workout[]>("workouts"),
    ]);
    return {
      items,
      workoutList,
      workoutMap: Object.fromEntries(workoutList.map((workout) => [workout.id, workout])),
    };
  }

  async function refreshCalendar(): Promise<CalendarSnapshot> {
    const snapshot = await loadCalendarSnapshot();
    setWorkouts(snapshot.workoutMap);
    setCalendar(snapshot.items);

    const visibleItems = snapshot.items.filter((item) => item.status !== "superseded");
    const statuses = await Promise.all(
      visibleItems.map(async (item) => {
        try {
          return [item.id, await api<SyncStatus>(`calendar-items/${item.id}/sync-status`)] as const;
        } catch {
          return [item.id, { state: "planned" as const }] as const;
        }
      }),
    );
    setSync(Object.fromEntries(statuses));
    return snapshot;
  }

  async function connect() {
    setBusy(true);
    try {
      const found = await api<Capabilities>("capabilities");
      setCapabilities(found);
      await refreshCalendar();
      setMessage(
        found.integrations.intervalsIcuPublishingConfigured
          ? "Connected. PostgreSQL and Intervals.icu publishing are available."
          : "Connected to Paul’s Running. Intervals.icu publishing is not configured: add INTERVALS_ICU_API_KEY to Vercel Production, then redeploy once.",
      );
    } catch (error) {
      setCapabilities(null);
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function populateRaceWeek() {
    setBusy(true);
    try {
      const snapshot = await loadCalendarSnapshot();
      const reconciliation = classifyRaceWeekCalendar(
        RACE_WEEK_2026,
        RACE_WEEK_START_DATE,
        snapshot.items,
        snapshot.workoutList,
      );

      let supersededCount = 0;
      for (const duplicate of reconciliation.duplicates) {
        await api<CalendarItem>(
          `calendar-items/${duplicate.id}/supersede`,
          { method: "POST" },
          `race-week-2026-supersede-${duplicate.id}-v1`,
        );
        supersededCount += 1;
      }

      const keeperIds = new Set(
        Object.values(reconciliation.keepers)
          .map((item) => item?.id)
          .filter((id): id is string => Boolean(id)),
      );
      const canonicalItems = snapshot.items.filter((item) => keeperIds.has(item.id));

      if (reconciliation.missing.length > 0) {
        const created: Record<string, WorkoutCreate> = {};
        for (const definition of reconciliation.missing) {
          const existingWorkout = snapshot.workoutList.find(
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
                `race-week-2026-${definition.key}-workout-v1`,
              );
        }

        const repairKey = reconciliation.missing.map((definition) => definition.key).sort().join("--");
        const plan = await api<TrainingPlan>(
          "training-plans",
          {
            method: "POST",
            body: JSON.stringify({
              name: `Cheltenham Half - Race Week Repair ${repairKey}`,
              description:
                "Idempotent repair of missing authoritative race-week sessions. Existing canonical sessions are retained and Wednesday remains deliberately omitted.",
              items: reconciliation.missing.map((definition, sequence) => ({
                id: `race-week-2026-repair-${definition.key}`,
                sequence,
                dayOffset: definition.dayOffset,
                localStartTime: definition.localStartTime,
                workoutId: created[definition.key].workout.id,
                workoutVersion: created[definition.key].workout.currentVersion,
              })),
            }),
          },
          `race-week-2026-repair-${repairKey}-plan-v2`,
        );

        const application = await api<PlanApplication>(
          `training-plans/${plan.id}/apply`,
          {
            method: "POST",
            body: JSON.stringify({
              planVersion: plan.currentVersion,
              startDate: RACE_WEEK_START_DATE,
              timezone: "Europe/London",
            }),
          },
          `race-week-2026-repair-${repairKey}-apply-v2`,
        );
        canonicalItems.push(...application.calendarItems);
      }

      const uniqueCanonicalItems = [...new Map(canonicalItems.map((item) => [item.id, item])).values()];
      const publishResults: string[] = [];
      if (!capabilities?.integrations.intervalsIcuPublishingConfigured) {
        publishResults.push("Intervals.icu not configured; Garmin delivery was not attempted.");
      } else {
        for (const item of uniqueCanonicalItems) {
          try {
            const result = await api<PublishResult>(
              `calendar-items/${item.id}/publish`,
              { method: "POST" },
              `race-week-2026-publish-${item.id}-v1`,
            );
            publishResults.push(`${item.scheduledLocalDate}: ${result.deliveryState}${result.eligible ? "" : " (outside current delivery window)"}`);
          } catch (error) {
            publishResults.push(`${item.scheduledLocalDate}: ${errorText(error)}`);
          }
        }
      }

      await refreshCalendar();
      const cleanupText = supersededCount > 0
        ? ` Superseded ${supersededCount} duplicate calendar ${supersededCount === 1 ? "record" : "records"}.`
        : " No duplicate calendar records found.";
      setMessage(`Race week is canonical in Paul’s Running.${cleanupText} ${publishResults.join(" · ")}`);
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function publishItem(itemId: string) {
    if (!capabilities?.integrations.intervalsIcuPublishingConfigured) {
      setMessage("Intervals.icu publishing is not configured. Add INTERVALS_ICU_API_KEY to Vercel Production before evaluating Garmin delivery.");
      return;
    }
    setBusy(true);
    try {
      const result = await api<PublishResult>(
        `calendar-items/${itemId}/publish`,
        { method: "POST" },
        `web-publish-${itemId}`,
      );
      await refreshCalendar();
      setMessage(
        result.eligible
          ? `Publish evaluated: ${result.deliveryState}${result.externalId ? ` · external ${result.externalId}` : ""}.`
          : `Not sent yet: ${result.reason ?? "outside the current Garmin delivery window"}.`,
      );
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function createLunchWalk() {
    if (!capabilities?.integrations.intervalsIcuPublishingConfigured) {
      setMessage("Configure INTERVALS_ICU_API_KEY in Vercel Production before creating the live lunch-walk delivery test.");
      return;
    }
    if (!lunchDate || !lunchTime) {
      setMessage("Choose a future date and time for the lunch-walk test.");
      return;
    }
    const localCandidate = new Date(`${lunchDate}T${lunchTime}:00`);
    if (!Number.isFinite(localCandidate.getTime()) || localCandidate.getTime() <= Date.now() + 60000) {
      setMessage("The lunch-walk test must be scheduled in the future. The original 15:00 slot has already passed.");
      return;
    }

    setBusy(true);
    try {
      const scheduleKey = `${lunchDate}-${lunchTime.replace(":", "")}`;
      const created = await api<WorkoutCreate>(
        "workouts",
        {
          method: "POST",
          body: JSON.stringify({
            name: "Advanced Lunch Break Walk",
            description: "Known-good Garmin validation workout: five automatic two-minute walking steps, ten minutes total.",
            sport: "walking",
            steps: advancedLunchWalkSteps(),
          }),
        },
        `advanced-lunch-walk-${scheduleKey}-workout`,
      );
      const plan = await api<TrainingPlan>(
        "training-plans",
        {
          method: "POST",
          body: JSON.stringify({
            name: `Advanced Lunch Walk ${lunchDate} ${lunchTime}`,
            description: "One-item live delivery validation plan.",
            items: [
              {
                id: `advanced-lunch-walk-${scheduleKey}-item`,
                sequence: 0,
                dayOffset: 0,
                localStartTime: lunchTime,
                workoutId: created.workout.id,
                workoutVersion: created.workout.currentVersion,
              },
            ],
          }),
        },
        `advanced-lunch-walk-${scheduleKey}-plan`,
      );
      const application = await api<PlanApplication>(
        `training-plans/${plan.id}/apply`,
        {
          method: "POST",
          body: JSON.stringify({ planVersion: plan.currentVersion, startDate: lunchDate, timezone: "Europe/London" }),
        },
        `advanced-lunch-walk-${scheduleKey}-apply`,
      );
      const item = application.calendarItems[0];
      if (!item) throw new Error("The lunch-walk plan did not create a calendar item.");
      const result = await api<PublishResult>(
        `calendar-items/${item.id}/publish`,
        { method: "POST" },
        `advanced-lunch-walk-${scheduleKey}-publish`,
      );
      await refreshCalendar();
      setMessage(
        result.deliveryState === "sent"
          ? `Lunch walk sent to Intervals.icu${result.externalId ? ` as ${result.externalId}` : ""}. Check Garmin Connect / Fenix 5 next.`
          : `Lunch walk created. Delivery state: ${result.deliveryState}${result.reason ? ` (${result.reason})` : ""}.`,
      );
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  const sortedCalendar = useMemo(
    () => calendar
      .filter((item) => item.status !== "superseded")
      .sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart)),
    [calendar],
  );

  return (
    <main className={styles.page}>
      <div className={styles.topbar}>
        <Link href="/" className={styles.back}>← Paul&apos;s Running</Link>
        <span className={styles.badge}>CANONICAL CALENDAR</span>
      </div>

      <section className={styles.hero}>
        <h1>Training Calendar</h1>
        <p>Protected controls over the existing Paul&apos;s Running API. The token stays only in this page&apos;s memory and is never stored in localStorage.</p>
      </section>

      <section className={styles.panel}>
        <h2>Connect</h2>
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
          <button className={styles.primary} onClick={connect} disabled={busy || !token.trim()}>{busy ? "Working…" : "Connect / refresh"}</button>
        </div>
        <p className={styles.message}>{message}</p>
        {capabilities && (
          <div className={styles.statusRow}>
            <span>Storage: <strong>{capabilities.storageMode}</strong></span>
            <span>Intervals.icu: <strong>{capabilities.integrations.intervalsIcuPublishingConfigured ? "ready" : "not configured"}</strong></span>
          </div>
        )}
      </section>

      <section className={styles.panel}>
        <div className={styles.headingRow}>
          <div>
            <h2>Race week</h2>
            <p>Monday rehearsal · Saturday optional shakeout · Sunday Cheltenham Half. Wednesday is deliberately omitted.</p>
          </div>
          <button className={styles.primary} onClick={populateRaceWeek} disabled={busy || !capabilities}>Repair &amp; sync race week</button>
        </div>
      </section>

      <section className={styles.panel}>
        <h2>Advanced Lunch Break Walk</h2>
        <p>The original 15:00 test slot has passed. Choose a new future slot; this creates five automatic 2-minute steps and immediately evaluates delivery.</p>
        <div className={styles.inline}>
          <input className={styles.inputSmall} type="date" value={lunchDate} onChange={(event) => setLunchDate(event.target.value)} />
          <input className={styles.inputSmall} type="time" value={lunchTime} onChange={(event) => setLunchTime(event.target.value)} />
          <button className={styles.secondary} onClick={createLunchWalk} disabled={busy || !capabilities}>Create &amp; send test</button>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.headingRow}>
          <div><h2>Canonical schedule</h2><p>Delivery state is separate from the planned calendar record.</p></div>
          <button className={styles.secondary} onClick={() => void refreshCalendar()} disabled={busy || !capabilities}>Refresh</button>
        </div>
        {sortedCalendar.length === 0 ? (
          <p className={styles.empty}>{capabilities ? "No calendar items in the current view." : "Connect to load the protected calendar."}</p>
        ) : (
          <div className={styles.calendarList}>
            {sortedCalendar.map((item) => {
              const status = sync[item.id];
              const workout = workouts[item.workout.id];
              return (
                <article className={styles.calendarItem} key={item.id}>
                  <div className={styles.dateBlock}>
                    <strong>{item.scheduledLocalDate}</strong>
                    <span>{item.scheduledLocalTime} · {item.timezone}</span>
                  </div>
                  <div className={styles.workoutBlock}>
                    <strong>{workout?.currentRevision.name ?? item.workout.id}</strong>
                    <span>Plan: {item.status} · Delivery: {status?.state ?? "planned"}</span>
                    {status?.externalReference?.externalId && <small>Intervals ref: {status.externalReference.externalId}</small>}
                    {status?.latestJob?.lastErrorMessage && <small>{status.latestJob.lastErrorMessage}</small>}
                  </div>
                  <button className={styles.secondary} onClick={() => void publishItem(item.id)} disabled={busy}>Evaluate sync</button>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
