import ActivityExplorer from "../ActivityExplorer";

export const metadata = {
  title: "Local FIT Explorer · Paul's Running",
  description: "Private browser-local FIT decoding and raw activity inspection.",
};

export default function LegacyActivityAnalysisPage() {
  return <ActivityExplorer />;
}
