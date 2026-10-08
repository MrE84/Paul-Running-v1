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
          <title id="progression-chart-title">Paul&apos;s recorded and projected 5K progression</title>
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

const TEN_K_Y_MIN = 2460;
const TEN_K_Y_MAX = 3120;
const TEN_K_STAGES = [
  { label: "Evesham", sublabel: "Prior 10K", result: "~51:00", seconds: 3060, kind: "actual" },
  { label: "Cheltenham", sublabel: "20 Sep", result: "48:59", seconds: 2939, kind: "actual" },
  { label: "Benchmark #1", sublabel: "15 Nov", result: "46:00", seconds: 2760, kind: "projection" },
  { label: "Benchmark #2", sublabel: "10 Jan", result: "44:00", seconds: 2640, kind: "projection" },
  { label: "Benchmark #3", sublabel: "7 Feb", result: "42:40", seconds: 2560, kind: "projection" },
] as const;
const TEN_K_TICKS = [3120, 3000, 2880, 2760, 2640, 2560, 2520, 2490] as const;

function xFor10K(index: number) {
  const usableWidth = PLOT_WIDTH - 70;
  return MARGIN.left + 35 + (index / (TEN_K_STAGES.length - 1)) * usableWidth;
}

function yFor10K(seconds: number) {
  return MARGIN.top + ((seconds - TEN_K_Y_MIN) / (TEN_K_Y_MAX - TEN_K_Y_MIN)) * PLOT_HEIGHT;
}

function tenKPoints(startIndex: number, endIndex: number) {
  return TEN_K_STAGES.slice(startIndex, endIndex + 1)
    .map((point, offset) => `${xFor10K(startIndex + offset)},${yFor10K(point.seconds)}`)
    .join(" ");
}

export function TenKProgressionChart() {
  const current = TEN_K_STAGES[1];
  const hmMarkerY = yFor10K(2560);

  return (
    <section className={styles.progressionSection} aria-labelledby="ten-k-progression-title">
      <div className={styles.headingRow}>
        <div>
          <span className="sectionKicker">10K DEVELOPMENT</span>
          <h2 id="ten-k-progression-title">10K progression &amp; projection</h2>
          <p>
            Recorded 10K markers plus the three formal benchmark gates in the master plan, building toward 42:40 HM-pace equivalence and the preferred 41:30–42:15 speed-reserve range.
          </p>
        </div>
        <span className={styles.projectionBadge}>Next benchmark · 15 Nov 2026</span>
      </div>

      <div className={styles.metricGrid}>
        <article><span>Current marker</span><strong>48:59</strong><small>Rolling 10K · Cheltenham Half</small></article>
        <article><span>Previous marker</span><strong>~51:00</strong><small>Evesham 10K</small></article>
        <article><span>Next gate</span><strong>&lt;46:00</strong><small>Formal 10K benchmark · 15 Nov</small></article>
        <article><span>HM marker</span><strong>42:40</strong><small>10K at 4:16/km HM target pace</small></article>
      </div>

      <div className={styles.chartShell}>
        <svg className={styles.chart} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-labelledby="ten-k-chart-title ten-k-chart-desc">
          <title id="ten-k-chart-title">Paul&apos;s recorded 10K markers and planned benchmark progression</title>
          <desc id="ten-k-chart-desc">Recorded markers of approximately 51 minutes at Evesham and 48 minutes 59 seconds as the fastest rolling 10K during the Cheltenham Half Marathon, followed by planned benchmark gates of sub-46 minutes on 15 November 2026, sub-44 minutes on 10 January 2027 and 42 minutes 40 seconds on 7 February 2027.</desc>

          {TEN_K_TICKS.map((tick) => (
            <g key={tick}>
              <line className={styles.gridLine} x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={yFor10K(tick)} y2={yFor10K(tick)} />
              <text className={styles.axisText} x={MARGIN.left - 12} y={yFor10K(tick) + 4} textAnchor="end">{formatTime(tick)}</text>
            </g>
          ))}

          {TEN_K_STAGES.map((stage, index) => (
            <g key={`${stage.label}-${stage.sublabel}`}>
              <line className={styles.gridLineVertical} x1={xFor10K(index)} x2={xFor10K(index)} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} />
              <text className={styles.axisText} x={xFor10K(index)} y={HEIGHT - 31} textAnchor="middle">
                <tspan x={xFor10K(index)}>{stage.label}</tspan>
                <tspan x={xFor10K(index)} dy="16">{stage.sublabel}</tspan>
              </text>
            </g>
          ))}

          <line className={styles.targetLine} x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={hmMarkerY} y2={hmMarkerY} />
          <text className={styles.targetLabel} x={WIDTH - MARGIN.right} y={hmMarkerY - 9} textAnchor="end">42:40 HM-pace marker</text>

          <polyline className={`${styles.series} ${styles.actual}`} points={tenKPoints(0, 1)} />
          <polyline className={`${styles.series} ${styles.central}`} points={tenKPoints(1, 4)} />

          {TEN_K_STAGES.map((stage, index) => (
            <g key={`${stage.label}-${stage.result}`}>
              <circle
                className={stage.kind === "actual" ? styles.actualPoint : styles.currentPoint}
                cx={xFor10K(index)}
                cy={yFor10K(stage.seconds)}
                r={stage.kind === "actual" ? "5" : "6"}
              />
              <title>{stage.label}: {stage.result}</title>
            </g>
          ))}

          <circle className={styles.currentPoint} cx={xFor10K(1)} cy={yFor10K(current.seconds)} r="7" />
          <text className={styles.currentLabel} x={xFor10K(1) + 12} y={yFor10K(current.seconds) - 12}>48:59 current marker</text>
        </svg>
      </div>

      <div className={styles.legend} aria-label="10K progression chart legend">
        <span><i className={styles.actualSwatch} />Recorded 10K markers</span>
        <span><i className={styles.centralSwatch} />Planned benchmark gates</span>
        <span><i className={styles.centralSwatch} />42:40 HM-pace marker</span>
      </div>

      <div className={styles.scenarioGrid}>
        <article>
          <span>Benchmark #1 · 15 Nov</span>
          <strong>&lt;46:00</strong>
          <small>First standalone 10K baseline and direct progression check</small>
        </article>
        <article>
          <span>Benchmark #2 · 10 Jan</span>
          <strong>&lt;44:00</strong>
          <small>Threshold and 10K-strength adaptation gate</small>
        </article>
        <article>
          <span>Benchmark #3 · 7 Feb</span>
          <strong>42:40</strong>
          <small>HM-pace equivalence; preferred speed reserve is 41:30–42:15</small>
        </article>
      </div>

      <p className={styles.caveat}>The 48:59 value is a rolling 10K from the Cheltenham Half Marathon, not a standalone 10K race. Future points are master-plan performance gates rather than guaranteed predictions; each formal 10K test should replace projection with measured race data.</p>
    </section>
  );
}
