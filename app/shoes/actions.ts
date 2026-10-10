"use server";

import { revalidatePath } from "next/cache";
import { getTrainingApiRuntime } from "../../lib/training-api/runtime";
import { saveShoeOverride } from "../../lib/shoe-overrides";
import { SHOE_ROTATION, type ShoeKey } from "../../lib/shoe-rotation";

const allowedShoes = new Set<ShoeKey>(SHOE_ROTATION.map((shoe) => shoe.key));

export async function updateShoeAssignment(formData: FormData): Promise<void> {
  const activityId = String(formData.get("activityId") ?? "").trim();
  const requested = String(formData.get("shoeKey") ?? "auto").trim();
  if (!activityId) throw new Error("Activity id is required.");

  const { service, primaryAthleteId } = getTrainingApiRuntime();
  const activity = await service.getActivity(primaryAthleteId, activityId);
  if (activity.sport !== "running") throw new Error("Only running activities can be assigned a running shoe.");

  const shoeKey = requested === "auto" ? null : requested as ShoeKey;
  if (shoeKey !== null && !allowedShoes.has(shoeKey)) throw new Error("Unknown running shoe.");

  await saveShoeOverride(primaryAthleteId, activityId, shoeKey);
  revalidatePath("/shoes");
}
