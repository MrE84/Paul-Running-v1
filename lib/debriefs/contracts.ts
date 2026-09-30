/**
 * PAU-81: post-run debrief contract.
 *
 * A debrief is Paul's subjective account of one completed activity, usually captured in a
 * conversation with Claude and shown on the website beside the objective analysis. It is
 * keyed by activity id and kept separate from the activity document so re-importing or
 * repairing an activity never overwrites or orphans it.
 *
 * Debriefs can contain health-related detail (niggles, how the body felt). They are only
 * ever served through authenticated routes and their free text is never written to logs or
 * audit events.
 */

export const DEBRIEF_SOURCES = ["voice-chat", "text-chat", "web-edit"] as const;
export type DebriefSource = (typeof DEBRIEF_SOURCES)[number];

/** Free-text fields, in the order they are shown on the website. */
export const DEBRIEF_TEXT_FIELDS = ["bodyFeel", "mentalState", "context", "planNotes", "learnings"] as const;
export type DebriefTextField = (typeof DEBRIEF_TEXT_FIELDS)[number];

export const DEBRIEF_LIMITS = {
  textMaxLength: 4000,
  rpeMin: 1,
  rpeMax: 10,
  rpeStep: 0.5,
} as const;

export interface ActivityDebrief {
  activityId: string;
  athleteId: string;
  /** Starts at 1 and increases by one on every save. Used for optimistic concurrency. */
  version: number;
  /** Session rating of perceived exertion, 1-10 in steps of 0.5 (Foster CR-10 style). */
  rpe?: number;
  /** Legs, breathing, niggles: how the body felt. */
  bodyFeel?: string;
  /** Motivation, confidence, mindset. */
  mentalState?: string;
  /** Sleep, food, stress, kit and anything unusual around the session. */
  context?: string;
  /** What differed from the plan and why. */
  planNotes?: string;
  /** What went well and what to change next time. */
  learnings?: string;
  /** When the debrief conversation happened; may be hours after the run. */
  recordedAt: string;
  source: DebriefSource;
  createdAt: string;
  updatedAt: string;
}

/** Immutable record of one saved version, kept for traceability. */
export interface ActivityDebriefRevision extends ActivityDebrief {
  savedByActorType: string;
  savedByActorId?: string;
}

export interface DebriefDerived {
  durationSeconds?: number;
  /** Foster session-RPE load: RPE multiplied by duration in minutes. */
  sessionRpeLoad?: number;
}

/** What the API and MCP return: the debrief plus values derived from the activity. */
export interface ActivityDebriefView extends ActivityDebrief {
  activityTitle?: string;
  activityStartedAt: string;
  derived: DebriefDerived;
}

/**
 * Input for create-or-update. Fields left out carry forward from the current version; a
 * field sent as null or an empty string is cleared. activityId comes from the route/tool.
 */
export interface SaveDebriefInput {
  rpe?: number | null;
  bodyFeel?: string | null;
  mentalState?: string | null;
  context?: string | null;
  planNotes?: string | null;
  learnings?: string | null;
  recordedAt?: string;
  source?: DebriefSource;
  /** Current version the caller last saw (0 when it believes none exists). */
  expectedVersion?: number;
}

export interface ListDebriefsOptions {
  limit?: number;
  from?: string;
  to?: string;
}
