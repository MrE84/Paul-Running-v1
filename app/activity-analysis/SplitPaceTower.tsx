"use client";

import { useMemo, useState } from "react";
import { buildKilometreSplits, type KilometreSplit } from "../../lib/activity-analysis/kilometre-splits";
import type { AnalysisProjection } from "../../lib/activity-analysis/projection";
import styles from "./split-pace-tower.module.css";

type MetricKey = "pace" | "heartRate" | "fatOxidation";

const METRICS: Record<MetricKey, { label: string; color: string; available: (split: KilometreSplit) => boolean }> = {
  pace: { label: "Pace", color: "#60a5fa", available: () => true },
  heartRate: { label: "Heart rate", color: "#ef4444", available: split => split.averageHeartRate != null },
  fatOxidation: { label: "Fat oxidation", color: "#4ade80", available: split => split.fatOxidationGrams != null },
};

function formatPace(seconds: number) {
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  return `${minutes}:${String(rounded % 60).padStart(2, "0")}/km`;
}

function formatDelta(seconds: number | null) {
  if (seconds == null) return "";
  const rounded = Math.round(seconds);
  if (rounded === 0) return "±0:00";
  const sign = rounded > 0 ? "+" : "−";
  const absolute = Math.abs(rounded);
  return `${sign}${Math.floor(absolute / 60)}:${String(absolute % 60).padStart(2, "0")}`;
}

function valueForMetric(split: KilometreSplit, metric: MetricKey): number | null {
  if (metric === "pace") return split.paceSecondsPerKm;
  if (metric === "heartRate") return split.averageHeartRate;
  return split.fatOxidationGrams;
}

function formatMetricValue(split: KilometreSplit, metric: MetricKey) {
  if (metric === "pace") return formatPace(split.paceSecondsPerKm);
  if (metric === "heartRate") return split.averageHeartRate == null ? "—" : `${Math.round(split.averageHeartRate)} bpm`;
  return split.fatOxidationGrams == null ? "—" : `${split.fatOxidationGrams.toFixed(1)} g`;
}

function normalizedMetricValues(splits: KilometreSplit[], metric: MetricKey): Array<number | null> {
  const values = splits.map(split => valueForMetric(split, metric));
  const finite = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (!finite.length) return values.map(() => null);
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const spread = Math.max(0.0001, max - min);

  return values.map(value => {
    if (value == null || !Number.isFinite(value)) return null;
    const fraction = (value - min) / spread;
    return metric === "pace" ? 1 - fraction : fraction;
  });
}

