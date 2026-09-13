export type MonthCell = {
  date: string;
  day: number;
  inMonth: boolean;
};

function parseMonthKey(monthKey: string): { year: number; monthIndex: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) throw new Error(`Invalid month key: ${monthKey}`);
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (!Number.isInteger(year) || monthIndex < 0 || monthIndex > 11) {
    throw new Error(`Invalid month key: ${monthKey}`);
  }
  return { year, monthIndex };
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function currentMonthKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function shiftMonthKey(monthKey: string, delta: number): string {
  const { year, monthIndex } = parseMonthKey(monthKey);
  const shifted = new Date(Date.UTC(year, monthIndex + delta, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(monthKey: string): string {
  const { year, monthIndex } = parseMonthKey(monthKey);
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, monthIndex, 1)));
}

export function buildMonthGrid(monthKey: string): MonthCell[] {
  const { year, monthIndex } = parseMonthKey(monthKey);
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const mondayOffset = (first.getUTCDay() + 6) % 7;
  const start = new Date(Date.UTC(year, monthIndex, 1 - mondayOffset));

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start.getTime() + index * 86400000);
    return {
      date: isoDate(date),
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() === monthIndex,
    };
  });
}

export function monthQueryRange(monthKey: string): { from: string; to: string } {
  const grid = buildMonthGrid(monthKey);
  const first = new Date(`${grid[0].date}T00:00:00.000Z`);
  const last = new Date(`${grid[grid.length - 1].date}T23:59:59.999Z`);
  first.setUTCDate(first.getUTCDate() - 1);
  last.setUTCDate(last.getUTCDate() + 1);
  return { from: first.toISOString(), to: last.toISOString() };
}
