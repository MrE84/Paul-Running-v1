import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import {
  analyseFitBytes,
  normaliseDate,
  safeNumber,
  serialisable,
  type AnalysedActivity,
} from "../activity-analysis";
import type { Activity, ExternalActivityEnvelope } from "../domain/contracts";
import type { TrainingApiStore } from "../training-api/contracts";
import { ActivityImportCoordinator } from "./coordinator";
import type {
  ActivityImportBatchResult,
  ActivityImportSink,
  IntegrationRuntime,
  IntegrationStateStore,
} from "./contracts";
import { IntervalsIcuClient } from "./intervals-icu/client";
import { IntervalsIcuActivityImportConnector } from "./intervals-icu/connector";

export interface ProductionActivityImporterConfig {
  store: TrainingApiStore;
  state: IntegrationStateStore;
  runtime: IntegrationRuntime;
  apiKey: string;
  athleteId: string;
  intervalsAthleteId?: string;
  fetchImpl?: typeof fetch;
  defaultLookbackDays?: number;
  pageDays?: number;
  analyseFit?: (
    bytes: Uint8Array,
    activity: ExternalActivityEnvelope,
  ) => Promise<AnalysedActivity>;
}

export interface ProductionActivityImportResult extends ActivityImportBatchResult {
  pagesProcessed: number;
  imported: number;
  alreadyImported: number;
  failed: number;
}

function fitBytes(raw: Uint8Array): Uint8Array {
  if (raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b) {
    return new Uint8Array(gunzipSync(raw));
  }
  return raw;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function optionalNumber(value: unknown): number | undefined {
  const number = safeNumber(value);
  return number === null ? undefined : number;
}

export class ProductionActivityImporter {
  private readonly store: TrainingApiStore;
  private readonly runtime: IntegrationRuntime;
  private readonly athleteId: string;
  private readonly client: IntervalsIcuClient;
  private readonly coordinator: ActivityImportCoordinator;
  private readonly analyseFit: (
    bytes: Uint8Array,
    activity: ExternalActivityEnvelope,
  ) => Promise<AnalysedActivity>;

  constructor(config: ProductionActivityImporterConfig) {
    this.store = config.store;
    this.runtime = config.runtime;
    this.athleteId = config.athleteId;
    this.client = new IntervalsIcuClient({
      auth: { type: "api_key", apiKey: config.apiKey },
      athleteId: config.intervalsAthleteId ?? "0",
      fetchImpl: config.fetchImpl,
    });
    this.analyseFit = config.analyseFit ?? (async (bytes, activity) =>
      analyseFitBytes({
        bytes,
        source: {
          id: activity.externalId,
          name: `${activity.externalId}.fit`,
          origin: "backend",
          externalId: activity.externalId,
          sourceFileUrl: activity.sourceFileUrl,
        },
      }));

    const connector = new IntervalsIcuActivityImportConnector({
      client: this.client,
      defaultLookbackDays: config.defaultLookbackDays ?? 14,
      pageDays: config.pageDays ?? 15,
    });

    const sink: ActivityImportSink = {
      ingest: async ({ athleteId, provider, activity }) => {
        const rawFile = await this.client.downloadActivityFile(activity.externalId);
        const decodedBytes = fitBytes(rawFile.data);
        const analysed = await this.analyseFit(decodedBytes, activity);
        const now = this.runtime.now();
        const startedAt = normaliseDate(analysed.summary.start)?.toISOString() ?? activity.startedAt;
        const endedAt = normaliseDate(analysed.summary.end)?.toISOString();
        const session = analysed.summary.session;
        const avgSpeed = analysed.summary.avgSpeed;
        const normalizedData = asRecord(serialisable(analysed.parsed));

        const persisted: Activity = {
          id: this.runtime.idFactory(),
          athleteId,
          sport: activity.sport,
          startedAt,
          endedAt,
          summary: {
            durationSeconds: analysed.summary.timerTime ?? undefined,
            distanceMeters: analysed.summary.distance ?? undefined,
            avgHrBpm: optionalNumber(session.avg_heart_rate),
            maxHrBpm: optionalNumber(session.max_heart_rate),
            avgPaceSecPerKm: avgSpeed !== null && avgSpeed > 0 ? 1000 / avgSpeed : undefined,
            avgCadenceSpm: analysed.summary.avgCadence ?? undefined,
            elevationGainMeters: analysed.summary.totalAscent ?? undefined,
          },
          normalizedData,
          sourceFileName: `${activity.externalId}.fit`,
          sourceFileSha256: createHash("sha256").update(rawFile.data).digest("hex"),
          sourceMetadata: {
            provider,
            externalId: activity.externalId,
            sourceFileUrl: activity.sourceFileUrl,
            intervalsActivity: serialisable(activity.sourceMetadata),
            fileRateLimit: rawFile.rateLimit,
          },
          createdAt: now,
          updatedAt: now,
        };
        await this.store.saveActivity(persisted);
        return { activityId: persisted.id };
      },
    };

    this.coordinator = new ActivityImportCoordinator({
      athleteId: config.athleteId,
      connector,
      state: config.state,
      sink,
      runtime: config.runtime,
    });
  }

  async importRecent(maxPages = 1): Promise<ProductionActivityImportResult> {
    const pages = Math.min(3, Math.max(1, Math.floor(maxPages)));
    return this.store.withIdempotencyLock(
      `intervals_icu:activity_import:${this.athleteId}`,
      async () => {
        const items: ActivityImportBatchResult["items"] = [];
        let cursor: string | undefined;
        let pagesProcessed = 0;

        do {
          const batch = await this.coordinator.importNextPage(cursor);
          items.push(...batch.items);
          cursor = batch.nextCursor;
          pagesProcessed += 1;
        } while (cursor && pagesProcessed < pages);

        return {
          items,
          nextCursor: cursor,
          pagesProcessed,
          imported: items.filter((item) => item.status === "imported").length,
          alreadyImported: items.filter((item) => item.status === "already_imported").length,
          failed: items.filter((item) => item.status === "failed").length,
        };
      },
    );
  }
}
