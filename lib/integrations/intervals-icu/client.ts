export type IntervalsIcuAuth =
  | { type: "api_key"; apiKey: string }
  | { type: "oauth"; accessToken: string };

export interface IntervalsIcuClientConfig {
  auth: IntervalsIcuAuth;
  athleteId?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  nowMillis?: () => number;
}

export interface IntervalsIcuRateLimitSnapshot {
  limit?: string;
  remaining?: string;
  retryAfterSeconds?: number;
}

export interface IntervalsIcuResponse<T> {
  data: T;
  rateLimit: IntervalsIcuRateLimitSnapshot;
}

export interface IntervalsIcuEventPayload {
  category: "WORKOUT";
  start_date_local: string;
  type: string;
  name: string;
  description: string;
  external_id: string;
}

export interface IntervalsIcuWorkoutDoc extends Record<string, unknown> {
  steps?: unknown[];
}

export interface IntervalsIcuEventResponse extends Record<string, unknown> {
  id: string | number;
  external_id?: string;
  workout_doc?: IntervalsIcuWorkoutDoc;
}

export interface IntervalsIcuActivityResponse extends Record<string, unknown> {
  id: string | number;
  type?: string;
  start_date?: string;
  start_date_local?: string;
  file_type?: string;
}

export interface IntervalsIcuActivityStream extends Record<string, unknown> {
  type?: string;
  name?: string;
  valueType?: string;
  data?: unknown[];
  data2?: unknown[];
}

export interface IntervalsIcuActivityIntervalsResponse extends Record<string, unknown> {
  icu_intervals?: unknown[];
  icu_groups?: unknown[];
}

/**
 * Explicitly request raw/fixed HR rather than relying on Intervals.icu's default
 * stream set. Intervals can expose corrected `heartrate` separately from the
 * original `raw_heartrate`, which matters when validating clipped HR peaks.
 */
export const DEFAULT_INTERVALS_ACTIVITY_STREAM_TYPES = [
  "time",
  "watts",
  "heartrate",
  "raw_heartrate",
  "fixed_heartrate",
  "cadence",
  "altitude",
  "distance",
  "velocity_smooth",
  "latlng",
  "temp",
  "moving",
  "grade_smooth",
] as const;

export function intervalsEventHasParsedWorkout(event: IntervalsIcuEventResponse): boolean {
  return Array.isArray(event.workout_doc?.steps) && event.workout_doc.steps.length > 0;
}

export class IntervalsIcuHttpError extends Error {
  readonly status: number;
  readonly responseBody?: string;
  readonly retryAfterSeconds?: number;
  readonly rateLimit: IntervalsIcuRateLimitSnapshot;

  constructor(input: {
    status: number;
    message: string;
    responseBody?: string;
    retryAfterSeconds?: number;
    rateLimit?: IntervalsIcuRateLimitSnapshot;
  }) {
    super(input.message);
    this.name = "IntervalsIcuHttpError";
    this.status = input.status;
    this.responseBody = input.responseBody;
    this.retryAfterSeconds = input.retryAfterSeconds;
    this.rateLimit = input.rateLimit ?? {};
  }
}

function parseRetryAfter(value: string | null, nowMillis: number): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const retryAt = Date.parse(value);
  if (!Number.isFinite(retryAt)) return undefined;
  return Math.max(0, Math.ceil((retryAt - nowMillis) / 1000));
}

function rateLimitFromHeaders(headers: Headers, nowMillis: number): IntervalsIcuRateLimitSnapshot {
  const retryAfterSeconds = parseRetryAfter(headers.get("Retry-After"), nowMillis);
  return {
    limit: headers.get("X-RateLimit-Limit") ?? undefined,
    remaining: headers.get("X-RateLimit-Remaining") ?? undefined,
    retryAfterSeconds,
  };
}

export class IntervalsIcuClient {
  readonly athleteId: string;
  readonly baseUrl: string;
  private readonly auth: IntervalsIcuAuth;
  private readonly fetchImpl: typeof fetch;
  private readonly nowMillis: () => number;

  constructor(config: IntervalsIcuClientConfig) {
    this.auth = config.auth;
    this.athleteId = config.athleteId ?? "0";
    this.baseUrl = (config.baseUrl ?? "https://intervals.icu/api/v1").replace(/\/$/, "");
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.nowMillis = config.nowMillis ?? Date.now;
  }

