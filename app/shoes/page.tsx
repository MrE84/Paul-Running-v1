import type { Metadata } from "next";
import Link from "next/link";
import sessions from "../../lib/training-programme/scheduled-workouts.json";
import { getTrainingApiRuntime } from "../../lib/training-api/runtime";
import {
  buildShoeUsage,
  getShoe,
  SHOE_TRACKING_START_LOCAL_DATE,
  type PlannedShoeSession,
} from "../../lib/shoe-rotation";
import styles from "./shoes.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Running Shoes · Paul's Running",
  description: "Live shoe rotation, prescribed use and completed-run mileage for Paul's Running.",
};

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  day: "numeric",
  month: "short",
  year: "numeric",
});

const sourceLabel = {
  activity_metadata: "Actual shoe metadata",
  planned_session: "Master-plan shoe",
  activity_name: "Session-name inference",
} as const;

export default async function ShoesPage() {
  const runtime = getTrainingApiRuntime();
  const { service, primaryAthleteId } = runtime;
  const [profile, activities, calendarItems, workouts] = await Promise.all([
    service.getProfile(primaryAthleteId),
    service.listActivities(primaryAthleteId, 500),
    service.listCalendar(primaryAthleteId),
    service.listWorkouts(primaryAthleteId),
  ]);

  const workoutNames = new Map(workouts.map((workout) => [workout.id, workout.currentRevision.name]));
  const canonicalSessions: PlannedShoeSession[] = calendarItems.map((item) => ({
    id: item.id,
    scheduledStart: item.scheduledStart,
    timezone: item.timezone,
    title: workoutNames.get(item.workout.id) ?? "Planned running session",
  }));
  const syncedProgramme: PlannedShoeSession[] = sessions.map((session) => ({
    id: session.id,
    scheduledStart: session.scheduledStart,
    timezone: session.timezone,
    title: session.title,
  }));

  // Prefer canonical Paul’s Running calendar items, with the already-synced programme as a
  // fallback for sessions that pre-date/precede canonical plan application.
  const plannedByKey = new Map<string, PlannedShoeSession>();
  for (const session of [...syncedProgramme, ...canonicalSessions]) {
    plannedByKey.set(`${session.scheduledStart}|${session.title}`, session);
  }

  const usage = buildShoeUsage(
    activities,
    [...plannedByKey.values()],
    profile.athlete.timezone || "Europe/London",
  );

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <span className={styles.eyebrow}>SHOE ROTATION</span>
        <h1>Running shoes</h1>
        <p>
          Completed running activities are matched to the prescribed shoe in the master plan.
          If an imported activity already contains an actual shoe/gear name, that wins over the prescription.
        </p>
        <div className={styles.notice}>
          Automatic app mileage starts on <strong>10 October 2026</strong>. Earlier shoe mileage is not guessed or backfilled.
          Distances below are recalculated from completed activities, so refreshing or re-importing a run cannot add the same kilometres twice.
        </div>
      </section>

      <section className={styles.grid} aria-label="Shoe mileage">
        {usage.summaries.map(({ shoe, distanceKm, distanceMiles, activityCount }) => {
          const progress = shoe.reviewAtKm ? Math.min(100, (distanceKm / shoe.reviewAtKm) * 100) : undefined;
          return (
            <article key={shoe.key} className={styles.card}>
              <span className={styles.brand}>{shoe.brand}</span>
              <h2>{shoe.model}</h2>
              <p className={styles.role}>{shoe.role}</p>
              <div className={styles.distance}>
                <strong>{distanceKm.toFixed(1)} km</strong>
                <span>{distanceMiles.toFixed(1)} mi</span>
              </div>
              <p className={styles.subtle}>{activityCount} completed {activityCount === 1 ? "run" : "runs"} tracked</p>
              {shoe.reviewAtKm ? (
                <>
                  <div className={styles.progressTrack} aria-label={`${shoe.shortName} mileage toward review point`}>
                    <div className={styles.progressFill} style={{ width: `${progress}%` }} />
                  </div>
                  <p className={styles.subtle}>Responsiveness review point: ~{shoe.reviewAtKm} km</p>
                </>
              ) : null}
              <p className={styles.note}>{shoe.note}</p>
            </article>
          );
        })}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <span className={styles.eyebrow}>ROTATION RULE</span>
            <h2>Which shoe should I wear?</h2>
          </div>
          <Link href="/master-plan">Open master plan →</Link>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Shoe</th><th>Use it for</th><th>Do not waste it on</th></tr></thead>
            <tbody>
              <tr><td><strong>Adidas Evo SL</strong></td><td>Easy, aerobic, long, recovery, easy + strides</td><td>Nothing special — this is the main mileage shoe</td></tr>
              <tr><td><strong>PUMA Deviate NITRO 3 HYROX</strong></td><td>Threshold, tempo, progression, HM pace, intervals, controlled parkrun</td><td>Routine recovery mileage and PB/race-only efforts</td></tr>
              <tr><td><strong>ASICS Metaspeed Sky Tokyo</strong></td><td>5K/10K PB attempts, benchmark races, key race rehearsals, half-marathon racing</td><td>Routine training kilometres</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <span className={styles.eyebrow}>AUDIT TRAIL</span>
            <h2>Recent shoe assignments</h2>
          </div>
          <span className={styles.subtle}>Tracking since {SHOE_TRACKING_START_LOCAL_DATE}</span>
        </div>
        {usage.assignments.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Date</th><th>Session</th><th>Shoe</th><th>Distance</th><th>Assignment</th></tr></thead>
              <tbody>
                {usage.assignments.slice(0, 20).map((assignment) => {
                  const shoe = getShoe(assignment.shoeKey);
                  return (
                    <tr key={assignment.activityId}>
                      <td>{dateFormat.format(new Date(assignment.startedAt))}</td>
                      <td>{assignment.sessionTitle ?? "Completed run"}</td>
                      <td><strong>{shoe?.shortName ?? assignment.shoeKey}</strong></td>
                      <td>{assignment.distanceKm.toFixed(2)} km</td>
                      <td><span className={styles.source}>{sourceLabel[assignment.source]}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className={styles.empty}>No completed runs have been assigned since shoe tracking started.</p>}
        {usage.unassignedRuns ? (
          <p className={styles.warning}>
            {usage.unassignedRuns} completed running {usage.unassignedRuns === 1 ? "activity is" : "activities are"} currently unassigned. Add an actual shoe name to the activity metadata or make sure the run is represented in the master-plan calendar.
          </p>
        ) : null}
      </section>
    </main>
  );
}
