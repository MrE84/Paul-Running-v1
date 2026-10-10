import type { Activity } from "./domain/contracts";

export type ShoeKey = "adidas-evo-sl" | "puma-deviate-nitro-3-hyrox" | "asics-metaspeed-sky-tokyo";

export interface ShoeDefinition {
  key: ShoeKey;
  brand: string;
  model: string;
  shortName: string;
  role: string;
  aliases: readonly string[];
  reviewAtKm?: number;
  note: string;
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
    reviewAtKm: 400,
    note: "Primary mileage shoe. Start assessing loss of responsiveness from roughly 350–400 km; it can stay in easy/general use if it still feels comfortable.",
  },
  {
    key: "puma-deviate-nitro-3-hyrox",
    brand: "PUMA",
    model: "Deviate NITRO 3 HYROX",
    shortName: "Deviate NITRO 3 HYROX",
    role: "Threshold, tempo, progression, HM-pace work, intervals and controlled fast parkruns",
    aliases: ["deviate nitro 3 hyrox", "deviate nitro 3", "puma hyrox", "hyrox"],
    note: "Middle-fast training shoe. Use it to absorb repeated quality-session mileage instead of spending race-shoe kilometres.",
  },
  {
    key: "asics-metaspeed-sky-tokyo",
    brand: "ASICS",
    model: "Metaspeed Sky Tokyo",
    shortName: "Metaspeed Sky Tokyo",
    role: "5K/10K PB attempts, benchmark races, key race rehearsals and half-marathon racing",
    aliases: ["metaspeed sky tokyo", "metaspeed sky", "sky tokyo", "tokyo drift"],
    note: "Race shoe. Keep routine training mileage low and use it when the session is testing performance or rehearsing race execution.",
  },
] as const;

const shoeByKey = new Map<ShoeKey, ShoeDefinition>(SHOE_ROTATION.map((shoe) => [shoe.key, shoe]));

export function getShoe(key: ShoeKey | null | undefined): ShoeDefinition | undefined {
  return key ? shoeByKey.get(key) : undefined;
}

export function prescribedShoeKeyForTitle(title: string): ShoeKey | null {
  const value = title.toLowerCase().replace(/[–—]/g, "-");
  if (!value.trim()) return null;

  if (/(strength|wattbike|cycling|bike|mobility|rest|walk)/.test(value)) return null;

  // Performance tests and races take priority over generic parkrun/pace keywords.
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

export type ShoeAssignmentSource = "activity_metadata" | "planned_session" | "activity_name";

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
): ShoeActivityAssignment | undefined {
  if (activity.sport !== "running") return undefined;
  if (localDateKey(activity.startedAt, timeZone) < SHOE_TRACKING_START_LOCAL_DATE) return undefined;

  const distanceKm = Math.max(0, Number(activity.summary.distanceMeters ?? 0)) / 1000;
  const metadataShoe = shoeKeyFromActivityMetadata(activity);
  if (metadataShoe) {
    return { activityId: activity.id, startedAt: activity.startedAt, distanceKm, shoeKey: metadataShoe, source: "activity_metadata" };
  }

  const session = matchActivityToPlannedSession(activity, sessions, timeZone);
  const sessionShoe = session ? prescribedShoeKeyForTitle(session.title) : null;
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

export interface ShoeUsageSummary {
  shoe: ShoeDefinition;
  distanceKm: number;
  distanceMiles: number;
  activityCount: number;
}

export function buildShoeUsage(
  activities: readonly Activity[],
  sessions: readonly PlannedShoeSession[],
  timeZone = "Europe/London",
): { summaries: ShoeUsageSummary[]; assignments: ShoeActivityAssignment[]; unassignedRuns: number } {
  const assignments = activities
    .map((activity) => assignActivityShoe(activity, sessions, timeZone))
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
    const distanceKm = shoeAssignments.reduce((sum, item) => sum + item.distanceKm, 0);
    return {
      shoe,
      distanceKm,
      distanceMiles: distanceKm * 0.621371,
      activityCount: shoeAssignments.length,
    };
  });

  return { summaries, assignments, unassignedRuns };
}
