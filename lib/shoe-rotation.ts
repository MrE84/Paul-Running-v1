import type { Activity } from "./domain/contracts";

export type ShoeKey = "adidas-evo-sl" | "puma-deviate-nitro-3-hyrox" | "asics-metaspeed-sky-tokyo";
export type ShoeLifeStatus = "healthy" | "review_soon" | "review_due" | "replace_soon" | "replace_due";

export interface ShoeDefinition {
  key: ShoeKey;
  brand: string;
  model: string;
  shortName: string;
  role: string;
  aliases: readonly string[];
  estimatedHistoricalKm: number;
  historicalBasis: string;
  reviewAtKm: number;
  replaceAtKm: number;
  note: string;
}

export interface ActivityShoeOverride {
  activityId: string;
  athleteId: string;
  shoeKey: ShoeKey | null;
  updatedAt: string;
}

export const SHOE_TRACKING_START_LOCAL_DATE = "2026-10-10";

export const SHOE_ROTATION: readonly ShoeDefinition[] = [
  {
    key: "adidas-evo-sl",
    brand: "adidas",
    model: "Adizero Evo SL",
    shortName: "Evo SL",
    role: "Easy, aerobic, long and recovery running; easy runs with strides",
    aliases: ["adizero evo sl", "evo sl", "adidas evo sl"],
    estimatedHistoricalKm: 186.98,
    historicalBasis: "Estimated from Tredict running history from the first post-order training period through 9 Oct 2026. Paul reported the Evo SL handled essentially all training; 20.98 km Cheltenham Half + ~10 km other confirmed/remembered Sky use are excluded.",
    reviewAtKm: 400,
    replaceAtKm: 550,
    note: "Primary mileage shoe. Start assessing loss of responsiveness from roughly 350–400 km. Around 550 km is a planning point to replace or demote it if the foam/ride is clearly flatter, rather than a hard failure limit.",
  },
  {
    key: "puma-deviate-nitro-3-hyrox",
    brand: "PUMA",
    model: "Deviate NITRO 3 HYROX",
    shortName: "Deviate NITRO 3 HYROX",
    role: "Threshold, tempo, progression, HM-pace work, intervals and controlled fast parkruns",
    aliases: ["deviate nitro 3 hyrox", "deviate nitro 3", "puma hyrox", "hyrox"],
    estimatedHistoricalKm: 0,
    historicalBasis: "No confirmed pre-10 Oct 2026 running mileage was found, so no historical distance is invented. Automatic tracking carries it forward from zero until better evidence is available.",
    reviewAtKm: 500,
    replaceAtKm: 650,
    note: "Middle-fast training shoe. Review the plate/foam feel around 500 km and use ~650 km as a planning point for replacement or demotion if responsiveness or comfort has materially declined.",
  },
  {
    key: "asics-metaspeed-sky-tokyo",
    brand: "ASICS",
    model: "Metaspeed Sky Tokyo",
    shortName: "Metaspeed Sky Tokyo",
    role: "5K/10K PB attempts, benchmark races, key race rehearsals and half-marathon racing",
    aliases: ["metaspeed sky tokyo", "metaspeed sky", "sky tokyo", "tokyo drift"],
    estimatedHistoricalKm: 30.98,
    historicalBasis: "Estimated as the recorded 20.98 km Cheltenham Half Marathon on 20 Sep 2026 plus ~10 km of additional remembered pre-race/race use. This is deliberately labelled as an estimate.",
    reviewAtKm: 150,
    replaceAtKm: 250,
    note: "Race shoe. Review race-day pop and stability from ~150 km. Around 250 km is a conservative planning point to demote it from key racing if performance has faded; it may remain usable for training beyond that.",
  },
] as const;

export const CONFIRMED_SHOE_BY_LOCAL_DATE: Readonly<Record<string, ShoeKey>> = {
  "2026-10-10": "puma-deviate-nitro-3-hyrox",
};

const shoeByKey = new Map<ShoeKey, ShoeDefinition>(SHOE_ROTATION.map((shoe) => [shoe.key, shoe]));

export function getShoe(key: ShoeKey | null | undefined): ShoeDefinition | undefined {
  return key ? shoeByKey.get(key) : undefined;
}

export function prescribedShoeKeyForTitle(title: string): ShoeKey | null {
  const value = title.toLowerCase().replace(/[–—]/g, "-");
  if (!value.trim()) return null;

  if (/(strength|wattbike|cycling|bike|mobility|rest|walk)/.test(value)) return null;

  if (/(benchmark|pb attempt|time trial|all[- ]out|race day|cotswold airport|goal race)/.test(value)) {
    return "asics-metaspeed-sky-tokyo";
  }

  if (/(threshold|tempo|progress|hm pace|half[- ]marathon pace|interval|cruise|10k pace|5k pace|fartlek|parkrun)/.test(value)) {
    return "puma-deviate-nitro-3-hyrox";
  }

  if (/(long|easy|recovery|aerobic|strides|shakeout|base)/.test(value)) {
    return "adidas-evo-sl";
  }

  return null;
}

