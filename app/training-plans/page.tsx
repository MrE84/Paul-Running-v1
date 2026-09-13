import type { Metadata } from "next";
import Link from "next/link";
import styles from "./training-plans.module.css";

export const metadata: Metadata = {
  title: "Training Plans & Approvals · Paul's Running",
  description: "Review AI-created training plans and open approval workflows before they alter the canonical calendar or Garmin delivery queue.",
};

export default function TrainingPlansPage() {
  return (
    <main className={styles.page}>
      <div className={styles.topbar}>
        <Link href="/" className={styles.back}>← Paul&apos;s Running</Link>
        <span className={styles.badge}>PLAN APPROVALS</span>
      </div>

      <section className={styles.hero}>
        <div className={styles.eyebrow}>TRAINING PLANS</div>
        <h1>Review before anything reaches your calendar.</h1>
        <p>
          This is the approval centre for coach-created plans. A proposed plan can be reviewed here first;
          only its own approval workflow can write it into Paul&apos;s Running and evaluate Garmin delivery.
        </p>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.sectionEyebrow}>CURRENT APPROVAL WORKFLOW</span>
            <h2>Post-Half Recovery Week</h2>
          </div>
          <span className={styles.status}>APPROVAL GATE</span>
        </div>

        <div className={styles.planGrid}>
          <div className={styles.planSummary}>
            <strong>21–27 September 2026</strong>
            <p>
              Four deliberately conservative recovery sessions after the Cheltenham Half Marathon, with rest days between them and no threshold, hills, strides or hard parkrun.
            </p>
            <div className={styles.meta}>
              <span>4 structured sessions</span>
              <span>Starts Monday 21 Sep</span>
              <span>Garmin-safe auto-advancing steps</span>
            </div>
          </div>

          <div className={styles.actionCard}>
            <strong>Approval is intentionally separate</strong>
            <p>
              Open the plan to review every session. The final approve-and-sync control remains locked until after the half marathon, then uses the existing Paul&apos;s Running → QA → Garmin bridge workflow.
            </p>
            <Link href="/recovery-week" className={styles.primaryLink}>Open recovery plan →</Link>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.sectionEyebrow}>CANONICAL SCHEDULE</span>
            <h2>See approved training by month</h2>
          </div>
        </div>
        <p className={styles.supporting}>
          Once plans have been applied, their sessions live in the canonical training calendar rather than on this approval page.
        </p>
        <Link href="/training-calendar" className={styles.secondaryLink}>Open training calendar →</Link>
      </section>
    </main>
  );
}
