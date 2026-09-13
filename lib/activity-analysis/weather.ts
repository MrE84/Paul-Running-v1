import type { AnalysisProjection, Channel, Values } from "./projection";

export const WEATHER_VERSION = "open-meteo-archive-v1";
export interface WeatherSample {
  index: number;
  latitude: number;
  longitude: number;
  requestedAt: string;
  observedAt: string;
  temperatureC: number | null;
  apparentTemperatureC: number | null;
  relativeHumidityPercent: number | null;
  dewPointC: number | null;
  precipitationMm: number | null;
  pressureHpa: number | null;
  cloudCoverPercent: number | null;
  windSpeedMps: number | null;
  windGustMps: number | null;
  windDirectionDegrees: number | null;
  travelBearingDegrees: number | null;
  headwindMps: number | null;
  crosswindMps: number | null;
}

export interface WeatherEnrichment {
  version: string;
  provider: "open-meteo";
  model: "historical-archive-hourly";
  status: "available" | "unavailable" | "failed";
  fetchedAt: string;
  sampleIntervalSeconds: number | null;
  samples: WeatherSample[];
  summary: {
    temperatureC: number | null;
    apparentTemperatureC: number | null;
    relativeHumidityPercent: number | null;
    precipitationMm: number | null;
    windSpeedMps: number | null;
    windGustMps: number | null;
    headwindMps: number | null;
  };
  message?: string;
}

interface OpenMeteoHourly {
  time?: string[];
  temperature_2m?: Array<number | null>;
  apparent_temperature?: Array<number | null>;
  relative_humidity_2m?: Array<number | null>;
  dew_point_2m?: Array<number | null>;
  precipitation?: Array<number | null>;
  surface_pressure?: Array<number | null>;
  cloud_cover?: Array<number | null>;
  wind_speed_10m?: Array<number | null>;
  wind_gusts_10m?: Array<number | null>;
  wind_direction_10m?: Array<number | null>;
}

