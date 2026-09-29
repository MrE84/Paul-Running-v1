export const athleteProfile = {
  test: {
    name: "Current athlete state",
    date: "29 Sep 2026",
    clinic: "Reported by Paul",
    analyser: "Running HR capacity",
    note: "Current threshold state supersedes the historical lactate-test HR anchor",
  },
  thresholds: [
    {
      key: "LT1",
      name: "Aerobic threshold",
      pace: "6:34/km",
      speed: "9.16 km/h",
      heartRate: "144 bpm",
      lactate: "~2.0 mmol/L",
      description: "Upper anchor for easy and aerobic running with minimal lactate accumulation.",
    },
    {
      key: "LT2",
      name: "Anaerobic threshold",
      pace: "Not recorded",
      speed: "Not recorded",
      heartRate: "176 bpm",
      lactate: "Current LTHR",
      description: "Current heart-rate threshold used for training prescription and Garmin workouts.",
    },
  ],
  zones: [
    { zone: "Z1", name: "Recovery", pace: "Use effort", heartRate: "≤149 bpm", share: "<85% LTHR" },
    { zone: "Z2", name: "Aerobic", pace: "Use effort", heartRate: "150–157 bpm", share: "85–89% LTHR" },
    { zone: "Z3", name: "Tempo", pace: "Use effort", heartRate: "158–166 bpm", share: "90–94% LTHR" },
    { zone: "Z4", name: "Sub-threshold", pace: "Use effort", heartRate: "167–175 bpm", share: "95–99% LTHR" },
    { zone: "Z5", name: "Threshold+", pace: "Use effort", heartRate: "176–198 bpm", share: "≥100% LTHR" },
  ],
  domains: [
    { name: "Moderate", range: "Below LT1", detail: "Slower than 6:34/km · typically below ~144 bpm" },
    { name: "Sub-threshold", range: "Z4", detail: "167–175 bpm · 95–99% of current LTHR" },
    { name: "Threshold+", range: "Z5", detail: "176–198 bpm · at or above current LTHR" },
  ],
  personalBests: [
    { distance: "5K", value: "24:47", detail: "Cheltenham parkrun PB", source: "Run history" },
    { distance: "10K", value: "51:00", detail: "Current reported best", source: "Run history" },
    { distance: "Half", value: "1:50:00", detail: "Cheltenham target", source: "Current goal" },
  ],
  capacities: [
    { label: "Aerobic base", value: "70–80%", detail: "Training time below LT1; slower than ~6:34/km." },
    { label: "Tempo + threshold", value: "1–2 / week", detail: "Use Z3–Z4 to improve lactate clearance and threshold." },
    { label: "High intensity", value: "5–10%", detail: "Use Z5 sparingly for VO₂ max and race-specific work." },
    { label: "Retest window", value: "8–12 weeks", detail: "Repeat the same protocol to track threshold movement." },
  ],
} as const;
