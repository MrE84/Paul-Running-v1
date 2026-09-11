import type { IsoDateTime, LocalDate, LocalTime } from "../domain/contracts";

export type LocalTimeDisambiguation = "reject" | "earlier" | "later";

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

interface LocalTimeParts {
  hour: number;
  minute: number;
  second: number;
}

interface LocalDateTimeParts extends LocalDateParts, LocalTimeParts {}

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_TIME_PATTERN = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

export class InvalidLocalDateTimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidLocalDateTimeError";
  }
}

export class NonexistentLocalTimeError extends Error {
  constructor(date: LocalDate, time: LocalTime, timezone: string) {
    super(`Local time ${date} ${time} does not exist in ${timezone}.`);
    this.name = "NonexistentLocalTimeError";
  }
}

export class AmbiguousLocalTimeError extends Error {
  constructor(date: LocalDate, time: LocalTime, timezone: string) {
    super(
      `Local time ${date} ${time} occurs more than once in ${timezone}; choose earlier or later explicitly.`,
    );
    this.name = "AmbiguousLocalTimeError";
  }
}

export function assertValidTimeZone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: timezone }).format(new Date());
  } catch {
    throw new InvalidLocalDateTimeError(`Unknown IANA timezone: ${timezone}`);
  }
}

export function parseLocalDate(date: LocalDate): LocalDateParts {
  const match = LOCAL_DATE_PATTERN.exec(date);
  if (!match) {
    throw new InvalidLocalDateTimeError(`Invalid local date: ${date}`);
  }

  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  const check = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (
    check.getUTCFullYear() !== parts.year ||
    check.getUTCMonth() + 1 !== parts.month ||
    check.getUTCDate() !== parts.day
  ) {
    throw new InvalidLocalDateTimeError(`Invalid local date: ${date}`);
  }
  return parts;
}

export function parseLocalTime(time: LocalTime): LocalTimeParts {
  const match = LOCAL_TIME_PATTERN.exec(time);
  if (!match) {
    throw new InvalidLocalDateTimeError(`Invalid local time: ${time}`);
  }

  const parts = {
    hour: Number(match[1]),
    minute: Number(match[2]),
    second: Number(match[3] ?? "0"),
  };
  if (
    parts.hour > 23 ||
    parts.minute > 59 ||
    parts.second > 59
  ) {
    throw new InvalidLocalDateTimeError(`Invalid local time: ${time}`);
  }
  return parts;
}

export function addLocalDays(date: LocalDate, days: number): LocalDate {
  if (!Number.isInteger(days)) {
    throw new InvalidLocalDateTimeError(`Day offset must be an integer: ${days}`);
  }
  const parts = parseLocalDate(date);
  const result = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return `${result.getUTCFullYear().toString().padStart(4, "0")}-${(result.getUTCMonth() + 1)
    .toString()
    .padStart(2, "0")}-${result.getUTCDate().toString().padStart(2, "0")}`;
}

function offsetMinutesAt(instantMs: number, timezone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "shortOffset",
  });
  const zoneName = formatter
    .formatToParts(new Date(instantMs))
    .find((part) => part.type === "timeZoneName")?.value;

  if (!zoneName || zoneName === "GMT" || zoneName === "UTC") {
    return 0;
  }

  const match = /^(?:GMT|UTC)([+-])(\d{1,2})(?::(\d{2}))?$/.exec(zoneName);
  if (!match) {
    throw new InvalidLocalDateTimeError(
      `Could not determine UTC offset for ${timezone}: ${zoneName}`,
    );
  }

  const sign = match[1] === "+" ? 1 : -1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? "0"));
}

function localPartsAt(instantMs: number, timezone: string): LocalDateTimeParts {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const values = Object.fromEntries(
    formatter
      .formatToParts(new Date(instantMs))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function sameLocalDateTime(
  left: LocalDateTimeParts,
  right: LocalDateTimeParts,
): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second
  );
}

export function localDateTimeToUtc(
  date: LocalDate,
  time: LocalTime,
  timezone: string,
  disambiguation: LocalTimeDisambiguation = "reject",
): IsoDateTime {
  assertValidTimeZone(timezone);
  const target: LocalDateTimeParts = {
    ...parseLocalDate(date),
    ...parseLocalTime(time),
  };

  const naiveUtcMs = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
    target.minute,
    target.second,
  );

  const offsets = new Set<number>();
  for (const hours of [-36, -24, -12, 0, 12, 24, 36]) {
    offsets.add(offsetMinutesAt(naiveUtcMs + hours * 60 * 60 * 1000, timezone));
  }

  const candidates = [...offsets]
    .map((offset) => naiveUtcMs - offset * 60 * 1000)
    .filter((candidate) => sameLocalDateTime(localPartsAt(candidate, timezone), target))
    .filter((candidate, index, all) => all.indexOf(candidate) === index)
    .sort((a, b) => a - b);

  if (candidates.length === 0) {
    throw new NonexistentLocalTimeError(date, time, timezone);
  }
  if (candidates.length > 1 && disambiguation === "reject") {
    throw new AmbiguousLocalTimeError(date, time, timezone);
  }

  const chosen =
    disambiguation === "later"
      ? candidates[candidates.length - 1]
      : candidates[0];
  return new Date(chosen).toISOString();
}