interface OpenMeteoResponse { hourly?: OpenMeteoHourly; reason?: string }

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function mean(values: Array<number | null>): number | null {
  const valid = values.filter(finite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function maximum(values: Array<number | null>): number | null {
  const valid = values.filter(finite);
  return valid.length ? Math.max(...valid) : null;
}

export function travelBearing(from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }): number {
  const radians = Math.PI / 180;
  const latitude1 = from.latitude * radians;
  const latitude2 = to.latitude * radians;
  const longitudeDelta = (to.longitude - from.longitude) * radians;
  const y = Math.sin(longitudeDelta) * Math.cos(latitude2);
  const x = Math.cos(latitude1) * Math.sin(latitude2) - Math.sin(latitude1) * Math.cos(latitude2) * Math.cos(longitudeDelta);
  return (Math.atan2(y, x) / radians + 360) % 360;
}

export function windComponents(windSpeedMps: number, windFromDegrees: number, travelBearingDegrees: number) {
  const angle = (windFromDegrees - travelBearingDegrees) * Math.PI / 180;
  return {
    headwindMps: windSpeedMps * Math.cos(angle),
    crosswindMps: Math.abs(windSpeedMps * Math.sin(angle)),
  };
}

function nearestHour(times: string[], requestedAt: string): number {
  const target = Date.parse(requestedAt);
  let best = 0;
  let distance = Infinity;
  times.forEach((time, index) => {
    const candidate = Math.abs(Date.parse(time.endsWith("Z") ? time : `${time}Z`) - target);
    if (candidate < distance) { distance = candidate; best = index; }
  });
  return best;
}

function routeWaypoints(projection: AnalysisProjection, maximum = 10) {
  const valid = projection.streams.latitude.flatMap((latitude, index) => {
    const longitude = projection.streams.longitude[index];
    return finite(latitude) && finite(longitude) ? [{ index, latitude, longitude }] : [];
  });
  if (!valid.length || !projection.activity.startedAt) return [];
  const count = Math.min(maximum, valid.length);
  const selected = Array.from({ length: count }, (_, number) => valid[Math.round(number * (valid.length - 1) / Math.max(1, count - 1))]);
  return selected.filter((item, index) => index === 0 || item.index !== selected[index - 1].index).map((item, index, items) => {
    const next = items[Math.min(items.length - 1, index + 1)];
    const previous = items[Math.max(0, index - 1)];
    const bearingTarget = next.index === item.index ? previous : next;
    return {
      ...item,
      requestedAt: new Date(Date.parse(projection.activity.startedAt!) + projection.streams.elapsed[item.index] * 1000).toISOString(),
      bearing: bearingTarget.index === item.index ? null : travelBearing(item, bearingTarget),
    };
  });
}

function unavailable(message: string): WeatherEnrichment {
  return {
    version: WEATHER_VERSION,
    provider: "open-meteo",
    model: "historical-archive-hourly",
    status: "unavailable",
    fetchedAt: new Date().toISOString(),
    sampleIntervalSeconds: null,
    samples: [],
    summary: { temperatureC: null, apparentTemperatureC: null, relativeHumidityPercent: null, precipitationMm: null, windSpeedMps: null, windGustMps: null, headwindMps: null },
    message,
  };
}

export async function fetchHistoricalWeather(projection: AnalysisProjection, fetchImpl: typeof fetch = fetch): Promise<WeatherEnrichment> {
  const waypoints = routeWaypoints(projection);
  if (!waypoints.length) return unavailable(projection.activity.startedAt ? "No usable GPS route is available." : "The activity start time is unavailable.");
  try {
    const samples = await Promise.all(waypoints.map(async waypoint => {
      const date = waypoint.requestedAt.slice(0, 10);
      const params = new URLSearchParams({
        latitude: waypoint.latitude.toFixed(6),
        longitude: waypoint.longitude.toFixed(6),
        start_date: date,
        end_date: date,
        timezone: "UTC",
        wind_speed_unit: "ms",
        hourly: "temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,precipitation,surface_pressure,cloud_cover,wind_speed_10m,wind_gusts_10m,wind_direction_10m",
      });
      const response = await fetchImpl(`https://archive-api.open-meteo.com/v1/archive?${params}`, { headers: { Accept: "application/json" }, cache: "force-cache" });
      const payload = await response.json().catch(() => ({})) as OpenMeteoResponse;
      const times = payload.hourly?.time;
      if (!response.ok || !times?.length) throw new Error(payload.reason || `Open-Meteo returned ${response.status}.`);
      const hourly = payload.hourly!;
      const position = nearestHour(times, waypoint.requestedAt);
      const value = (key: keyof OpenMeteoHourly) => {
        const series = hourly[key];
        return Array.isArray(series) && finite(series[position] as number | null) ? series[position] as number : null;
      };
      const windSpeed = value("wind_speed_10m");
      const windDirection = value("wind_direction_10m");
      const wind = finite(windSpeed) && finite(windDirection) && finite(waypoint.bearing) ? windComponents(windSpeed, windDirection, waypoint.bearing) : null;
      return {
        index: waypoint.index,
        latitude: waypoint.latitude,
        longitude: waypoint.longitude,
        requestedAt: waypoint.requestedAt,
        observedAt: new Date(`${times[position]}${times[position].endsWith("Z") ? "" : "Z"}`).toISOString(),
        temperatureC: value("temperature_2m"),
        apparentTemperatureC: value("apparent_temperature"),
        relativeHumidityPercent: value("relative_humidity_2m"),
        dewPointC: value("dew_point_2m"),
        precipitationMm: value("precipitation"),
        pressureHpa: value("surface_pressure"),
        cloudCoverPercent: value("cloud_cover"),
        windSpeedMps: windSpeed,
        windGustMps: value("wind_gusts_10m"),
        windDirectionDegrees: windDirection,
        travelBearingDegrees: waypoint.bearing,
        headwindMps: wind?.headwindMps ?? null,
        crosswindMps: wind?.crosswindMps ?? null,
      } satisfies WeatherSample;
    }));
    return {
      version: WEATHER_VERSION,
      provider: "open-meteo",
      model: "historical-archive-hourly",
      status: "available",
      fetchedAt: new Date().toISOString(),
      sampleIntervalSeconds: samples.length > 1 ? (projection.streams.elapsed[samples.at(-1)!.index] - projection.streams.elapsed[samples[0].index]) / (samples.length - 1) : null,
      samples,
      summary: {
        temperatureC: mean(samples.map(sample => sample.temperatureC)),
        apparentTemperatureC: mean(samples.map(sample => sample.apparentTemperatureC)),
        relativeHumidityPercent: mean(samples.map(sample => sample.relativeHumidityPercent)),
        precipitationMm: samples.reduce((sum, sample) => sum + (sample.precipitationMm ?? 0), 0),
        windSpeedMps: mean(samples.map(sample => sample.windSpeedMps)),
        windGustMps: maximum(samples.map(sample => sample.windGustMps)),
        headwindMps: mean(samples.map(sample => sample.headwindMps)),
      },
    };
  } catch (error) {
    return { ...unavailable(error instanceof Error ? error.message : "Historical weather could not be loaded."), status: "failed" };
  }
}

export function applyWeatherChannels(projection: AnalysisProjection, weather: WeatherEnrichment): AnalysisProjection {
  if (weather.status !== "available" || !weather.samples.length) return { ...projection, weather };
  const channels = { ...projection.streams.channels };
  const definitions: Array<[Channel, keyof WeatherSample]> = [
    ["ambient_temperature", "temperatureC"],
    ["humidity", "relativeHumidityPercent"],
    ["wind_speed", "windSpeedMps"],
    ["headwind", "headwindMps"],
    ["precipitation", "precipitationMm"],
  ];
  for (const [channel, field] of definitions) {
    const values: Values = new Array(projection.streams.elapsed.length).fill(null);
    let sample = 0;
    for (let index = 0; index < values.length; index++) {
      while (sample < weather.samples.length - 1 && Math.abs(weather.samples[sample + 1].index - index) <= Math.abs(weather.samples[sample].index - index)) sample++;
      const value = weather.samples[sample][field];
      values[index] = finite(value as number | null) ? value as number : null;
    }
    if (values.some(finite)) channels[channel] = values;
  }
  return {
    ...projection,
    streams: { ...projection.streams, channels },
    weather,
    provenance: { ...projection.provenance, algorithms: { ...projection.provenance.algorithms, weather: WEATHER_VERSION } },
    derived: { ...projection.derived, weather: { version: WEATHER_VERSION, status: "available", sourceChannels: ["ambient_temperature", "humidity", "wind_speed", "headwind", "precipitation"] } },
  };
}
