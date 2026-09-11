import { NextResponse } from "next/server";
import { getTrainingApiRuntime } from "../../../../lib/training-api/runtime";

export async function GET() {
  try {
    const runtime = getTrainingApiRuntime();

    if (runtime.storageMode !== "postgres") {
      return NextResponse.json(
        { status: "degraded", storageMode: runtime.storageMode },
        { status: 503 },
      );
    }

    // Force a real repository read so this checks connectivity and lazy schema bootstrap,
    // rather than merely confirming that DATABASE_URL exists.
    await runtime.service.getProfile(runtime.primaryAthleteId);

    return NextResponse.json({ status: "ok", storageMode: runtime.storageMode });
  } catch {
    return NextResponse.json(
      { status: "error", storageMode: "postgres" },
      { status: 503 },
    );
  }
}