  private authorizationHeader(): string {
    if (this.auth.type === "oauth") return `Bearer ${this.auth.accessToken}`;
    const encoded = Buffer.from(`API_KEY:${this.auth.apiKey}`, "utf8").toString("base64");
    return `Basic ${encoded}`;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<IntervalsIcuResponse<T>> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          Authorization: this.authorizationHeader(),
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(init.headers ?? {}),
        },
      });
    } catch (error) {
      throw new IntervalsIcuHttpError({
        status: 0,
        message: `Intervals.icu network request failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    const rateLimit = rateLimitFromHeaders(response.headers, this.nowMillis());
    if (!response.ok) {
      const responseBody = await response.text().catch(() => "");
      throw new IntervalsIcuHttpError({
        status: response.status,
        message:
          response.status === 429
            ? "Intervals.icu rate limit reached."
            : `Intervals.icu request failed with HTTP ${response.status}.`,
        responseBody,
        retryAfterSeconds: rateLimit.retryAfterSeconds,
        rateLimit,
      });
    }

    if (response.status === 204) {
      return { data: undefined as T, rateLimit };
    }

    const text = await response.text();
    return {
      data: (text ? JSON.parse(text) : undefined) as T,
      rateLimit,
    };
  }

  async upsertEvents(
    events: readonly IntervalsIcuEventPayload[],
  ): Promise<IntervalsIcuResponse<IntervalsIcuEventResponse[]>> {
    return this.request<IntervalsIcuEventResponse[]>(
      `/athlete/${encodeURIComponent(this.athleteId)}/events/bulk?upsert=true`,
      { method: "POST", body: JSON.stringify(events) },
    );
  }

  async getEvent(eventId: string): Promise<IntervalsIcuResponse<IntervalsIcuEventResponse>> {
    return this.request<IntervalsIcuEventResponse>(
      `/athlete/${encodeURIComponent(this.athleteId)}/events/${encodeURIComponent(eventId)}`,
    );
  }

  async deleteEvent(eventId: string): Promise<IntervalsIcuResponse<void>> {
    return this.request<void>(
      `/athlete/${encodeURIComponent(this.athleteId)}/events/${encodeURIComponent(eventId)}`,
      { method: "DELETE" },
    );
  }

  async listActivities(input: {
    oldest: string;
    newest: string;
    limit?: number;
  }): Promise<IntervalsIcuResponse<IntervalsIcuActivityResponse[]>> {
    const params = new URLSearchParams({ oldest: input.oldest, newest: input.newest });
    if (input.limit !== undefined) params.set("limit", String(input.limit));
    return this.request<IntervalsIcuActivityResponse[]>(
      `/athlete/${encodeURIComponent(this.athleteId)}/activities?${params.toString()}`,
    );
  }

  async getActivity(
    activityId: string,
  ): Promise<IntervalsIcuResponse<IntervalsIcuActivityResponse>> {
    return this.request<IntervalsIcuActivityResponse>(
      `/activity/${encodeURIComponent(activityId)}`,
    );
  }

  async getActivityStreams(
    activityId: string,
    streamTypes: readonly string[] = DEFAULT_INTERVALS_ACTIVITY_STREAM_TYPES,
  ): Promise<IntervalsIcuResponse<IntervalsIcuActivityStream[]>> {
    const params = new URLSearchParams();
    if (streamTypes.length) params.set("types", streamTypes.join(","));
    const query = params.toString();
    return this.request<IntervalsIcuActivityStream[]>(
      `/activity/${encodeURIComponent(activityId)}/streams${query ? `?${query}` : ""}`,
    );
  }

  async getActivityIntervals(
    activityId: string,
  ): Promise<IntervalsIcuResponse<IntervalsIcuActivityIntervalsResponse>> {
    return this.request<IntervalsIcuActivityIntervalsResponse>(
      `/activity/${encodeURIComponent(activityId)}/intervals`,
    );
  }

  activityFileUrl(activityId: string): string {
    return `${this.baseUrl}/activity/${encodeURIComponent(activityId)}/file`;
  }

  async downloadActivityFile(activityId: string): Promise<IntervalsIcuResponse<Uint8Array>> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.activityFileUrl(activityId), {
        headers: {
          Accept: "application/octet-stream,application/fit,*/*",
          Authorization: this.authorizationHeader(),
        },
      });
    } catch (error) {
      throw new IntervalsIcuHttpError({
        status: 0,
        message: `Intervals.icu activity file download failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    const rateLimit = rateLimitFromHeaders(response.headers, this.nowMillis());
    if (!response.ok) {
      const responseBody = await response.text().catch(() => "");
      throw new IntervalsIcuHttpError({
        status: response.status,
        message:
          response.status === 429
            ? "Intervals.icu rate limit reached while downloading an activity file."
            : `Intervals.icu activity file download failed with HTTP ${response.status}.`,
        responseBody,
        retryAfterSeconds: rateLimit.retryAfterSeconds,
        rateLimit,
      });
    }

    return {
      data: new Uint8Array(await response.arrayBuffer()),
      rateLimit,
    };
  }
}
