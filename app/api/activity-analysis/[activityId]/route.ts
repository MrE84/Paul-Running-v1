import { NextRequest, NextResponse } from "next/server";
import { buildCanonicalActivityAnalysisReadModel } from "../../../../lib/activity-analysis";
import type { Activity } from "../../../../lib/domain/contracts";
import { handleTrainingApiRequest } from "../../../../lib/training-api/http";

type RouteContext = { params: Promise<{ activityId: string }> };

type ActivityEnvelope = {
  data?: Activity[];
  error?: unknown;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { activityId } = await context.params;
  const upstreamUrl = new URL("/api/v1/activities", request.url);
  upstreamUrl.searchParams.set("limit", "100");
  const authenticatedRequest = new NextRequest(upstreamUrl, {
    method: "GET",
    headers: request.headers,
  });
  const upstream = await handleTrainingApiRequest(authenticatedRequest, ["activities"]);
  const payload = await upstream.json().catch(() => ({})) as ActivityEnvelope;
  if (!upstream.ok) return NextResponse.json(payload, { status: upstream.status });

  const activity = payload.data?.find((candidate) => candidate.id === decodeURIComponent(activityId));
  if (!activity) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Activity analysis projection was not found." } },
      { status: 404 },
    );
  }

  const started = performance.now();
  const readModel = buildCanonicalActivityAnalysisReadModel(activity);
  const computeMs = performance.now() - started;
  const responseBody = { data: readModel };
  const payloadBytes = Buffer.byteLength(JSON.stringify(responseBody), "utf8");

  return NextResponse.json(
    responseBody,
    {
      headers: {
        "Cache-Control": "private, no-store",
        "Server-Timing": `activity-projection;dur=${computeMs.toFixed(2)}`,
        "X-Activity-Projection-Version": readModel.projection.projectionVersion,
        "X-Activity-Algorithm-Version": readModel.projection.algorithmVersion,
        "X-Activity-Projection-Bytes": String(payloadBytes),
      },
    },
  );
}
