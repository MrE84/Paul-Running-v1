import { athleteProfile } from "../../lib/athlete-profile";
import styles from "./progression.module.css";

const WIDTH = 1000;
const HEIGHT = 430;
const MARGIN = { top: 28, right: 36, bottom: 58, left: 72 };
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;
const X_MIN = Date.parse("2026-05-30T00:00:00Z");
const X_MAX = Date.parse("2026-12-26T00:00:00Z");
const Y_MIN = 1260;
const Y_MAX = 1800;

function xFor(date: string) {
  return MARGIN.left + ((Date.parse(`${date}T00:00:00Z`) - X_MIN) / (X_MAX - X_MIN)) * PLOT_WIDTH;
}

function yFor(seconds: number) {
  return MARGIN.top + ((seconds - Y_MIN) / (Y_MAX - Y_MIN)) * PLOT_HEIGHT;
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}:${remaining.toString().padStart(2, "0")}`;
}

function pointsFor(points: readonly { date: string; seconds: number }[]) {
  return points.map((point) => `${xFor(point.date)},${yFor(point.seconds)}`).join(" ");
}

const yTicks = [1800, 1680, 1560, 1440, 1320, 1280] as const;
const xTicks = [
  ["2026-05-30", "May"],
  ["2026-07-01", "Jul"],
  ["2026-09-01", "Sep"],
  ["2026-10-03", "Oct"],
  ["2026-11-01", "Nov"],
  ["2026-12-01", "Dec"],
] as const;

export function ProgressionChart() {
  const progression = athleteProfile.progression;
  const targetY = yFor(1280);
  const current = progression.actual[progression.actual.length - 1];

  return (
    <section className={styles.progressionSection} aria-labelledby="progression-title">
      <div className={styles.headingRow}>
        <div>
          <span className="sectionKicker">CURRENT PROGRESSION</span>
          <h2 id="progression-title">5K progression &amp; projection</h2>
          <p>
            Recorded PB progression plus three linear planning scenarios toward the {progression.targetTime} 5K marker.
          </p>
        </div>
        <span className={styles.projectionBadge}>Working projection · {progression.workingProjection}</span>
      </div>

      <div className={styles.metricGrid}>
        <article><span>Current PB</span><strong>{progression.currentPb}</strong><small>{progression.currentDate}</small></article>
        <article><span>Recent trend</span><strong>{progression.recentRate}</strong><small>Observed planning range</small></article>
        <article><span>Next gate</span><strong>{progression.nextGate}</strong><small>Formal 5K milestone</small></article>
        <article><span>HM marker</span><strong>{progression.targetTime}</strong><small>{progression.targetMeaning}</small></article>
      </div>

      <div className={styles.chartShell}>
        <svg className={styles.chart} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-labelledby="progression-chart-title progression-chart-desc">
          <title id="progression-chart-title">Paul's recorded and projected 5K progression</title>
          <desc id="progression-chart-desc">Recorded 5K results from 29 minutes 46 seconds on 30 May 2026 to 22 minutes 47 seconds on 3 October 2026, followed by projected 15, 20 and 25 second improvements every two weeks toward 21 minutes 20 seconds.</desc>

          {yTicks.map((tick) => (
            <g key={tick}>
              <line className={styles.gridLine} x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={yFor(tick)} y2={yFor(tick)} />
              <text className={styles.axisText} x={MARGIN.left - 12} y={yFor(tick) + 4} textAnchor="end">{formatTime(tick)}</text>
            </g>
          ))}

          {xTicks.map(([date, label]) => (
            <g key={date}>
              <line className={styles.gridLineVertical} x1={xFor(date)} x2={xFor(date)} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} />
              <text className={styles.axisText} x={xFor(date)} y={HEIGHT - 24} textAnchor="middle">{label}</text>
            </g>
          ))}

          <line className={styles.targetLine} x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={targetY} y2={targetY} />
          <text className={styles.targetLabel} x={WIDTH - MARGIN.right} y={targetY - 9} textAnchor="end">21:20 HM-pace marker</text>

          <polyline className={`${styles.series} ${styles.actual}`} points={pointsFor(progression.actual)} />
          {progression.actual.map((point) => (
            <g key={point.date}>
              <circle className={styles.actualPoint} cx={xFor(point.date)} cy={yFor(point.seconds)} r="5" />
              <title>{point.label}: {point.result}</title>
            </g>
          ))}

          {progression.projections.map((projection) => (
            <polyline
              key={projection.key}
              className={`${styles.series} ${styles[projection.key]}`}
              points={pointsFor(projection.points)}
            />
          ))}

          <circle className={styles.currentPoint} cx={xFor(current.date)} cy={yFor(current.seconds)} r="7" />
          <text className={styles.currentLabel} x={xFor(current.date) + 12} y={yFor(current.seconds) - 12}>{current.result} current PB</text>
        </svg>
      </div>

      <div className={styles.legend} aria-label="Progression chart legend">
        <span><i className={styles.actualSwatch} />Recorded PBs</span>
        <span><i className={styles.fastSwatch} />25 sec / fortnight</span>
        <span><i className={styles.centralSwatch} />20 sec / fortnight</span>
        <span><i className={styles.slowSwatch} />15 sec / fortnight</span>
      </div>

      <div className={styles.scenarioGrid}>
        {progression.projections.map((projection) => (
          <article key={projection.key}>
            <span>{projection.label}</span>
            <strong>{projection.crossing}</strong>
            <small>{projection.rate} to reach 21:20</small>
          </article>
        ))}
      </div>

      <p className={styles.caveat}>{progression.caveat}</p>
    </section>
  );
}
