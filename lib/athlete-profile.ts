export const athleteProfile = {
  test: {
    name: "Pentons Lactate Test",
    date: "21 Aug 2026",
    clinic: "Pentons Performance Therapy",
    analyser: "Lactate Pro 2",
    note: "Official Pentons / Proven Performance athlete report",
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
      pace: "5:17/km",
      speed: "11.35 km/h",
      heartRate: "165 bpm",
      lactate: "~4.5 mmol/L",
      description: "Functional threshold; approximately the maximum sustainable 40–60 minute effort.",
    },
  ],
  zones: [
    { zone: "Z1", name: "Easy / Recovery", pace: ">6:37/km", heartRate: "<132 bpm", share: "<80% LT2" },
    { zone: "Z2", name: "Aerobic / Base", pace: "5:56–6:37/km", heartRate: "132–147 bpm", share: "80–89% LT2" },
    { zone: "Z3", name: "Tempo", pace: "5:38–5:55/km", heartRate: "148–155 bpm", share: "90–94% LT2" },
    { zone: "Z4", name: "Threshold", pace: "5:02–5:37/km", heartRate: "157–173 bpm", share: "95–105% LT2" },
    { zone: "Z5", name: "VO₂ Max / Speed", pace: "<5:02/km", heartRate: ">173 bpm", share: ">105% LT2" },
  ],
  domains: [
    { name: "Moderate", range: "Below LT1", detail: "Slower than 6:34/km · typically below ~144 bpm" },
    { name: "Heavy", range: "LT1 → LT2", detail: "6:34 → 5:17/km · ~144–165 bpm" },
    { name: "Severe", range: "Above LT2", detail: "Faster than 5:17/km · typically above ~165 bpm" },
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
