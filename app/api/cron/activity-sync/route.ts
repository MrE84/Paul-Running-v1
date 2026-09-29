import { handleScheduledActivitySync } from "../../../../lib/integrations/scheduled-activity-sync";
import { getTrainingApiRuntime } from "../../../../lib/training-api/runtime";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  return handleScheduledActivitySync(request, {
    secret: process.env.CRON_SECRET,
    runtime: getTrainingApiRuntime,
  });
}
