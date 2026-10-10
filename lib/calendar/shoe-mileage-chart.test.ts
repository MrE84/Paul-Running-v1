import assert from "node:assert/strict";
import test from "node:test";
import { buildWeeklyShoeMileage } from "../shoe-mileage-chart";
import type { ShoeActivityAssignment } from "../shoe-rotation";

test("weekly mileage stacks distance by actual shoe and Monday week", () => {
  const assignments: ShoeActivityAssignment[] = [
    { activityId: "a", startedAt: "2026-10-10T07:36:00.000Z", distanceKm: 3.25, shoeKey: "puma-deviate-nitro-3-hyrox", source: "confirmed_user" },
    { activityId: "b", startedAt: "2026-10-10T08:01:00.000Z", distanceKm: 5.08, shoeKey: "puma-deviate-nitro-3-hyrox", source: "confirmed_user" },
    { activityId: "c", startedAt: "2026-10-12T17:00:00.000Z", distanceKm: 8, shoeKey: "adidas-evo-sl", source: "activity_metadata" },
    { activityId: "d", startedAt: "2026-10-17T08:00:00.000Z", distanceKm: 5, shoeKey: "asics-metaspeed-sky-tokyo", source: "manual_override" },
  ];

  const weeks = buildWeeklyShoeMileage(assignments, "Europe/London");
  assert.equal(weeks.length, 2);
  assert.equal(weeks[0].weekStart, "2026-10-05");
  assert.equal(weeks[0].totalKm, 8.33);
  assert.equal(weeks[0].byShoe["puma-deviate-nitro-3-hyrox"], 8.33);
  assert.equal(weeks[1].weekStart, "2026-10-12");
  assert.equal(weeks[1].totalKm, 13);
  assert.equal(weeks[1].byShoe["adidas-evo-sl"], 8);
  assert.equal(weeks[1].byShoe["asics-metaspeed-sky-tokyo"], 5);
});
