import type { Metadata } from "next";
import PlannedWorkoutClient from "./PlannedWorkoutClient";

export const metadata: Metadata = {
  title: "Planned Run · Paul's Running",
  description: "Steps, distances, heart rate and pace targets for a planned Paul’s Running session.",
};

export default async function PlannedWorkoutPage({ params, searchParams }: {
  params: Promise<{ workoutId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workoutId } = await params;
  const query = await searchParams;
  const text = (key: string) => typeof query[key] === "string" ? query[key] as string : undefined;
  return <PlannedWorkoutClient workoutId={decodeURIComponent(workoutId)} date={text("date")} time={text("time")} timezone={text("tz")} status={text("status")} />;
}
