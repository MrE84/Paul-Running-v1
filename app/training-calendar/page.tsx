import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { londonDateKey, reconcileMasterProgramme } from "../../lib/calendar/master-programme-reconcile";
import { getTrainingApiRuntime } from "../../lib/training-api/runtime";
import TrainingCalendarClient from "./TrainingCalendarClient";

export const metadata: Metadata = {
  title: "Training Calendar · Paul's Running",
  description: "Canonical Paul’s Running training calendar and Garmin delivery controls.",
};

// The calendar is backed by live production data. Keep this route dynamic so the
// master programme can be checked against persisted calendar records at request time.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function TrainingCalendarPage() {
  if (process.env.VERCEL_ENV === "production") {
    const runtime = getTrainingApiRuntime();
    try {
      const result = await reconcileMasterProgramme({
        service: runtime.service,
        athleteId: runtime.primaryAthleteId,
        publisher: runtime.workoutPublisher,
        fromDate: londonDateKey(),
        actor: {
          type: "ai_client",
          id: "training-calendar-master-programme-reconciler",
          requestId: randomUUID(),
        },
      });
      if (result.changed || result.publishFailures.length > 0) {
        console.info("master-programme reconciliation", result);
      }
    } catch (error) {
      // Do not make the calendar UI unavailable if reconciliation fails. The client
      // still loads the persisted state, while the server log preserves the failure.
      console.error("master-programme reconciliation failed", error);
    }
  }

  return <TrainingCalendarClient />;
}
