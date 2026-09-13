import { CHANNELS, type Axis, type Channel } from "./projection";

export const LAYOUT_VERSION = "1.0.0";

export type AnalysisCardId = "timeline" | "map" | "elevation" | "intervals" | "zones" | "records" | "derived" | "dynamics";
export type AnalysisCardSize = "half" | "wide" | "full";

export interface AnalysisLayoutCard {
  id: AnalysisCardId;
  visible: boolean;
  size: AnalysisCardSize;
}

export interface AnalysisLayout {
  version: string;
  id: string;
  name: string;
  sport: string;
  cards: AnalysisLayoutCard[];
  channels: Channel[];
  axis: Axis;
  mode: "stacked" | "overlay";
  smoothingSeconds: number;
  showZoneBands: boolean;
}

const CARD_ORDER: AnalysisCardId[] = ["timeline", "map", "elevation", "intervals", "zones", "records", "derived", "dynamics"];
const card = (id: AnalysisCardId, visible: boolean, size: AnalysisCardSize = "full"): AnalysisLayoutCard => ({ id, visible, size });

export const BUILT_IN_LAYOUTS: ReadonlyArray<AnalysisLayout> = [
  {
    version: LAYOUT_VERSION, id: "run-overview", name: "Run Overview", sport: "running",
    cards: [card("timeline", true, "wide"), card("map", true, "half"), card("elevation", true, "half"), card("intervals", true), card("zones", true), card("records", true), card("derived", true), card("dynamics", false)],
    channels: ["heart_rate", "pace", "cadence", "altitude"], axis: "time", mode: "stacked", smoothingSeconds: 5, showZoneBands: false,
  },
  {
    version: LAYOUT_VERSION, id: "threshold-analysis", name: "Threshold Analysis", sport: "running",
    cards: [card("timeline", true), card("intervals", true), card("zones", true, "wide"), card("derived", true, "half"), card("map", true, "half"), card("elevation", false), card("records", true), card("dynamics", false)],
    channels: ["heart_rate", "pace", "power"], axis: "time", mode: "overlay", smoothingSeconds: 15, showZoneBands: true,
  },
  {
    version: LAYOUT_VERSION, id: "interval-analysis", name: "Interval Analysis", sport: "running",
    cards: [card("timeline", true), card("intervals", true), card("zones", true), card("records", true), card("derived", true), card("map", false), card("elevation", false), card("dynamics", false)],
    channels: ["pace", "heart_rate", "cadence"], axis: "time", mode: "stacked", smoothingSeconds: 5, showZoneBands: true,
  },
  {
    version: LAYOUT_VERSION, id: "long-run", name: "Long Run", sport: "running",
    cards: [card("timeline", true, "wide"), card("map", true, "half"), card("elevation", true, "half"), card("zones", true), card("derived", true), card("intervals", false), card("records", true), card("dynamics", false)],
    channels: ["heart_rate", "pace", "altitude"], axis: "distance", mode: "stacked", smoothingSeconds: 30, showZoneBands: true,
  },
  {
    version: LAYOUT_VERSION, id: "race-review", name: "Race Review", sport: "running",
    cards: [card("timeline", true, "wide"), card("map", true, "half"), card("intervals", true), card("records", true), card("derived", true), card("zones", true), card("elevation", true), card("dynamics", false)],
    channels: ["pace", "heart_rate", "cadence", "grade"], axis: "distance", mode: "overlay", smoothingSeconds: 15, showZoneBands: true,
  },
  {
    version: LAYOUT_VERSION, id: "raw-dynamics", name: "Raw / Dynamics", sport: "running",
    cards: [card("dynamics", true), card("timeline", true), card("elevation", true), card("map", false), card("intervals", false), card("zones", false), card("records", false), card("derived", false)],
    channels: ["cadence", "vertical_oscillation", "ground_contact_time", "power", "respiration_rate"], axis: "time", mode: "stacked", smoothingSeconds: 0, showZoneBands: false,
  },
];

function cloneLayout(layout: AnalysisLayout): AnalysisLayout {
  return { ...layout, cards: layout.cards.map(value => ({ ...value })), channels: [...layout.channels] };
}