export function prescribedShoeForTitle(title: string): ShoeDefinition | undefined {
  return getShoe(prescribedShoeKeyForTitle(title));
}

function serialisedMetadata(activity: Pick<Activity, "sourceMetadata">): string {
  try {
    return JSON.stringify(activity.sourceMetadata ?? {}).toLowerCase();
  } catch {
    return "";
  }
}

export function shoeKeyFromActivityMetadata(activity: Pick<Activity, "sourceMetadata">): ShoeKey | null {
  const metadata = serialisedMetadata(activity);
  if (!metadata) return null;
  for (const shoe of SHOE_ROTATION) {
    if (shoe.aliases.some((alias) => metadata.includes(alias.toLowerCase()))) return shoe.key;
  }
  return null;
}

function activityNameFromMetadata(activity: Pick<Activity, "sourceMetadata" | "sourceFileName">): string | undefined {
  const metadata = activity.sourceMetadata ?? {};
  const direct = [metadata.name, metadata.title, metadata.activityName];
  for (const value of direct) if (typeof value === "string" && value.trim()) return value.trim();

  const intervals = metadata.intervalsActivity;
  if (intervals && typeof intervals === "object" && !Array.isArray(intervals)) {
    const record = intervals as Record<string, unknown>;
    for (const value of [record.name, record.title, record.activityName]) {
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return activity.sourceFileName;
}

export interface PlannedShoeSession {
  id: string;
  scheduledStart: string;
  timezone?: string;
  title: string;
}

function localDateKey(iso: string, timeZone = "Europe/London"): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function matchActivityToPlannedSession(
  activity: Pick<Activity, "startedAt">,
  sessions: readonly PlannedShoeSession[],
  timeZone = "Europe/London",
): PlannedShoeSession | undefined {
  const activityDate = localDateKey(activity.startedAt, timeZone);
  const activityMs = Date.parse(activity.startedAt);
  return sessions
    .filter((session) => localDateKey(session.scheduledStart, session.timezone ?? timeZone) === activityDate)
    .filter((session) => prescribedShoeKeyForTitle(session.title) !== null)
    .map((session) => ({ session, distance: Math.abs(Date.parse(session.scheduledStart) - activityMs) }))
    .sort((a, b) => a.distance - b.distance)[0]?.session;
}

export type ShoeAssignmentSource = "manual_override" | "confirmed_user" | "activity_metadata" | "planned_session" | "activity_name";

export interface ShoeActivityAssignment {
  activityId: string;
  startedAt: string;
  distanceKm: number;
  shoeKey: ShoeKey;
  source: ShoeAssignmentSource;
  sessionTitle?: string;
}

export function assignActivityShoe(
  activity: Activity,
  sessions: readonly PlannedShoeSession[],
  timeZone = "Europe/London",
  overrides: ReadonlyMap<string, ShoeKey | null> = new Map(),
): ShoeActivityAssignment | undefined {
  if (activity.sport !== "running") return undefined;
  const activityDate = localDateKey(activity.startedAt, timeZone);
  if (activityDate < SHOE_TRACKING_START_LOCAL_DATE) return undefined;

  const distanceKm = Math.max(0, Number(activity.summary.distanceMeters ?? 0)) / 1000;
  const manualShoe = overrides.get(activity.id);
  if (manualShoe) {
    return {
      activityId: activity.id,
      startedAt: activity.startedAt,
      distanceKm,
      shoeKey: manualShoe,
      source: "manual_override",
      sessionTitle: activityNameFromMetadata(activity),
    };
  }

  const confirmedShoe = CONFIRMED_SHOE_BY_LOCAL_DATE[activityDate];
  if (confirmedShoe) {
    return {
      activityId: activity.id,
      startedAt: activity.startedAt,
      distanceKm,
      shoeKey: confirmedShoe,
      source: "confirmed_user",
      sessionTitle: activityNameFromMetadata(activity),
    };
  }

  const metadataShoe = shoeKeyFromActivityMetadata(activity);
  if (metadataShoe) {
    return { activityId: activity.id, startedAt: activity.startedAt, distanceKm, shoeKey: metadataShoe, source: "activity_metadata" };
  }

  const session = matchActivityToPlannedSession(activity, sessions, timeZone);
  if (session) {
    const sessionShoe = prescribedShoeKeyForTitle(session.title);
    if (sessionShoe) {
      return {
        activityId: activity.id,
        startedAt: activity.startedAt,
        distanceKm,
        shoeKey: sessionShoe,
        source: "planned_session",
        sessionTitle: session.title,
      };
    }
  }

  const activityName = activityNameFromMetadata(activity);
  const inferred = activityName ? prescribedShoeKeyForTitle(activityName) : null;
  if (inferred) {
    return {
      activityId: activity.id,
      startedAt: activity.startedAt,
      distanceKm,
      shoeKey: inferred,
      source: "activity_name",
      sessionTitle: activityName,
    };
  }
  return undefined;
}

function lifeStatus(shoe: ShoeDefinition, totalDistanceKm: number): ShoeLifeStatus {
  if (totalDistanceKm >= shoe.replaceAtKm) return "replace_due";
  if (shoe.replaceAtKm - totalDistanceKm <= 50) return "replace_soon";
  if (totalDistanceKm >= shoe.reviewAtKm) return "review_due";
  if (shoe.reviewAtKm - totalDistanceKm <= 50) return "review_soon";
  return "healthy";
}

function projectedDate(
  remainingKm: number,
  assignments: readonly ShoeActivityAssignment[],
  nowIso: string,
): string | undefined {
  if (remainingKm <= 0 || assignments.length < 3) return undefined;
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) return undefined;
  const cutoffMs = nowMs - 28 * 86400000;
  const recent = assignments.filter((item) => {
    const startedMs = Date.parse(item.startedAt);
    return Number.isFinite(startedMs) && startedMs >= cutoffMs && startedMs <= nowMs;
  });
  if (recent.length < 3) return undefined;
  const oldestMs = Math.min(...recent.map((item) => Date.parse(item.startedAt)));
  const spanDays = (nowMs - oldestMs) / 86400000;
  if (spanDays < 14) return undefined;
  const recentKm = recent.reduce((sum, item) => sum + item.distanceKm, 0);
  const weeklyKm = recentKm / (spanDays / 7);
  if (!Number.isFinite(weeklyKm) || weeklyKm <= 0) return undefined;
  const daysRemaining = (remainingKm / weeklyKm) * 7;
  return new Date(nowMs + daysRemaining * 86400000).toISOString();
}

export interface ShoeUsageSummary {
  shoe: ShoeDefinition;
  estimatedHistoricalKm: number;
  trackedDistanceKm: number;
  totalDistanceKm: number;
  totalDistanceMiles: number;
  activityCount: number;
  remainingToReviewKm: number;
  remainingToReplaceKm: number;
  status: ShoeLifeStatus;
  projectedReviewDate?: string;
  projectedReplaceDate?: string;
}

export function buildShoeUsage(
  activities: readonly Activity[],
  sessions: readonly PlannedShoeSession[],
  timeZone = "Europe/London",
  nowIso = new Date().toISOString(),
  overrides: readonly ActivityShoeOverride[] = [],
): { summaries: ShoeUsageSummary[]; assignments: ShoeActivityAssignment[]; unassignedRuns: number } {
  const overrideMap = new Map<string, ShoeKey | null>(overrides.map((item) => [item.activityId, item.shoeKey]));
  const assignments = activities
    .map((activity) => assignActivityShoe(activity, sessions, timeZone, overrideMap))
    .filter((item): item is ShoeActivityAssignment => Boolean(item))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  const assignedIds = new Set(assignments.map((item) => item.activityId));
  const unassignedRuns = activities.filter(
    (activity) => activity.sport === "running" &&
      localDateKey(activity.startedAt, timeZone) >= SHOE_TRACKING_START_LOCAL_DATE &&
      !assignedIds.has(activity.id),
  ).length;

  const summaries = SHOE_ROTATION.map((shoe) => {
    const shoeAssignments = assignments.filter((item) => item.shoeKey === shoe.key);
    const trackedDistanceKm = shoeAssignments.reduce((sum, item) => sum + item.distanceKm, 0);
    const totalDistanceKm = shoe.estimatedHistoricalKm + trackedDistanceKm;
    const remainingToReviewKm = Math.max(0, shoe.reviewAtKm - totalDistanceKm);
    const remainingToReplaceKm = Math.max(0, shoe.replaceAtKm - totalDistanceKm);
    return {
      shoe,
      estimatedHistoricalKm: shoe.estimatedHistoricalKm,
      trackedDistanceKm,
      totalDistanceKm,
      totalDistanceMiles: totalDistanceKm * 0.621371,
      activityCount: shoeAssignments.length,
      remainingToReviewKm,
      remainingToReplaceKm,
      status: lifeStatus(shoe, totalDistanceKm),
      projectedReviewDate: projectedDate(remainingToReviewKm, shoeAssignments, nowIso),
      projectedReplaceDate: projectedDate(remainingToReplaceKm, shoeAssignments, nowIso),
    };
  });

  return { summaries, assignments, unassignedRuns };
}
