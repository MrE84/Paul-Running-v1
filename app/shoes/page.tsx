import type { Metadata } from "next";
import Link from "next/link";
import sessions from "../../lib/training-programme/scheduled-workouts.json";
import { listShoeOverrides } from "../../lib/shoe-overrides";
import { getTrainingApiRuntime } from "../../lib/training-api/runtime";
import {
  buildShoeUsage,
  getShoe,
  SHOE_ROTATION,
  SHOE_TRACKING_START_LOCAL_DATE,
  type PlannedShoeSession,
  type ShoeLifeStatus,
} from "../../lib/shoe-rotation";
import { updateShoeAssignment } from "./actions";
import styles from "./shoes.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Running Shoes · Paul's Running",
  description: "Live shoe rotation, editable completed-run assignments, historical estimates and replacement countdowns for Paul's Running.",
};

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  day: "numeric",
  month: "short",
  year: "numeric",
});

const sourceLabel = {
  manual_override: "Manual shoe choice",
  confirmed_user: "User-confirmed shoe",
  activity_metadata: "Actual shoe metadata",
  planned_session: "Master-plan shoe",
  activity_name: "Session-name inference",
} as const;

const statusLabel: Record<ShoeLifeStatus, string> = {
  healthy: "In service",
  review_soon: "Review approaching",
  review_due: "Performance review due",
  replace_soon: "Swap approaching",
  replace_due: "Swap / demotion due",
};

function statusClass(status: ShoeLifeStatus) {
  if (status === "replace_due" || status === "replace_soon") return styles.statusDanger;
  if (status === "review_due" || status === "review_soon") return styles.statusWarning;
  return styles.statusHealthy;
}

