import type { Metadata } from "next";
import RecoveryWeekClient from "./RecoveryWeekClient";

export const metadata: Metadata = {
  title: "Post-Half Recovery · Paul's Running",
  description: "Approve and deliver the Cheltenham Half Marathon recovery week through Paul's Running to Garmin.",
};

export default function RecoveryWeekPage() {
  return <RecoveryWeekClient />;
}
