const modules = [
  ["Athlete Profile", "LT1, LT2, zones, PBs and training capacities"],
  ["Training Calendar", "Planned and completed sessions with explicit dates and times"],
  ["Workout Builder", "Structured intervals, threshold, easy, long-run and stride sessions"],
  ["Training Plans", "Build and apply multi-week plans with versioned changes"],
  ["QA Engine", "Validate dates, targets, repeats, pace maths and Garmin-safe structure"],
  ["Activity Analysis", "FIT Activity Explorer V6 as the analysis foundation"],
  ["Garmin Sync", "Intervals.icu initially, behind a replaceable connector layer"],
  ["AI Coaching", "Safe APIs for ChatGPT-led review and approved plan changes"],
];

export default function Home() {
  return (
    <main>
      <section className="hero">
        <div className="eyebrow">PAUL&apos;S RUNNING · V1 FOUNDATION</div>
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
        {modules.map(([title, text]) => (
          <article className="card" key={title}>
            <div className="dot" />
            <h2>{title}</h2>
            <p>{text}</p>
          </article>
        ))}
      </section>

      <section className="status">
        <div>
          <span className="statusLabel">Current phase</span>
          <strong>Platform Foundation</strong>
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