export default function SplitPaceTower({ projection }: { projection: AnalysisProjection }) {
  const splits = useMemo(() => buildKilometreSplits(projection), [projection]);
  const [selectedMetrics, setSelectedMetrics] = useState<MetricKey[]>(["pace"]);

  const range = useMemo(() => {
    if (!splits.length) return { fastest: 0, slowest: 0 };
    const paces = splits.map(split => split.paceSecondsPerKm);
    return { fastest: Math.min(...paces), slowest: Math.max(...paces) };
  }, [splits]);

  const availableMetrics = useMemo(() => (Object.keys(METRICS) as MetricKey[]).filter(metric => splits.some(METRICS[metric].available)), [splits]);
  const normalized = useMemo(() => Object.fromEntries(availableMetrics.map(metric => [metric, normalizedMetricValues(splits, metric)])) as Partial<Record<MetricKey, Array<number | null>>>, [availableMetrics, splits]);

  if (splits.length < 2) return null;

  const width = Math.max(720, splits.length * 58 + 80);
  const height = 280;
  const left = 42;
  const right = 24;
  const top = 24;
  const bottom = 50;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const xFor = (index: number) => left + (splits.length === 1 ? plotWidth / 2 : (index / (splits.length - 1)) * plotWidth);
  const yFor = (value: number) => top + (1 - value) * plotHeight;

  function toggleMetric(metric: MetricKey) {
    setSelectedMetrics(current => {
      if (current.includes(metric)) {
        if (current.length === 1) return current;
        return current.filter(value => value !== metric);
      }
      return [...current, metric];
    });
  }

  return <section className={styles.card} aria-label="Kilometre metrics breakdown">
    <div className={styles.heading}>
      <div>
        <span>KILOMETRE BREAKDOWN</span>
        <h2>Pace, heart rate & fat oxidation</h2>
      </div>
      <p>Select one or more metrics to overlay them by kilometre. Each series is scaled to its own observed range so trends can be compared; hover a point for the actual value.</p>
    </div>

    <div className={styles.metricToggles} aria-label="Kilometre chart metrics">
      {availableMetrics.map(metric => <button
        key={metric}
        type="button"
        aria-pressed={selectedMetrics.includes(metric)}
        className={selectedMetrics.includes(metric) ? styles.metricActive : ""}
        onClick={() => toggleMetric(metric)}
      >
        <i style={{ background: METRICS[metric].color }} />
        {METRICS[metric].label}
      </button>)}
    </div>

    <div className={styles.chartScroller}>
      <svg className={styles.metricChart} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Per-kilometre ${selectedMetrics.map(metric => METRICS[metric].label.toLowerCase()).join(", ")} chart`}>
        {[0, 0.25, 0.5, 0.75, 1].map(level => <line key={level} x1={left} x2={width - right} y1={yFor(level)} y2={yFor(level)} className={styles.gridLine} />)}
        {splits.map((split, index) => <g key={`axis-${split.id}`}>
          <line x1={xFor(index)} x2={xFor(index)} y1={top} y2={height - bottom} className={styles.verticalGridLine} />
          <text x={xFor(index)} y={height - 22} textAnchor="middle" className={styles.axisLabel}>{split.label}</text>
        </g>)}
        <text x={left} y={height - 4} className={styles.axisCaption}>Kilometre</text>

        {selectedMetrics.map(metric => {
          const values = normalized[metric] ?? [];
          const points = values.map((value, index) => value == null ? null : `${xFor(index)},${yFor(value)}`).filter(Boolean).join(" ");
          return <g key={metric}>
            {points && <polyline points={points} fill="none" stroke={METRICS[metric].color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />}
            {values.map((value, index) => value == null ? null : <circle key={`${metric}-${splits[index].id}`} cx={xFor(index)} cy={yFor(value)} r="5" fill={METRICS[metric].color} className={styles.chartPoint}>
              <title>{`KM ${splits[index].label} · ${METRICS[metric].label}: ${formatMetricValue(splits[index], metric)}`}</title>
            </circle>)}
          </g>;
        })}
      </svg>
    </div>

    <div className={styles.legend}>
      {selectedMetrics.map(metric => <span key={metric}><i style={{ background: METRICS[metric].color }} />{METRICS[metric].label}</span>)}
      <small>Overlay is normalised per metric; pace is inverted so faster plots higher.</small>
    </div>

    <div className={styles.splitMetrics}>
      <div className={styles.splitMetricHeader}><strong>KM</strong><strong>Pace</strong><strong>Avg HR</strong><strong>Fat</strong></div>
      {splits.map(split => <div className={styles.splitMetricRow} key={`metrics-${split.id}`}>
        <strong>{split.label}</strong>
        <span>{formatPace(split.paceSecondsPerKm)}</span>
        <span>{split.averageHeartRate == null ? "—" : `${Math.round(split.averageHeartRate)} bpm`}</span>
        <span>{split.fatOxidationGrams == null ? "—" : `${split.fatOxidationGrams.toFixed(1)} g`}</span>
      </div>)}
    </div>

    <section className={styles.paceTowerSection} aria-label="Original kilometre pace tower">
      <div className={styles.paceTowerHeading}>
        <div>
          <span>PACE BREAKDOWN</span>
          <h3>Kilometre pace tower</h3>
        </div>
        <p>Original pace view retained alongside the new overlay chart. Longer bars indicate faster kilometres; +/- is the change versus the previous split.</p>
      </div>
      <div className={styles.columns} aria-hidden="true">
        <strong>KM</strong><strong>AVG PACE</strong><strong>+/-</strong>
      </div>
      <div className={styles.rows}>
        {splits.map(split => {
          const spread = Math.max(1, range.slowest - range.fastest);
          const fasterFraction = (range.slowest - split.paceSecondsPerKm) / spread;
          const barWidth = 68 + fasterFraction * 32;
          const deltaClass = split.deltaSeconds == null || Math.round(split.deltaSeconds) === 0
            ? styles.same
            : split.deltaSeconds > 0 ? styles.faster : styles.slower;
          const partial = split.distanceMeters < 999.5;

          return <div className={styles.row} key={split.id}>
            <span className={styles.km}>{split.label}</span>
            <div className={styles.track} title={`${partial ? "Final partial split" : `Kilometre ${split.label}`}: ${formatPace(split.paceSecondsPerKm)}`}>
              <div className={styles.bar} style={{ width: `${barWidth}%` }} />
              <strong className={styles.pace}>{formatPace(split.paceSecondsPerKm)}</strong>
            </div>
            <span className={`${styles.delta} ${deltaClass}`}>{formatDelta(split.deltaSeconds)}</span>
          </div>;
        })}
      </div>
    </section>

    <div className={styles.footer}>
      <span>{splits.length - (splits.at(-1)!.distanceMeters < 999.5 ? 1 : 0)} full kilometres</span>
      {splits.at(-1)!.distanceMeters < 999.5 && <span>Final partial: {(splits.at(-1)!.distanceMeters / 1000).toFixed(2)} km</span>}
      <span>Fat oxidation is HR-derived, not indirect-calorimetry measured.</span>
    </div>
  </section>;
}
