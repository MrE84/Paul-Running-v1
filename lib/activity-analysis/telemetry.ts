export type AnalysisTelemetryOperation = "projection" | "comparison" | "trends" | "weather" | "local_decode";

function safeMessage(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  // Keep logs useful without ever serialising FIT records, coordinates or request bodies.
  return value.replace(/-?\d{1,3}\.\d{4,}/g, "[coordinate]").slice(0, 240);
}

export function reportAnalysisFailure(operation: AnalysisTelemetryOperation, error: unknown, context: { activityId?: string; activityCount?: number } = {}): void {
  console.error("[activity-analysis]", {
    operation,
    activityId: context.activityId,
    activityCount: context.activityCount,
    error: safeMessage(error),
  });
}
