import type { Metadata } from "next";
import TrainingCalendarClient from "./TrainingCalendarClient";

export const metadata: Metadata = {
  title: "Training Calendar · Paul's Running",
  description: "Canonical Paul’s Running training calendar and Garmin delivery controls.",
};

export default function TrainingCalendarPage() {
  return <TrainingCalendarClient />;
}
