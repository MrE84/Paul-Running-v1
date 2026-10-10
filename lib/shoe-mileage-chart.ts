import { SHOE_ROTATION, type ShoeActivityAssignment, type ShoeKey } from "./shoe-rotation";

export interface ShoeVisual {
  imageUrl: string;
  imageAlt: string;
  productUrl: string;
  editionLabel: string;
}

export const SHOE_VISUALS: Readonly<Record<ShoeKey, ShoeVisual>> = {
  "adidas-evo-sl": {
    imageUrl: "https://assets.adidas.com/images/w_500,f_auto,q_auto/22b92f1143c34c748c889eaa1c1f475f_9366/Adizero_EVO_SL_AMG_Shoes_Grey_KI7297_HM1.jpg",
    imageAlt: "Grey adidas Adizero EVO SL AMG running shoe",
    productUrl: "https://www.adidas.co.uk/adizero-evo-sl-amg-shoes/KI7297.html",
    editionLabel: "AMG · Aurora Onix / Acid Yellow / Grey Three",
  },
  "puma-deviate-nitro-3-hyrox": {
    imageUrl: "https://images.puma.com/image/upload/f_auto,q_auto,b_rgb:fafafa,w_600,h_600/global/311413/01/sv01/fnd/GBR/fmt/png/PUMA-x-HYROX-Deviate-NITRO%E2%84%A2-3-Running-Shoes-Women",
    imageAlt: "Green PUMA x HYROX Deviate NITRO 3 running shoe",
    productUrl: "https://uk.puma.com/uk/en/pd/puma-x-hyrox-deviate-nitro-3-running-shoes-women/311413",
    editionLabel: "PUMA x HYROX · Green Glare",
  },
  "asics-metaspeed-sky-tokyo": {
    imageUrl: "https://images.asics.com/is/image/asics/1013A162_300_SL_LT_GLB?$sfcc-product$=",
    imageAlt: "Green ASICS METASPEED SKY TOKYO running shoe",
    productUrl: "https://www.asics.com/gb/en-gb/metaspeed-sky-tokyo/p/1013A162-300.html",
    editionLabel: "TOKYO · EKIDEN pack",
  },
};

export interface WeeklyShoeMileage {
  weekStart: string;
  weekLabel: string;
  totalKm: number;
  byShoe: Record<ShoeKey, number>;
}

function mondayOfDateKey(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = date.getUTCDay();
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  date.setUTCDate(date.getUTCDate() - daysFromMonday);
  return date.toISOString().slice(0, 10);
}

function dateKeyForIso(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function labelForWeek(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, day)));
}

function emptyShoeRecord(): Record<ShoeKey, number> {
  return Object.fromEntries(SHOE_ROTATION.map((shoe) => [shoe.key, 0])) as Record<ShoeKey, number>;
}

export function buildWeeklyShoeMileage(
  assignments: readonly ShoeActivityAssignment[],
  timeZone = "Europe/London",
): WeeklyShoeMileage[] {
  const weeks = new Map<string, WeeklyShoeMileage>();
  for (const assignment of assignments) {
    const weekStart = mondayOfDateKey(dateKeyForIso(assignment.startedAt, timeZone));
    const existing = weeks.get(weekStart) ?? {
      weekStart,
      weekLabel: labelForWeek(weekStart),
      totalKm: 0,
      byShoe: emptyShoeRecord(),
    };
    existing.byShoe[assignment.shoeKey] += assignment.distanceKm;
    existing.totalKm += assignment.distanceKm;
    weeks.set(weekStart, existing);
  }
  return [...weeks.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}