export default async function ShoesPage() {
  const runtime = getTrainingApiRuntime();
  const { service, primaryAthleteId } = runtime;
  const [profile, activities, calendarItems, workouts, overrides] = await Promise.all([
    service.getProfile(primaryAthleteId),
    service.listActivities(primaryAthleteId, 500),
    service.listCalendar(primaryAthleteId),
    service.listWorkouts(primaryAthleteId),
    listShoeOverrides(primaryAthleteId),
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

  const plannedByKey = new Map<string, PlannedShoeSession>();
  for (const session of [...syncedProgramme, ...canonicalSessions]) {
    plannedByKey.set(`${session.scheduledStart}|${session.title}`, session);
  }

  const usage = buildShoeUsage(
    activities,
    [...plannedByKey.values()],
    profile.athlete.timezone || "Europe/London",
    new Date().toISOString(),
    overrides,
  );

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <span className={styles.eyebrow}>SHOE ROTATION</span>
        <h1>Running shoes</h1>
        <p>
          The master plan recommends a shoe, but the mileage ledger follows the shoe you actually wore.
          Use the selector beside any completed run to change it; a manual choice immediately overrides all automatic rules.
        </p>
        <div className={styles.notice}>
          <strong>Historical baseline:</strong> Evo SL ≈187.0 km, Metaspeed Sky Tokyo ≈31.0 km, PUMA 0 km before live tracking.
          Automatic activity tracking starts on <strong>10 October 2026</strong>. Manual assignments are stored separately from imported activity data, so Garmin/Tredict re-syncs cannot overwrite them.
        </div>
      </section>

      <section className={styles.grid} aria-label="Shoe mileage">
        {usage.summaries.map((summary) => {
          const { shoe, totalDistanceKm, totalDistanceMiles, estimatedHistoricalKm, trackedDistanceKm, activityCount } = summary;
          const progress = Math.min(100, (totalDistanceKm / shoe.replaceAtKm) * 100);
          return (
            <article key={shoe.key} className={styles.card}>
              <div className={styles.cardTop}>
                <div>
                  <span className={styles.brand}>{shoe.brand}</span>
                  <h2>{shoe.model}</h2>
                </div>
                <span className={`${styles.status} ${statusClass(summary.status)}`}>{statusLabel[summary.status]}</span>
              </div>
              <p className={styles.role}>{shoe.role}</p>
              <div className={styles.distance}>
                <strong>{totalDistanceKm.toFixed(1)} km</strong>
                <span>{totalDistanceMiles.toFixed(1)} mi total</span>
              </div>
              <div className={styles.breakdown}>
                <span><strong>{estimatedHistoricalKm.toFixed(1)} km</strong> historical estimate</span>
                <span><strong>{trackedDistanceKm.toFixed(1)} km</strong> tracked since launch</span>
                <span><strong>{activityCount}</strong> tracked {activityCount === 1 ? "run" : "runs"}</span>
              </div>

              <div className={styles.progressTrack} aria-label={`${shoe.shortName} mileage toward swap point`}>
                <div className={styles.progressFill} style={{ width: `${progress}%` }} />
              </div>
              <div className={styles.countdowns}>
                <div>
                  <span>Performance review</span>
                  <strong>{summary.remainingToReviewKm > 0 ? `${summary.remainingToReviewKm.toFixed(0)} km left` : "Due now"}</strong>
                  <small>at ~{shoe.reviewAtKm} km</small>
                </div>
                <div>
                  <span>Swap / demote</span>
                  <strong>{summary.remainingToReplaceKm > 0 ? `${summary.remainingToReplaceKm.toFixed(0)} km left` : "Due now"}</strong>
                  <small>planning point ~{shoe.replaceAtKm} km</small>
                </div>
              </div>

              <div className={styles.forecast}>
                {summary.projectedReplaceDate ? (
                  <><strong>Projected swap window:</strong> {dateFormat.format(new Date(summary.projectedReplaceDate))} at the recent usage rate.</>
                ) : (
                  <>Swap-date forecast will appear after at least 3 tracked runs spanning 14+ days.</>
                )}
              </div>

              {(summary.status === "review_soon" || summary.status === "review_due") ? (
                <p className={styles.cardWarning}>Start comparing ride feel, rebound, stability and post-run soreness against when this shoe was fresher.</p>
              ) : null}
              {(summary.status === "replace_soon" || summary.status === "replace_due") ? (
                <p className={styles.cardDanger}>This shoe is at or close to its planned swap/demotion point. Do not assume it still delivers its original performance.</p>
              ) : null}

              <details className={styles.basis}>
                <summary>How was the starting mileage estimated?</summary>
                <p>{shoe.historicalBasis}</p>
              </details>
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
            <thead><tr><th>Shoe</th><th>Use it for</th><th>Protect it from</th></tr></thead>
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
            <span className={styles.eyebrow}>MILEAGE LEDGER</span>
            <h2>Recent completed runs</h2>
          </div>
          <span className={styles.subtle}>Tracking since {SHOE_TRACKING_START_LOCAL_DATE}</span>
        </div>
        <p className={styles.editHelp}>
          The plan recommendation is only a default. If you wore something else, choose the actual shoe here and save it. Choose <strong>Automatic/default</strong> to return the run to the normal assignment rules.
        </p>
        {usage.assignments.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Date</th><th>Session</th><th>Counted shoe</th><th>Distance</th><th>Assignment</th><th>Change shoe</th></tr></thead>
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
                      <td>
                        <form action={updateShoeAssignment} className={styles.assignmentForm}>
                          <input type="hidden" name="activityId" value={assignment.activityId} />
                          <select
                            name="shoeKey"
                            className={styles.shoeSelect}
                            defaultValue={assignment.source === "manual_override" ? assignment.shoeKey : "auto"}
                            aria-label={`Change shoe for ${assignment.sessionTitle ?? "completed run"}`}
                          >
                            <option value="auto">Automatic/default</option>
                            {SHOE_ROTATION.map((option) => (
                              <option key={option.key} value={option.key}>{option.shortName}</option>
                            ))}
                          </select>
                          <button type="submit" className={styles.saveButton}>Save</button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <p className={styles.empty}>No completed runs have been assigned since shoe tracking started.</p>}
        {usage.unassignedRuns ? (
          <p className={styles.warning}>
            {usage.unassignedRuns} completed running {usage.unassignedRuns === 1 ? "activity is" : "activities are"} currently unassigned. A future update can expose unassigned runs here as well; currently the ledger shows runs that can already be matched to a shoe.
          </p>
        ) : null}
      </section>
    </main>
  );
}
