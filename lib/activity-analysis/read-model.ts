import type { Activity } from "../domain/contracts";
import type { ActivitySource } from "./contracts";
import { getCachedActivityAnalysisProjection } from "./cache";

function stringMetadata(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}

export function activitySourceFromCanonical(activity: Activity): ActivitySource {
  const externalId = stringMetadata(activity.sourceMetadata.externalId);
  const sourceFileUrl = stringMetadata(activity.sourceMetadata.sourceFileUrl);
  return {
    id: activity.id,
    name: activity.sourceFileName ?? `${externalId ?? activity.id}.fit`,
    origin: "backend",
    externalId,
    sourceFileUrl,
  };
}

export function buildCanonicalActivityAnalysisReadModel(activity: Activity) {
  const source = activitySourceFromCanonical(activity);
  const projection = getCachedActivityAnalysisProjection(source, activity.normalizedData);
  return {
    activity: {
      id: activity.id,
      athleteId: activity.athleteId,
      calendarItemId: activity.calendarItemId,
      sport: activity.sport,
      startedAt: activity.startedAt,
      endedAt: activity.endedAt,
      summary: activity.summary,
      sourceFileName: activity.sourceFileName,
      sourceMetadata: {
        externalId: source.externalId,
        sourceFileUrl: source.sourceFileUrl,
      },
    },
    projection,
  };
}
