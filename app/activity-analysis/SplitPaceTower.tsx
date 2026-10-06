"use client";

import { useMemo } from "react";
import { buildKilometreSplits } from "../../lib/activity-analysis/kilometre-splits";
import type { AnalysisProjection } from "../../lib/activity-analysis/projection";
import styles from "./split-pace-tower.module.css";

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

export default function SplitPaceTower({ projection }: { projection: AnalysisProjection }) {
  const splits = useMemo(() => buildKilometreSplits(projection), [projection]);

  const range = useMemo(() => {
    if (!splits.length) return { fastest: 0, slowest: 0 };
    const paces = splits.map(split => split.paceSecondsPerKm);
    return { fastest: Math.min(...paces), slowest: Math.max(...paces) };
  }, [splits]);

  if (splits.length < 2) return null;

  return <section className={styles.card} aria-label="Kilometre pace breakdown">
    <div className={styles.heading}>
      <div>
        <span>PACE BREAKDOWN</span>
        <h2>Kilometre pace tower</h2>
      </div>
      <p>Each bar is one kilometre from the recorded distance trace. Longer means faster. The +/- column is the pace change versus the previous split.</p>
    </div>

    <div className={styles.columns} aria-hidden="true">
      <strong>KM</strong><strong>AVG PACE</strong><strong>+/-</strong>
    </div>

    <div className={styles.rows}>
      {splits.map(split => {
        const spread = Math.max(1, range.slowest - range.fastest);
        const fasterFraction = (range.slowest - split.paceSecondsPerKm) / spread;
        const width = 68 + fasterFraction * 32;
        const deltaClass = split.deltaSeconds == null || Math.round(split.deltaSeconds) === 0
          ? styles.same
          : split.deltaSeconds > 0 ? styles.faster : styles.slower;
        const partial = split.distanceMeters < 999.5;

        return <div className={styles.row} key={split.id}>
          <span className={styles.km}>{split.label}</span>
          <div className={styles.track} title={`${partial ? "Final partial split" : `Kilometre ${split.label}`}: ${formatPace(split.paceSecondsPerKm)}`}>
            <div className={styles.bar} style={{ width: `${width}%` }} />
            <strong className={styles.pace}>{formatPace(split.paceSecondsPerKm)}</strong>
          </div>
          <span className={`${styles.delta} ${deltaClass}`}>{formatDelta(split.deltaSeconds)}</span>
        </div>;
      })}
    </div>

    <div className={styles.footer}>
      <span>{splits.length - (splits.at(-1)!.distanceMeters < 999.5 ? 1 : 0)} full kilometres</span>
      {splits.at(-1)!.distanceMeters < 999.5 && <span>Final partial: {(splits.at(-1)!.distanceMeters / 1000).toFixed(2)} km</span>}
    </div>
  </section>;
}
