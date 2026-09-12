import { randomUUID, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ProductionWorkoutPublishError } from "../integrations/production-publisher";
import type { TrainingApiActor } from "./contracts";
import { getTrainingApiRuntime } from "./runtime";
import {
  TrainingApiError,
  type ApplyPlanApiInput,
  type CreatePlanInput,
  type CreateWorkoutInput,
  type PatchWorkoutInput,
} from "./service";

function secureEqual(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function authenticate(request: NextRequest): TrainingApiActor {
  const configured = process.env.PAUL_RUNNING_API_TOKEN;
  if (!configured) {
    throw new TrainingApiError(
      503,
      "API_AUTH_NOT_CONFIGURED",
      "Training API authentication is not configured. Set PAUL_RUNNING_API_TOKEN before enabling remote clients.",
    );
  }
  const header = request.headers.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!supplied || !secureEqual(supplied, configured)) {
    throw new TrainingApiError(401, "UNAUTHORIZED", "A valid Bearer token is required.");
  }
  return {
    type: "ai_client",
    id: (request.headers.get("x-client-id") ?? "api-client").slice(0, 120),
    requestId: (request.headers.get("x-request-id") ?? randomUUID()).slice(0, 160),
    idempotencyKey: request.headers.get("idempotency-key") ?? undefined,
  };
}

function ok(data: unknown, status = 200) {
  return NextResponse.json({ data }, { status });
}

function errorResponse(error: unknown, requestId?: string) {
  if (error instanceof TrainingApiError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          requestId,
        },
      },
      { status: error.status },
    );
  }
  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "The training API could not complete the request.",
        requestId,
      },
    },
    { status: 500 },
  );
}

async function jsonBody<T>(request: NextRequest): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new TrainingApiError(400, "VALIDATION_FAILED", "Request body must contain valid JSON.");
  }
}

export async function handleTrainingApiRequest(
  request: NextRequest,
  path: string[],
): Promise<NextResponse> {
  let actor: TrainingApiActor | undefined;
  try {
    actor = authenticate(request);
    const runtime = getTrainingApiRuntime();
    const service = runtime.service;
    const method = request.method.toUpperCase();
    const athleteId = request.nextUrl.searchParams.get("athleteId") ?? runtime.primaryAthleteId;

    if (method === "GET" && path.length === 1 && path[0] === "capabilities") {
      return ok({
        version: "v1",
        mcpReady: true,
        primaryAthleteId: runtime.primaryAthleteId,
        storageMode: runtime.storageMode,
        integrations: {
          intervalsIcuPublishingConfigured: runtime.intervalsIcuConfigured,
        },
        writeSafety: ["bearer_auth", "idempotency", "optimistic_concurrency", "qa_before_save", "audit_attribution"],
        endpoints: [
          "GET /api/v1/profile",
          "GET /api/v1/zones",
          "GET /api/v1/calendar-items",
          "GET /api/v1/activities",
          "GET|POST /api/v1/workouts",
          "GET|PATCH /api/v1/workouts/{id}",
          "GET /api/v1/workouts/{id}/qa",
          "GET|POST /api/v1/training-plans",
          "GET /api/v1/training-plans/{id}",
          "POST /api/v1/training-plans/{id}/apply",
          "GET /api/v1/calendar-items/{id}/sync-status",
          "POST /api/v1/calendar-items/{id}/supersede",
          "POST /api/v1/calendar-items/{id}/publish",
        ],
      });
    }

    if (method === "GET" && path.length === 1 && path[0] === "profile") return ok(await service.getProfile(athleteId));
    if (method === "GET" && path.length === 1 && path[0] === "zones") return ok(await service.listZones(athleteId));
    if (method === "GET" && path.length === 3 && path[0] === "athletes" && path[2] === "zone-sets") return ok(await service.listZones(path[1]));
    if (method === "GET" && path.length === 2 && path[0] === "athletes") return ok(await service.getProfile(path[1]));

    if (method === "GET" && path.length === 1 && path[0] === "calendar-items") {
      return ok(await service.listCalendar(athleteId, request.nextUrl.searchParams.get("from") ?? undefined, request.nextUrl.searchParams.get("to") ?? undefined));
    }
    if (method === "GET" && path.length === 3 && path[0] === "calendar-items" && path[2] === "sync-status") return ok(await service.getSyncStatus(path[1]));
    if (method === "POST" && path.length === 3 && path[0] === "calendar-items" && path[2] === "supersede") {
      return ok(await service.supersedeCalendarItem(path[1], actor));
    }
    if (method === "POST" && path.length === 3 && path[0] === "calendar-items" && path[2] === "publish") {
      if (!actor.idempotencyKey) {
        throw new TrainingApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Publish operations require an Idempotency-Key header.");
      }
      if (!runtime.workoutPublisher) {
        throw new TrainingApiError(
          503,
          "INTERVALS_ICU_AUTH_NOT_CONFIGURED",
          "Intervals.icu publishing is not configured. Set INTERVALS_ICU_API_KEY in the server environment.",
        );
      }
      try {
        return ok(await runtime.workoutPublisher.publishCalendarItem(path[1], {
          actorType: actor.type,
          actorId: actor.id,
          requestId: actor.requestId,
        }));
      } catch (error) {
        if (error instanceof ProductionWorkoutPublishError) {
          throw new TrainingApiError(error.status, error.code, error.message, error.details);
        }
        throw error;
      }
    }

    if (method === "GET" && path.length === 1 && path[0] === "activities") {
      const rawLimit = Number(request.nextUrl.searchParams.get("limit") ?? "20");
      const limit = Number.isFinite(rawLimit) ? Math.min(100, Math.max(0, Math.floor(rawLimit))) : 20;
      return ok(await service.listActivities(athleteId, limit));
    }

    if (path[0] === "workouts") {
      if (method === "GET" && path.length === 1) return ok(await service.listWorkouts(athleteId));
      if (method === "POST" && path.length === 1) {
        const body = await jsonBody<Partial<CreateWorkoutInput>>(request);
        return ok(await service.createWorkout({ ...(body as CreateWorkoutInput), athleteId: body.athleteId ?? athleteId }, actor), 201);
      }
      if (method === "GET" && path.length === 2) return ok(await service.getWorkout(path[1]));
      if (method === "PATCH" && path.length === 2) return ok(await service.patchWorkout(path[1], await jsonBody<PatchWorkoutInput>(request), actor));
      if (method === "GET" && path.length === 3 && path[2] === "qa") return ok(await service.validateWorkout(path[1]));
    }

    if (path[0] === "training-plans") {
      if (method === "GET" && path.length === 1) return ok(await service.listPlans(athleteId));
      if (method === "POST" && path.length === 1) {
        const body = await jsonBody<Partial<CreatePlanInput>>(request);
        return ok(await service.createPlan({ ...(body as CreatePlanInput), athleteId: body.athleteId ?? athleteId }, actor), 201);
      }
      if (method === "GET" && path.length === 2) return ok(await service.getPlan(path[1]));
      if (method === "POST" && path.length === 3 && path[2] === "apply") return ok(await service.applyPlan(path[1], await jsonBody<ApplyPlanApiInput>(request), actor), 201);
    }

    throw new TrainingApiError(404, "NOT_FOUND", `No ${method} API route matches /api/v1/${path.join("/")}.`);
  } catch (error) {
    return errorResponse(error, actor?.requestId);
  }
}
