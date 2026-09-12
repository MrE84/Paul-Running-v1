import type { DecodedFit } from "./contracts";

/** Explicitly synthetic public-park loop, never used as a fallback for personal activities. */
export function sampleFit(seconds = 3600): DecodedFit {
  const started = Date.parse("2026-09-12T08:00:00Z");
  let distance = 0;
  const records = Array.from({ length: seconds + 1 }, (_, i) => {
    const speed = 2.7 + .55 * Math.sin(i / 180) + .25 * i / seconds;
    if (i) distance += speed;
    const angle = i / seconds * Math.PI * 8;
    return { timestamp: new Date(started + i * 1000).toISOString(), elapsed_time: i, distance,
      enhanced_speed: speed, heart_rate: Math.round(132 + i / seconds * 24 + 9 * Math.sin(i / 180)),
      cadence: 84 + 3 * Math.sin(i / 130), enhanced_altitude: 28 + 11 * Math.sin(i / 220),
      power: Math.round(245 + speed * 15 + 12 * Math.sin(i / 130)), temperature: 18 + i / seconds * 3,
      vertical_oscillation: 8 + Math.sin(i / 90), stance_time: 248 - speed * 5,
      position_lat: 51.5077 + .006 * Math.sin(angle), position_long: -.165 + .012 * Math.cos(angle),
    };
  });
  return { protocolVersion: 2, profileVersion: 2110,
    sessions: [{ sport: "running", sport_profile_name: "Sample · Park progression", start_time: new Date(started).toISOString(), timestamp: new Date(started + seconds * 1000).toISOString(), total_timer_time: seconds, total_elapsed_time: seconds, total_distance: distance, enhanced_avg_speed: distance / seconds, avg_heart_rate: 144, avg_cadence: 85, total_ascent: 115, total_calories: 682 }],
    records, laps: Array.from({ length: Math.ceil(seconds / 600) }, (_, i) => ({ start_time: new Date(started + i * 600000).toISOString(), total_elapsed_time: Math.min(600, seconds - i * 600), total_timer_time: Math.min(600, seconds - i * 600), total_distance: records[Math.min(seconds, (i + 1) * 600)].distance - records[i * 600].distance, avg_heart_rate: 136 + i * 3 })),
    device_infos: [{ manufacturer: "synthetic", product_name: "Illustrative sample" }],
  };
}
