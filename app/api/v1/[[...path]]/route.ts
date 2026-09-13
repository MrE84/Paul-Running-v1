import { NextRequest, NextResponse } from "next/server";
import { nearestIndex } from "../../../../lib/activity-analysis/projection";
import { handleTrainingApiRequest } from "../../../../lib/training-api/http";
import { getTrainingApiRuntime } from "../../../../lib/training-api/runtime";
import {
  authorizeSignedActivityRead,
  hasSignedAgentCredential,
  SignedAgentReadError,
} from "../../../../lib/training-api/signed-agent-read";

type RouteContext = { params: Promise<{ path?: string[] }> };

function signedReadError(error: SignedAgentReadError) {
  return NextResponse.json(
    { error: { code: error.code, message: error.message } },
    { status: error.status, headers: { "Cache-Control": "private, no-store" } },
  );
}

async function signedSample(activityId: string, elapsedRaw: string | null) {
  const elapsedSeconds = Number(elapsedRaw);
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
    return NextResponse.json(
      { error: { code: "VALIDATION_FAILED", message: "elapsedSeconds must be a non-negative number." } },
      { status: 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const runtime = getTrainingApiRuntime();
  const projection = await runtime.service.getActivityAnalysis(runtime.primaryAthleteId, activityId, false);
  if (!projection.streams.elapsed.length) {
    return NextResponse.json(
      { error: { code: "ACTIVITY_SAMPLES_UNAVAILABLE", message: "This activity does not contain sample-level data." } },
      { status: 409, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const index = nearestIndex(projection.streams.elapsed, elapsedSeconds);
  const matchedElapsed = projection.streams.elapsed[index] ?? null;
  const channels = Object.fromEntries(
    Object.entries(projection.streams.channels).map(([key, values]) => [key, values?.[index] ?? null]),
  );
  return NextResponse.json({
    data: {
      activityId: projection.activity.id,
      activityTitle: projection.activity.title,
      index,
      requestedElapsedSeconds: elapsedSeconds,
      elapsedSeconds: matchedElapsed,
      deltaSeconds: matchedElapsed === null ? null : Math.round((matchedElapsed - elapsedSeconds) * 1000) / 1000,
      recordIndex: projection.streams.recordIndex[index] ?? null,
      distanceMeters: projection.streams.distance[index] ?? null,
      latitude: projection.streams.latitude[index] ?? null,
      longitude: projection.streams.longitude[index] ?? null,
      breakBefore: projection.streams.breakBefore[index] ?? false,
      heartRateBpm: projection.streams.channels.heart_rate?.[index] ?? null,
      paceSecondsPerKm: projection.streams.channels.pace?.[index] ?? null,
      speedMetresPerSecond: projection.streams.channels.speed?.[index] ?? null,
      elevationMetres: projection.streams.channels.altitude?.[index] ?? null,
      cadenceSpm: projection.streams.channels.cadence?.[index] ?? null,
      channels,
    },
  }, { headers: { "Cache-Control": "private, no-store" } });
}

async function handle(request: NextRequest, context: RouteContext) {
  const { path = [] } = await context.params;

  if (request.method === "GET" && hasSignedAgentCredential(request)) {
    if (path[0] !== "activities") {
      return signedReadError(new SignedAgentReadError(403, "AGENT_SCOPE_FORBIDDEN", "Signed agent authentication is limited to activity reads."));
    }
    try {
      const authorized = await authorizeSignedActivityRead(request);
      if (path.length === 3 && path[2] === "sample") {
        return signedSample(path[1], authorized.cleanUrl.searchParams.get("elapsedSeconds"));
      }
      const apiToken = process.env.PAUL_RUNNING_API_TOKEN?.trim();
      if (!apiToken) {
        return NextResponse.json(
          { error: { code: "API_AUTH_NOT_CONFIGURED", message: "Training API authentication is not configured." } },
          { status: 503, headers: { "Cache-Control": "private, no-store" } },
        );
      }
      const headers = new Headers(request.headers);
      headers.set("authorization", `Bearer ${apiToken}`);
      headers.set("x-client-id", "chatgpt-signed-activity-read");
      headers.set("x-agent-key-id", authorized.keyId);
      const trustedRequest = new NextRequest(authorized.cleanUrl, { method: "GET", headers });
      return handleTrainingApiRequest(trustedRequest, path);
    } catch (error) {
      if (error instanceof SignedAgentReadError) return signedReadError(error);
      throw error;
    }
  }

  return handleTrainingApiRequest(request, path);
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
