import { timingSafeEqual } from "node:crypto";
import { nearestIndex, type AnalysisProjection } from "../activity-analysis/projection";
import { getTrainingApiRuntime, type TrainingApiRuntimeBundle } from "../training-api/runtime";
import { TrainingApiError } from "../training-api/service";

const SERVER_INFO = { name: "pauls-running-activity", version: "1.0.0" } as const;
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
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
    },
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

function argString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) throw new TrainingApiError(400, "VALIDATION_FAILED", `${key} is required.`);
  return value.trim();
}

function optionalBoolean(args: Record<string, unknown>, key: string): boolean {
  const value = args[key];
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw new TrainingApiError(400, "VALIDATION_FAILED", `${key} must be a boolean.`);
  return value;
}

function boundedInteger(args: Record<string, unknown>, key: string, fallback: number, min: number, max: number): number {
  const value = args[key];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new TrainingApiError(400, "VALIDATION_FAILED", `${key} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

function finiteNumber(args: Record<string, unknown>, key: string): number {
  const value = args[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TrainingApiError(400, "VALIDATION_FAILED", `${key} must be a non-negative number.`);
  }
  return value;
}

export const activityMcpTools = [
  {
    name: "list_activities",
    description: "List recent completed activities for the primary athlete, including readiness and summary metadata.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { limit: { type: "integer", minimum: 1, maximum: 100, default: 40 } },
    },
  },
  {
    name: "get_activity_analysis",
    description: "Read the complete versioned activity-analysis projection, including every available elapsed-time sample, GPS coordinate, distance sample and physiological/dynamics channel such as heart rate, pace, speed, elevation and cadence.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["activityId"],
      properties: {
        activityId: { type: "string" },
        recompute: { type: "boolean", default: false },
      },
    },
  },
  {
    name: "get_activity_raw",
    description: "Read the stored decoded FIT payload for one completed activity. This is the raw normalized source behind the activity-analysis projection.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["activityId"],
      properties: { activityId: { type: "string" } },
    },
  },
  {
    name: "get_activity_sample",
    description: "Return the nearest recorded sample to a requested elapsed time, including HR, pace, speed, elevation, cadence, GPS, distance and every other channel available at that sample.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["activityId", "elapsedSeconds"],
      properties: {
        activityId: { type: "string" },
        elapsedSeconds: { type: "number", minimum: 0 },
      },
    },
  },
] as const;

function sampleAt(projection: AnalysisProjection, requestedElapsedSeconds: number) {
  if (!projection.streams.elapsed.length) {
    throw new TrainingApiError(409, "ACTIVITY_SAMPLES_UNAVAILABLE", "This activity does not contain sample-level data.");
  }
  const index = nearestIndex(projection.streams.elapsed, requestedElapsedSeconds);
  const elapsedSeconds = projection.streams.elapsed[index] ?? null;
  const channels = Object.fromEntries(
    Object.entries(projection.streams.channels).map(([key, values]) => [key, values?.[index] ?? null]),
  );
  return {
    activityId: projection.activity.id,
    activityTitle: projection.activity.title,
    index,
    requestedElapsedSeconds,
    elapsedSeconds,
    deltaSeconds: elapsedSeconds === null ? null : Math.round((elapsedSeconds - requestedElapsedSeconds) * 1000) / 1000,
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
  };
}

async function callTool(name: string, args: Record<string, unknown>, runtime: TrainingApiRuntimeBundle) {
  const service = runtime.service;
  switch (name) {
    case "list_activities":
      return service.listActivitySummaries(runtime.primaryAthleteId, boundedInteger(args, "limit", 40, 1, 100));
    case "get_activity_analysis":
      return service.getActivityAnalysis(runtime.primaryAthleteId, argString(args, "activityId"), optionalBoolean(args, "recompute"));
    case "get_activity_raw": {
      const activity = await service.getActivity(runtime.primaryAthleteId, argString(args, "activityId"));
      return {
        activity: {
          id: activity.id,
          athleteId: activity.athleteId,
          sport: activity.sport,
          startedAt: activity.startedAt,
          sourceFileName: activity.sourceFileName,
          sourceMetadata: activity.sourceMetadata,
        },
        normalizedData: activity.normalizedData,
      };
    }
    case "get_activity_sample": {
      const projection = await service.getActivityAnalysis(runtime.primaryAthleteId, argString(args, "activityId"), false);
      return sampleAt(projection, finiteNumber(args, "elapsedSeconds"));
    }
    default:
      throw new TrainingApiError(404, "TOOL_NOT_FOUND", `Unknown activity MCP tool ${name}.`);
  }
}

function toolEnvelope(value: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value };
}

function toolError(error: unknown) {
  if (error instanceof TrainingApiError) {
    const value = { error: { code: error.code, message: error.message, details: error.details } };
    return { ...toolEnvelope(value), isError: true };
  }
  const value = { error: { code: "INTERNAL_ERROR", message: "The Paul’s Running activity MCP bridge could not complete the tool call." } };
  return { ...toolEnvelope(value), isError: true };
}

export async function handleActivityMcpRequest(request: Request, options?: BridgeOptions): Promise<Response> {
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
    if (body.method === "tools/list") return rpcResult(body.id, { tools: activityMcpTools });
    if (body.method === "tools/call") {
      const name = body.params?.name;
      const args = body.params?.arguments;
      if (typeof name !== "string" || (args !== undefined && (args === null || Array.isArray(args) || typeof args !== "object"))) {
        return rpcError(body.id, -32602, "Invalid params");
      }
      const runtime = options?.runtime ?? getTrainingApiRuntime();
      try {
        return rpcResult(body.id, toolEnvelope(await callTool(name, (args ?? {}) as Record<string, unknown>, runtime)));
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
