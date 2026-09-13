import Link from "next/link";
import { athleteProfile } from "@/lib/athlete-profile";

const modules = [
  ["Training Calendar", "Month view of past, current and upcoming sessions with protected Garmin delivery controls", "/training-calendar"],
  ["Workout Builder", "Structured intervals, threshold, easy, long-run and stride sessions", null],
  ["Training Plans", "Review coach-created plans and approval gates before they alter the canonical calendar", "/training-plans"],
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

      <Link href="/training-plans" className="approvalBanner">
        <div>
          <span className="approvalLabel">PLAN APPROVAL WORKFLOW</span>
          <strong>Post-Half Recovery Week</strong>
          <p>Review the 21–27 September recovery plan and open its post-race approval-and-sync workflow.</p>
        </div>
        <span className="approvalCta">Review plan →</span>
      </Link>

      <section className="athleteProfile" aria-labelledby="athlete-profile-title">
        <div className="athleteProfileHeader">
          <div>
            <span className="sectionKicker">ATHLETE PROFILE · PHYSIOLOGICAL SOURCE OF TRUTH</span>
            <h2 id="athlete-profile-title">Thresholds, zones, PBs and training capacities</h2>
            <p>
              Read-only athlete profile derived from the official lactate assessment and current run history.
              Measured LT1/LT2 take priority over generic HRR estimates for training prescription.
            </p>
          </div>
          <div className="testMeta">
            <span>{athleteProfile.test.name}</span>
            <strong>{athleteProfile.test.date}</strong>
            <small>{athleteProfile.test.clinic} · {athleteProfile.test.analyser}</small>
          </div>
        </div>

        <div className="thresholdGrid">
          {athleteProfile.thresholds.map((threshold) => (
            <article className="thresholdCard" key={threshold.key}>
              <div className="thresholdTitle">
                <span>{threshold.key}</span>
                <div>
                  <strong>{threshold.name}</strong>
                  <small>{threshold.lactate}</small>
                </div>
              </div>
              <div className="thresholdNumbers">
                <div><span>Pace</span><strong>{threshold.pace}</strong></div>
                <div><span>Heart rate</span><strong>{threshold.heartRate}</strong></div>
                <div><span>Speed</span><strong>{threshold.speed}</strong></div>
              </div>
              <p>{threshold.description}</p>
            </article>
          ))}
        </div>

        <div className="profileSplit">
          <article className="profilePanel zonesPanel">
            <div className="panelHeading">
              <div><span className="sectionKicker">OFFICIAL 5-ZONE MODEL</span><h3>Training zones</h3></div>
              <span className="sourceBadge">Lactate report</span>
            </div>
            <div className="zoneTable" role="table" aria-label="Official lactate training zones">
              {athleteProfile.zones.map((zone) => (
                <div className="zoneRow" role="row" key={zone.zone}>
                  <span className={`zoneBadge ${zone.zone.toLowerCase()}`}>{zone.zone}</span>
                  <div className="zoneName"><strong>{zone.name}</strong><small>{zone.share}</small></div>
                  <div><span>Pace</span><strong>{zone.pace}</strong></div>
                  <div><span>HR</span><strong>{zone.heartRate}</strong></div>
                </div>
              ))}
            </div>
          </article>

          <article className="profilePanel">
            <div className="panelHeading">
              <div><span className="sectionKicker">PERFORMANCE</span><h3>PBs & current race target</h3></div>
              <span className="sourceBadge secondary">Run history</span>
            </div>
            <div className="pbGrid">
              {athleteProfile.personalBests.map((pb) => (
                <div className="pbCard" key={pb.distance}>
                  <span>{pb.distance}</span>
                  <strong>{pb.value}</strong>
                  <small>{pb.detail}</small>
                  <em>{pb.source}</em>
                </div>
              ))}
            </div>

            <div className="domainHeading"><span className="sectionKicker">PHYSIOLOGICAL DOMAINS</span><h3>Intensity boundaries</h3></div>
            <div className="domainList">
              {athleteProfile.domains.map((domain) => (
                <div className="domainItem" key={domain.name}>
                  <div><strong>{domain.name}</strong><span>{domain.range}</span></div>
                  <small>{domain.detail}</small>
                </div>
              ))}
            </div>
          </article>
        </div>

        <article className="profilePanel capacitiesPanel">
          <div className="panelHeading">
            <div><span className="sectionKicker">TRAINING CAPACITIES</span><h3>How the test should shape training</h3></div>
            <span className="sourceBadge">Official recommendations</span>
          </div>
          <div className="capacityGrid">
            {athleteProfile.capacities.map((capacity) => (
              <div className="capacityCard" key={capacity.label}>
                <span>{capacity.label}</span>
                <strong>{capacity.value}</strong>
                <p>{capacity.detail}</p>
              </div>
            ))}
          </div>
        </article>
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
          <strong>AI Coaching &amp; Automation</strong>
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
