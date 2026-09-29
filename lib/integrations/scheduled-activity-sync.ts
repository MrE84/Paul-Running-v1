import { timingSafeEqual } from "node:crypto";
import type { TrainingApiRuntimeBundle } from "../training-api/runtime";

/**
 * Handler for the Vercel Cron backstop that pulls new activities from
 * Intervals.icu without anyone opening the library page.
 *
 * Vercel sends `Authorization: Bearer <CRON_SECRET>` on cron invocations when
 * CRON_SECRET is set on the project. The route fails closed: with no secret
 * configured it refuses every request rather than running unauthenticated.
 */
function secureEqual(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function json(value: unknown, status: number): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export interface ScheduledActivitySyncOptions {
  secret?: string;
  runtime: () => TrainingApiRuntimeBundle;
  maxPages?: number;
}

export async function handleScheduledActivitySync(
  request: Request,
  options: ScheduledActivitySyncOptions,
): Promise<Response> {
  const secret = options.secret?.trim();
  if (!secret) {
    return json({ status: "error", code: "CRON_SECRET_NOT_CONFIGURED" }, 503);
  }
  const header = request.headers.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!supplied || !secureEqual(supplied, secret)) {
    return json({ status: "error", code: "UNAUTHORIZED" }, 401);
  }

  const runtime = options.runtime();
  if (!runtime.activityImporter) {
    return json({ status: "error", code: "INTERVALS_ICU_ACTIVITY_IMPORT_NOT_CONFIGURED" }, 503);
  }
  try {
    const result = await runtime.activityImporter.importRecent(options.maxPages ?? 1);
    return json({
      status: result.failed ? "partial" : "ok",
      imported: result.imported,
      repaired: result.repaired,
      alreadyComplete: result.alreadyComplete,
      failed: result.failed,
      pagesProcessed: result.pagesProcessed,
    }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Scheduled activity sync failed", { message });
    return json({ status: "error", code: "ACTIVITY_SYNC_FAILED" }, 502);
  }
}
