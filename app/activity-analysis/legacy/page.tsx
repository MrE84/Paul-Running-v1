import LocalActivityAnalysis from "./LocalActivityAnalysis";

export const metadata = {
  title: "Private FIT Analysis · Paul's Running",
  description: "Browser-local FIT analysis using the same premium projection, timeline and route engine without persistence.",
};

export default function LegacyActivityAnalysisPage() {
  return <LocalActivityAnalysis />;
}
