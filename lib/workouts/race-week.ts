import type { Sport, WorkoutStep } from "../domain/contracts";

export interface RaceWeekWorkoutDefinition {
  key: "monday-rehearsal" | "saturday-shakeout" | "sunday-race";
  name: string;
  description: string;
  sport: Sport;
  dayOffset: number;
  localStartTime: string;
  steps: WorkoutStep[];
}

function distanceNone(
  id: string,
  sequence: number,
  meters: number,
  instruction: string,
  phase: "warmup" | "active" | "recovery" | "cooldown" = "active",
): WorkoutStep {
  return {
    id,
    kind: "step",
    sequence,
    phase,
    durationType: "distance",
    durationValue: meters,
    durationUnit: "meters",
    targetType: "none",
    instruction,
  };
}

function distancePace(
  id: string,
  sequence: number,
  meters: number,
  lowSecPerKm: number,
  highSecPerKm: number,
  instruction: string,
): WorkoutStep {
  return {
    id,
    kind: "step",
    sequence,
    phase: "active",
    durationType: "distance",
    durationValue: meters,
    durationUnit: "meters",
    targetType: "pace",
    targetLow: lowSecPerKm,
    targetHigh: highSecPerKm,
    targetUnit: "sec_per_km",
    instruction,
  };
}

function timeNone(
  id: string,
  sequence: number,
  seconds: number,
  instruction: string,
  phase: "warmup" | "active" | "recovery" | "cooldown" = "active",
): WorkoutStep {
  return {
    id,
    kind: "step",
    sequence,
    phase,
    durationType: "time",
    durationValue: seconds,
    durationUnit: "seconds",
    targetType: "none",
    instruction,
  };
}

const racePaces = [
  [312, 320, "KM1 controlled opening; HR guide ~155-160"],
  [307, 315, "KM2 favourable; stay restrained"],
  [309, 317, "KM3 settle; HR guide ~155-160"],
  [309, 317, "KM4 neutral; stay smooth"],
  [315, 323, "KM5 climb; do not chase pace"],
  [312, 320, "KM6 rolling/uphill; HR guide ~160-164"],
  [305, 313, "KM7 downhill; free speed, no surge"],
  [304, 312, "KM8 favourable descent; stay relaxed"],
  [310, 318, "KM9 gradual rise; HR guide ~160-164"],
  [316, 324, "KM10 key climb; effort over pace"],
  [303, 311, "KM11 strong descent; controlled gain"],
  [307, 315, "KM12 favourable; HR guide ~160-164"],
  [306, 314, "KM13 downhill; smooth cadence"],
  [315, 323, "KM14 significant climb; stay controlled"],
  [308, 316, "KM15 regroup; HR guide ~160-164"],
  [312, 320, "KM16 rise; HR guide ~163-166 if controlled"],
  [314, 322, "KM17 late climb; no panic"],
  [302, 310, "KM18 descent; begin racing if strong"],
  [310, 318, "KM19 rolling; commit if controlled"],
  [309, 317, "KM20 hold target; prepare to finish"],
  [302, 310, "KM21 final push; use downhill"],
] as const;

const raceSteps: WorkoutStep[] = [
  ...racePaces.map(([low, high, instruction], index) =>
    distancePace(`race-km-${index + 1}`, index, 1000, low, high, instruction),
  ),
  distancePace("race-final-100m", 21, 100, 280, 300, "Final 100 m - commit to finish"),
];

export const CHELTENHAM_RACE_CENTER_SECONDS =
  racePaces.reduce((sum, [low, high]) => sum + (low + high) / 2, 0) + 29;

export const RACE_WEEK_2026: RaceWeekWorkoutDefinition[] = [
  {
    key: "monday-rehearsal",
    name: "Rehearsal Half Marathon",
    description:
      "Monday 14 Sep. Follow the first ~11 km of the Cheltenham Half Marathon course. Technical rehearsal, not a hard workout. Wear intended race kit/shoes and rehearse fuel access. Easy kilometres are deliberately untargeted; selected course kilometres reproduce route-aware race pace. Do not chase pace on climbs. Finish fresh.",
    sport: "running",
    dayOffset: 0,
    localStartTime: "17:30",
    steps: [
      distanceNone("rehearsal-km1-4", 0, 4000, "Course KM1-4 easy; learn start section", "warmup"),
      distancePace("rehearsal-km5", 1, 1000, 315, 323, "Course KM5 climb rehearsal; yield pace"),
      distanceNone("rehearsal-km6", 2, 1000, "Course KM6 easy reset; aerobic", "recovery"),
      distancePace("rehearsal-km7", 3, 1000, 305, 313, "Course KM7 downhill; free speed, no surge"),
      distancePace("rehearsal-km8", 4, 1000, 304, 312, "Course KM8 descent; relaxed at target"),
      distanceNone("rehearsal-km9", 5, 1000, "Course KM9 easy reset before key climb", "recovery"),
      distancePace("rehearsal-km10", 6, 1000, 316, 324, "Course KM10 key climb; effort over pace"),
      distanceNone("rehearsal-km11", 7, 1000, "Course KM11 easy cool-down; finish fresh", "cooldown"),
    ],
  },
  {
    key: "saturday-shakeout",
    name: "Optional Pre-Race Shakeout",
    description:
      "Saturday 19 Sep. Optional only. Keep it very short and easy. Three 15-second relaxed pickups, not sprints. Every segment is time-controlled and auto-advances. Skip if you feel any niggle or unusual fatigue.",
    sport: "running",
    dayOffset: 5,
    localStartTime: "17:00",
    steps: [
      timeNone("shakeout-easy-1", 0, 900, "Very easy running", "warmup"),
      {
        id: "shakeout-repeats",
        kind: "repeat",
        sequence: 1,
        repeatCount: 3,
        instruction: "Three relaxed pickups, never sprinting",
        children: [
          timeNone("shakeout-pickup", 0, 15, "Relaxed pickup", "active"),
          timeNone("shakeout-recovery", 1, 105, "Easy recovery", "recovery"),
        ],
      },
      timeNone("shakeout-easy-2", 2, 300, "Easy finish", "cooldown"),
    ],
  },
  {
    key: "sunday-race",
    name: "Cheltenham Half Marathon - Route-Aware 1:50",
    description:
      "Sunday 20 Sep. Route-aware 1:50 target from the supplied Garmin course. Follow the 1 km auto-advancing pace steps; do not force 5:13/km on climbs. HR guide: km1-5 ~155-160, km6-15 ~160-164, km16-18 ~163-166, then race from km18 if breathing and legs are controlled. Fuel/hydrate as rehearsed.",
    sport: "running",
    dayOffset: 6,
    localStartTime: "09:00",
    steps: raceSteps,
  },
];

export function advancedLunchWalkSteps(): WorkoutStep[] {
  const cues = [
    "Settle & posture",
    "Arm drive",
    "Quick cadence",
    "Controlled power",
    "Smooth finish",
  ];
  return cues.map((instruction, sequence) =>
    timeNone(`lunch-walk-${sequence + 1}`, sequence, 120, instruction, "active"),
  );
}
