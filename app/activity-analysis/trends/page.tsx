import TrendsDashboard, { type InitialTrendState } from "./TrendsDashboard";

export const metadata = {
  title: "Performance Trends · Paul's Running",
  description: "Longitudinal running volume, load, fitness, efficiency and personal-best progression.",
};

type Search = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function boundedNumber(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

export default async function PerformanceTrendsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const search = await searchParams;
  const initial: InitialTrendState = {
    from: first(search.from) ?? "",
    to: first(search.to) ?? "",
    sport: first(search.sport) ?? "all",
    bucket: first(search.bucket) === "month" ? "month" : "week",
    fitnessDays: boundedNumber(first(search.fitnessDays), 42, 2, 120),
    fatigueDays: boundedNumber(first(search.fatigueDays), 7, 1, 60),
  };
  return <TrendsDashboard initial={initial} />;
}
