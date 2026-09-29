import type { IntervalsIcuActivityStream } from "../integrations/intervals-icu/client";
import { nearestIndex, type AnalysisProjection } from "./projection";

/**
 * PAU-47: compare Intervals.icu provider streams with the canonical
 * FIT-derived projection. Read-only: the canonical projection is never
 * modified; the provider stream is treated as verification/enrichment only.
 */
export const COMPARED_HEART_RATE_STREAMS = ["heartrate", "raw_heartrate", "fixed_heartrate"] as const;
export type ComparedHeartRateStream = (typeof COMPARED_HEART_RATE_STREAMS)[number];

export interface StreamComparison {
  stream: ComparedHeartRateStream;
  available: boolean;
  providerSamples: number;
  alignedSamples: number;
  meanAbsoluteDiffBpm: number | null;
  maxAbsoluteDiffBpm: number | null;
  withinOneBpmPercent: number | null;
  providerPeakBpm: number | null;
  canonicalPeakBpm: number | null;
}

export interface ProviderStreamComparison {
  activityId: string;
  providerActivityId: string;
  canonicalSource: "fit";
  canonicalModified: false;
  canonicalSamples: number;
  providerTimeSamples: number;
  rawHeartRateAvailable: boolean;
  heartRate: StreamComparison[];
}

const MAX_ALIGNMENT_GAP_SECONDS = 1;

function numbers(values: unknown[] | undefined): Array<number | null> {
  return (values ?? []).map((value) => (typeof value === "number" && Number.isFinite(value) ? value : null));
}

function streamByType(streams: IntervalsIcuActivityStream[], type: string): IntervalsIcuActivityStream | undefined {
  return streams.find((stream) => stream.type === type);
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function peak(values: Array<number | null | undefined>): number | null {
  let result: number | null = null;
  for (const value of values) if (typeof value === "number" && (result === null || value > result)) result = value;
  return result;
}

export function compareProviderStreams(
  projection: AnalysisProjection,
  providerActivityId: string,
  streams: IntervalsIcuActivityStream[],
): ProviderStreamComparison {
  const elapsed = projection.streams.elapsed;
  const canonicalHr = projection.streams.channels.heart_rate ?? [];
  const time = numbers(streamByType(streams, "time")?.data);

  const heartRate = COMPARED_HEART_RATE_STREAMS.map((type): StreamComparison => {
    const values = numbers(streamByType(streams, type)?.data);
    const available = values.some((value) => value !== null);
    const diffs: number[] = [];
    if (available && elapsed.length && canonicalHr.length) {
      values.forEach((value, i) => {
        const seconds = time[i];
        if (value === null || seconds === null || seconds === undefined) return;
        const index = nearestIndex(elapsed, seconds);
        if (Math.abs(elapsed[index] - seconds) > MAX_ALIGNMENT_GAP_SECONDS) return;
        const canonical = canonicalHr[index];
        if (typeof canonical !== "number") return;
        diffs.push(Math.abs(value - canonical));
      });
    }
    return {
      stream: type,
      available,
      providerSamples: values.filter((value) => value !== null).length,
      alignedSamples: diffs.length,
      meanAbsoluteDiffBpm: diffs.length ? round(diffs.reduce((sum, d) => sum + d, 0) / diffs.length) : null,
      maxAbsoluteDiffBpm: diffs.length ? round(Math.max(...diffs)) : null,
      withinOneBpmPercent: diffs.length ? round((100 * diffs.filter((d) => d <= 1).length) / diffs.length, 1) : null,
      providerPeakBpm: peak(values),
      canonicalPeakBpm: peak(canonicalHr),
    };
  });

  return {
    activityId: projection.activity.id,
    providerActivityId,
    canonicalSource: "fit",
    canonicalModified: false,
    canonicalSamples: elapsed.length,
    providerTimeSamples: time.length,
    rawHeartRateAvailable: heartRate.some((entry) => entry.stream === "raw_heartrate" && entry.available),
    heartRate,
  };
}
