import ComparisonWorkspace, { type InitialComparisonState } from "./ComparisonWorkspace";

export const metadata = {
  title: "Compare Activities · Paul's Running",
  description: "Overlay repeated runs, races and workout intervals by time, distance or matched step.",
};

type Search = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CompareActivitiesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const requestedIds = Array.isArray(search.id)
    ? search.id
    : search.id
      ? [search.id]
      : first(search.ids)?.split(",") ?? [];
  const ids = [...new Set(requestedIds.map(value => value.trim()).filter(Boolean))].slice(0, 6);
  const channels = (first(search.channels)?.split(",") ?? ["heart_rate", "pace"]).map(value => value.trim()).filter(Boolean);
  const initial: InitialComparisonState = {
    ids,
    alignment: first(search.align) === "time" || first(search.align) === "interval" ? first(search.align) as "time" | "interval" : "distance",
    channels,
    relative: first(search.relative) === "1",
    intervalLabel: first(search.interval) ?? "",
  };
  return <ComparisonWorkspace initial={initial} />;
}
