import Link from "next/link";

const modules = [
  ["Athlete Profile", "LT1, LT2, zones, PBs and training capacities", null],
  ["Training Calendar", "Planned and completed sessions with explicit dates and times", null],
  ["Workout Builder", "Structured intervals, threshold, easy, long-run and stride sessions", null],
  ["Training Plans", "Build and apply multi-week plans with versioned changes", null],
  ["QA Engine", "Validate dates, targets, repeats, pace maths and Garmin-safe structure", null],
  ["Activity Analysis", "FIT Activity Explorer integrated with private browser-local decoding", "/activity-analysis"],
  ["Garmin Sync", "Intervals.icu initially, behind a replaceable connector layer", null],
  ["AI Coaching", "Safe APIs for ChatGPT-led review and approved plan changes", null],
] as const;

export default function Home() {
  return (
    <main>
      <section className="hero">
        <div className="eyebrow">PAUL&apos;S RUNNING · V1</div>
        <h1>Your training. Your data. One platform.</h1>
        <p>
          A cloud-hosted running platform for planning, structured workouts, Garmin delivery,
          activity analysis and AI-assisted coaching.
        </p>
        <div className="flow">
          <span>ChatGPT / Web App</span><b>→</b><span>Paul&apos;s Running</span><b>→</b><span>QA</span><b>→</b><span>Garmin bridge</span><b>→</b><span>Watch</span>
        </div>
      </section>

      <section className="grid" aria-label="Platform modules">
        {modules.map(([title, text, href]) => {
          const content = <><div className="dot" /><h2>{title}</h2><p>{text}</p>{href && <span className="moduleLink">Open workspace →</span>}</>;
          return href
            ? <Link className="card cardLink" href={href} key={title}>{content}</Link>
            : <article className="card" key={title}>{content}</article>;
        })}
      </section>

      <section className="status">
        <div>
          <span className="statusLabel">Current phase</span>
          <strong>Training &amp; Analysis Core</strong>
        </div>
        <div>
          <span className="statusLabel">Source of truth</span>
          <strong>Paul&apos;s Running database</strong>
        </div>
        <div>
          <span className="statusLabel">Deployment target</span>
          <strong>Vercel</strong>
        </div>
      </section>
    </main>
  );
}
