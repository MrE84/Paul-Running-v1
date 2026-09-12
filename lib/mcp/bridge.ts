import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { WorkoutStep } from "../domain/contracts";
import { ProductionWorkoutPublishError } from "../integrations/production-publisher";
import type { TrainingApiActor } from "../training-api/contracts";
import { getTrainingApiRuntime, type TrainingApiRuntimeBundle } from "../training-api/runtime";
import {
  TrainingApiError,
  type ApplyPlanApiInput,
  type CreatePlanInput,
  type CreateWorkoutInput,
  type PatchWorkoutInput,
} from "../training-api/service";

const SERVER_INFO = { name: "pauls-running", version: "1.0.0" } as const;
const LEGACY_PROTOCOL = "2025-11-25";
const MODERN_PROTOCOL = "2026-07-28";

type JsonRpcId = string | number | null;
type JsonRpcRequest = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
};

type BridgeOptions = {
  runtime?: TrainingApiRuntimeBundle;
  token?: string;
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function rpcResult(id: JsonRpcId | undefined, result: unknown): Response {
  return json({ jsonrpc: "2.0", id: id ?? null, result });
}

function rpcError(id: JsonRpcId | undefined, code: number, message: string, data?: unknown, status = 200): Response {
  return json({ jsonrpc: "2.0", id: id ?? null, error: { code, message, data } }, status);
}

function secureEqual(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function configuredToken(options?: BridgeOptions): string {
  const token = options?.token ?? process.env.PAUL_RUNNING_MCP_TOKEN?.trim() ?? process.env.PAUL_RUNNING_API_TOKEN?.trim();
  if (!token) throw new TrainingApiError(503, "MCP_AUTH_NOT_CONFIGURED", "MCP authentication is not configured.");
  return token;
}

function authenticate(request: Request, options?: BridgeOptions) {
  const expected = configuredToken(options);
  const header = request.headers.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!supplied || !secureEqual(supplied, expected)) {
    throw new TrainingApiError(401, "UNAUTHORIZED", "A valid Bearer token is required.");
  }
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
    .join(",")}}`;
}

function actor(tool: string, args: unknown, request: JsonRpcRequest): TrainingApiActor {
  const fingerprint = createHash("sha256").update(`${tool}:${stable(args)}`).digest("hex").slice(0, 40);
  return {
    type: "ai_client",
    id: "chatgpt-mcp",
    requestId: `mcp:${String(request.id ?? randomUUID())}`.slice(0, 160),
    idempotencyKey: `mcp:${tool}:${fingerprint}`,
  };
}

const stepSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["id", "kind", "sequence", "durationType", "targetType"],
      properties: {
        id: { type: "string" }, kind: { const: "step" }, sequence: { type: "integer", minimum: 0 },
        phase: { enum: ["warmup", "active", "recovery", "cooldown"] }, name: { type: "string" },
        durationType: { enum: ["time", "distance", "open"] }, durationValue: { type: "number", exclusiveMinimum: 0 }, durationUnit: { type: "string" },
        manualLapIntent: { type: "boolean" }, targetType: { enum: ["none", "heart_rate", "pace", "cadence", "power"] },
        targetLow: { type: "number" }, targetHigh: { type: "number" }, targetUnit: { type: "string" }, instruction: { type: "string" },
      },
    },
    {
      type: "object",
      additionalProperties: true,
      required: ["id", "kind", "sequence", "repeatCount", "children"],
      properties: {
        id: { type: "string" }, kind: { const: "repeat" }, sequence: { type: "integer", minimum: 0 }, name: { type: "string" },
        repeatCount: { type: "integer", minimum: 1 }, children: { type: "array" }, instruction: { type: "string" },
      },
    },
  ],
};

export const mcpTools = [
  { name: "get_profile", description: "Read the primary athlete profile and active physiological capacity.", inputSchema: { type: "object", additionalProperties: false, properties: {} } },
  { name: "get_zones", description: "Read the primary athlete's active training zone sets.", inputSchema: { type: "object", additionalProperties: false, properties: {} } },
  { name: "list_calendar", description: "List canonical training calendar items, optionally bounded by ISO timestamps.", inputSchema: { type: "object", additionalProperties: false, properties: { from: { type: "string" }, to: { type: "string" } } } },
  { name: "get_sync_status", description: "Read durable Intervals.icu/Garmin delivery state for a calendar item.", inputSchema: { type: "object", additionalProperties: false, required: ["calendarItemId"], properties: { calendarItemId: { type: "string" } } } },
  { name: "list_workouts", description: "List workouts for the primary athlete.", inputSchema: { type: "object", additionalProperties: false, properties: {} } },
  { name: "get_workout", description: "Read one workout and its current revision.", inputSchema: { type: "object", additionalProperties: false, required: ["workoutId"], properties: { workoutId: { type: "string" } } } },
  { name: "list_training_plans", description: "List training plans for the primary athlete.", inputSchema: { type: "object", additionalProperties: false, properties: {} } },
  { name: "get_training_plan", description: "Read one training plan and its current revision.", inputSchema: { type: "object", additionalProperties: false, required: ["planId"], properties: { planId: { type: "string" } } } },
  {
    name: "create_workout", description: "Create a QA-gated structured workout for the primary athlete. Identical repeated calls are idempotent.",
    inputSchema: { type: "object", additionalProperties: false, required: ["name", "sport", "steps"], properties: { name: { type: "string" }, description: { type: "string" }, sport: { enum: ["running", "cycling", "walking", "other"] }, steps: { type: "array", minItems: 1, items: stepSchema } } },
  },
  {
    name: "revise_workout", description: "Create a new QA-gated workout revision using optimistic version checking.",
    inputSchema: { type: "object", additionalProperties: false, required: ["workoutId", "expectedVersion", "change"], properties: { workoutId: { type: "string" }, expectedVersion: { type: "integer", minimum: 1 }, change: { type: "object", additionalProperties: true } } },
  },
  {
    name: "create_training_plan", description: "Create a training plan referencing exact workout revisions.",
    inputSchema: { type: "object", additionalProperties: false, required: ["name", "items"], properties: { name: { type: "string" }, description: { type: "string" }, items: { type: "array", minItems: 1, items: { type: "object", additionalProperties: false, required: ["id", "sequence", "dayOffset", "workoutId", "workoutVersion"], properties: { id: { type: "string" }, sequence: { type: "integer", minimum: 0 }, dayOffset: { type: "integer", minimum: 0 }, localStartTime: { type: "string" }, workoutId: { type: "string" }, workoutVersion: { type: "integer", minimum: 1 } } } } } },
  },
  {
    name: "apply_training_plan", description: "Apply an exact plan revision to concrete local dates/times.",
    inputSchema: { type: "object", additionalProperties: false, required: ["planId", "planVersion", "startDate", "timezone"], properties: { planId: { type: "string" }, planVersion: { type: "integer", minimum: 1 }, startDate: { type: "string" }, timezone: { type: "string" }, defaultLocalStartTime: { type: "string" } } },
  },
  {
    name: "publish_calendar_item", description: "QA-check and idempotently publish an eligible calendar workout to Intervals.icu for Garmin delivery.",
    inputSchema: { type: "object", additionalProperties: false, required: ["calendarItemId"], properties: { calendarItemId: { type: "string" } } },
  },
  {
    name: "create_advanced_lunch_break_walk", description: "Create the known-safe 10-minute validation walk: five automatic two-minute walking steps with no physiological target.",
    inputSchema: { type: "object", additionalProperties: false, properties: { name: { type: "string", default: "Advanced Lunch Break Walk" } } },
  },
] as const;

function argString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value) throw new TrainingApiError(400, "VALIDATION_FAILED", `${key} is required.`);
  return value;
}

function argNumber(args: Record<string, unknown>, key: string): number {
  const value = args[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TrainingApiError(400, "VALIDATION_FAILED", `${key} must be a number.`);
  return value;
}

async function callTool(name: string, args: Record<string, unknown>, request: JsonRpcRequest, runtime: TrainingApiRuntimeBundle) {
  const service = runtime.service;
  const mutationActor = actor(name, args, request);
  switch (name) {
    case "get_profile": return service.getProfile(runtime.primaryAthleteId);
    case "get_zones": return service.listZones(runtime.primaryAthleteId);
    case "list_calendar": return service.listCalendar(runtime.primaryAthleteId, args.from as string | undefined, args.to as string | undefined);
    case "get_sync_status": return service.getSyncStatus(argString(args, "calendarItemId"));
    case "list_workouts": return service.listWorkouts(runtime.primaryAthleteId);
    case "get_workout": return service.getWorkout(argString(args, "workoutId"));
    case "list_training_plans": return service.listPlans(runtime.primaryAthleteId);
    case "get_training_plan": return service.getPlan(argString(args, "planId"));
    case "create_workout": {
      const input = { ...args, athleteId: runtime.primaryAthleteId } as unknown as CreateWorkoutInput;
      return service.createWorkout(input, mutationActor);
    }
    case "revise_workout": {
      const workoutId = argString(args, "workoutId");
      const input: PatchWorkoutInput = { expectedVersion: argNumber(args, "expectedVersion"), change: (args.change ?? {}) as PatchWorkoutInput["change"] };
      return service.patchWorkout(workoutId, input, mutationActor);
    }
    case "create_training_plan": {
      const input = { ...args, athleteId: runtime.primaryAthleteId } as unknown as CreatePlanInput;
      return service.createPlan(input, mutationActor);
    }
    case "apply_training_plan": {
      const planId = argString(args, "planId");
      const input: ApplyPlanApiInput = {
        planVersion: argNumber(args, "planVersion"), startDate: argString(args, "startDate"), timezone: argString(args, "timezone"),
        defaultLocalStartTime: args.defaultLocalStartTime as string | undefined,
      };
      return service.applyPlan(planId, input, mutationActor);
    }
    case "publish_calendar_item": {
      const calendarItemId = argString(args, "calendarItemId");
      if (!runtime.workoutPublisher) throw new TrainingApiError(503, "INTERVALS_ICU_AUTH_NOT_CONFIGURED", "Intervals.icu publishing is not configured.");
      return runtime.workoutPublisher.publishCalendarItem(calendarItemId, { actorType: mutationActor.type, actorId: mutationActor.id, requestId: mutationActor.requestId });
    }
    case "create_advanced_lunch_break_walk": {
      const steps: WorkoutStep[] = Array.from({ length: 5 }, (_, index) => ({
        id: randomUUID(), kind: "step", sequence: index, phase: "active", name: `Walk ${index + 1}`,
        durationType: "time", durationValue: 120, durationUnit: "seconds", manualLapIntent: false,
        targetType: "none", instruction: "Walk comfortably; advance automatically after two minutes.",
      }));
      return service.createWorkout({ athleteId: runtime.primaryAthleteId, name: typeof args.name === "string" && args.name ? args.name : "Advanced Lunch Break Walk", sport: "walking", steps }, mutationActor);
    }
    default: throw new TrainingApiError(404, "TOOL_NOT_FOUND", `Unknown MCP tool ${name}.`);
  }
}

function toolEnvelope(value: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
}

function toolError(error: unknown) {
  if (error instanceof TrainingApiError || error instanceof ProductionWorkoutPublishError) {
    const value = { error: { code: error.code, message: error.message, details: error.details } };
    return { ...toolEnvelope(value), isError: true };
  }
  const value = { error: { code: "INTERNAL_ERROR", message: "The Paul’s Running MCP bridge could not complete the tool call." } };
  return { ...toolEnvelope(value), isError: true };
}

export async function handleMcpRequest(request: Request, options?: BridgeOptions): Promise<Response> {
  let body: JsonRpcRequest | undefined;
  try {
    authenticate(request, options);
    body = (await request.json()) as JsonRpcRequest;
    if (body.jsonrpc !== "2.0" || typeof body.method !== "string") return rpcError(body.id, -32600, "Invalid Request");

    if (body.method === "initialize") {
      const requested = (body.params?.protocolVersion as string | undefined) ?? LEGACY_PROTOCOL;
      const protocolVersion = requested === MODERN_PROTOCOL ? LEGACY_PROTOCOL : requested;
      return rpcResult(body.id, { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO });
    }
    if (body.method === "server/discover") {
      return rpcResult(body.id, { protocolVersion: MODERN_PROTOCOL, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO });
    }
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (body.method === "ping") return rpcResult(body.id, {});
    if (body.method === "tools/list") return rpcResult(body.id, { tools: mcpTools });
    if (body.method === "tools/call") {
      const name = body.params?.name;
      const args = body.params?.arguments;
      if (typeof name !== "string" || (args !== undefined && (typeof args !== "object" || args === null || Array.isArray(args)))) {
        return rpcError(body.id, -32602, "Invalid tools/call parameters");
      }
      const runtime = options?.runtime ?? getTrainingApiRuntime();
      try {
        return rpcResult(body.id, toolEnvelope(await callTool(name, (args ?? {}) as Record<string, unknown>, body, runtime)));
      } catch (error) {
        return rpcResult(body.id, toolError(error));
      }
    }
    return rpcError(body.id, -32601, "Method not found");
  } catch (error) {
    if (error instanceof TrainingApiError) {
      return rpcError(body?.id, -32001, error.message, { code: error.code, details: error.details }, error.status);
    }
    return rpcError(body?.id, -32603, "Internal error", undefined, 500);
  }
}
