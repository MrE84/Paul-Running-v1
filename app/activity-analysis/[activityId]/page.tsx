import PremiumActivityWorkspace from "./PremiumActivityWorkspace";

export const metadata = {
  title: "Activity Detail · Paul's Running",
  description: "Deep-linked Garmin activity analysis with synchronized timeline and route intelligence.",
};

export default async function ActivityDetailPage({ params }: { params: Promise<{ activityId: string }> }) {
  const { activityId } = await params;
  return <PremiumActivityWorkspace activityId={decodeURIComponent(activityId)} />;
}