export function builtInLayout(id = "auto", sport = "running"): AnalysisLayout {
  if (id === "auto") {
    const normalizedSport = sport.toLowerCase();
    const automatic = cloneLayout(BUILT_IN_LAYOUTS[0]);
    if (/cycl|bike/.test(normalizedSport)) {
      return { ...automatic, id: "cycling-overview", name: "Cycling Overview", sport, channels: ["heart_rate", "speed", "cadence", "power", "altitude"] };
    }
    if (/swim/.test(normalizedSport)) {
      return { ...automatic, id: "swim-overview", name: "Swim Overview", sport, channels: ["heart_rate", "pace", "cadence"], cards: automatic.cards.map(value => ({ ...value, visible: value.id === "map" || value.id === "elevation" ? false : value.visible })) };
    }
    if (!/run|walk|hike/.test(normalizedSport)) {
      return { ...automatic, id: "activity-overview", name: "Activity Overview", sport, channels: ["heart_rate", "speed", "cadence", "altitude"] };
    }
    return { ...automatic, sport };
  }
  const selected = BUILT_IN_LAYOUTS.find(layout => layout.id === id) ?? BUILT_IN_LAYOUTS[0];
  return { ...cloneLayout(selected), sport };
}

export function normalizeLayout(value: unknown, sport: string, availableChannels: Channel[]): AnalysisLayout {
  const available = new Set(availableChannels);
  const automatic = builtInLayout("auto", sport);
  const automaticChannels = automatic.channels.filter(channel => available.has(channel)).slice(0, 5);
  const fallback = { ...automatic, channels: automaticChannels.length ? automaticChannels : availableChannels.slice(0, 5) };
  if (!value || typeof value !== "object") return fallback;
  const input = value as Partial<AnalysisLayout>;
  const channels = Array.isArray(input.channels)
    ? input.channels.filter((channel): channel is Channel => typeof channel === "string" && channel in CHANNELS && available.has(channel as Channel)).slice(0, 5)
    : [];
  const incomingCards = Array.isArray(input.cards) ? input.cards : [];
  const cards = CARD_ORDER.map(id => {
    const existing = incomingCards.find(value => value && typeof value === "object" && (value as AnalysisLayoutCard).id === id) as Partial<AnalysisLayoutCard> | undefined;
    const fallbackCard = fallback.cards.find(value => value.id === id)!;
    return {
      id,
      visible: typeof existing?.visible === "boolean" ? existing.visible : fallbackCard.visible,
      size: (["half", "wide", "full"] as AnalysisCardSize[]).includes(existing?.size as AnalysisCardSize) ? existing!.size as AnalysisCardSize : fallbackCard.size,
    };
  }).sort((a, b) => {
    const aIndex = incomingCards.findIndex(value => (value as AnalysisLayoutCard | undefined)?.id === a.id);
    const bIndex = incomingCards.findIndex(value => (value as AnalysisLayoutCard | undefined)?.id === b.id);
    return (aIndex < 0 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex < 0 ? Number.MAX_SAFE_INTEGER : bIndex) || CARD_ORDER.indexOf(a.id) - CARD_ORDER.indexOf(b.id);
  });
  if (!cards.some(value => value.visible)) cards.find(value => value.id === "timeline")!.visible = true;
  return {
    version: LAYOUT_VERSION,
    id: typeof input.id === "string" && input.id.trim() ? input.id.slice(0, 80) : fallback.id,
    name: typeof input.name === "string" && input.name.trim() ? input.name.trim().slice(0, 80) : fallback.name,
    sport,
    cards,
    channels: channels.length ? channels : fallback.channels.filter(channel => available.has(channel)).slice(0, 5).length
      ? fallback.channels.filter(channel => available.has(channel)).slice(0, 5)
      : availableChannels.slice(0, 5),
    axis: input.axis === "distance" ? "distance" : "time",
    mode: input.mode === "overlay" ? "overlay" : "stacked",
    smoothingSeconds: [0, 5, 15, 30, 60].includes(Number(input.smoothingSeconds)) ? Number(input.smoothingSeconds) : fallback.smoothingSeconds,
    showZoneBands: Boolean(input.showZoneBands),
  };
}

export function moveLayoutCard(layout: AnalysisLayout, id: AnalysisCardId, direction: -1 | 1): AnalysisLayout {
  const cards = layout.cards.map(value => ({ ...value }));
  const index = cards.findIndex(value => value.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= cards.length) return cloneLayout(layout);
  [cards[index], cards[target]] = [cards[target], cards[index]];
  return { ...layout, cards };
}

export function layoutStorageKey(sport: string): string {
  return `paul-running:analysis-layout:${LAYOUT_VERSION}:${sport || "other"}`;
}
