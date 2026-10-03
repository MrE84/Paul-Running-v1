import type { Metadata } from "next";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { readTrainingProgramme } from "../../lib/training-programme/content";
import sessions from "../../lib/training-programme/scheduled-workouts.json";
import WorkoutSteps from "./WorkoutSteps";
import styles from "./master-plan.module.css";

export const metadata: Metadata = {
  title: "Master Plan · Paul's Running",
  description: "Paul's 1:30 half-marathon master plan, weekly coaching guidance and corrected October–November workout programme.",
};

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", weekday: "long", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
});

function PlanDocument({ content }: { content: string }) {
  return <div className={styles.document}><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    h1: ({ children }) => <h2>{children}</h2>,
    h2: ({ children }) => <h3>{children}</h3>,
    h3: ({ children }) => <h4>{children}</h4>,
    table: ({ children }) => <div className={styles.tableScroll}><table>{children}</table></div>,
  }}>{content}</ReactMarkdown></div>;
}

export default async function MasterPlanPage() {
  const { master, weeks } = await readTrainingProgramme();
  return (
    <main className={styles.page}>
      <Link className={styles.back} href="/training-plans">← Training Plans</Link>
      <section className={styles.hero}>
        <span className={styles.eyebrow}>THE ROAD TO 1:30</span>
        <h1>Master training plan</h1>
        <p>Build the speed, threshold strength and durability to sustain 4:16/km for a half marathon.</p>
        <div className={styles.metrics}>
          <div><span>Target race</span><strong>21 March 2027</strong></div>
          <div><span>Half-marathon goal</span><strong>1:30:00</strong></div>
          <div><span>Current 5K benchmark</span><strong>22:47 · 3 Oct</strong></div>
          <div><span>Benchmark race</span><strong>20 February 2027</strong></div>
        </div>
      </section>
      <nav className={styles.jumpLinks} aria-label="Plan sections">
        <a href="#master">Full master plan</a><a href="#programme">Workout programme</a><a href="#weeks">Weekly guidance</a>
      </nav>
      <section id="master" className={styles.section} aria-label="Full master plan">
        <PlanDocument content={master} />
      </section>
      <section id="programme" className={styles.section}>
        <span className={styles.eyebrow}>5 OCTOBER–9 NOVEMBER 2026</span>
        <h2>Corrected workout programme</h2>
        <p>26 running sessions. Long runs on Mondays, threshold on Wednesdays, easy runs on Thursdays, parkruns on Saturdays at 09:00, recovery on Sundays. Tuesdays are strength/rest; Fridays are rest.</p>
        <p>This is the programme already scheduled in Tredict for Garmin delivery. Times below use UK local time, including the October clock change. Open each session for the exact workout steps. Expected heart rates are guidance, not targets to force.</p>
        <div className={styles.sessions}>
          {sessions.map((session) => (
            <details key={session.id} className={styles.session}>
              <summary><time dateTime={session.scheduledStart}>{dateFormat.format(new Date(session.scheduledStart))}</time><strong>{session.title}</strong></summary>
              <p>{session.notes}</p>
              <WorkoutSteps steps={session.workout.steps} />
              <a href={`https://www.tredict.com/app/training/activity/${session.id}`} target="_blank" rel="noreferrer">Open scheduled workout in Tredict ↗</a>
            </details>
          ))}
        </div>
      </section>
      <section id="weeks" className={styles.section}>
        <h2>Weekly coaching guidance</h2>
        <p>Daily purpose, pace ranges and expected heart-rate response. Use the workout programme above for the exact programmed steps.</p>
        {weeks.map((week, index) => (
          <details key={index} className={styles.week}>
            <summary>{week.split("\n")[0].replace(/^# /, "")}</summary>
            <PlanDocument content={week} />
          </details>
        ))}
      </section>
    </main>
  );
}
