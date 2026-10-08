import Link from "next/link";
import { athleteProfile } from "../../lib/athlete-profile";
import { ProgressionChart } from "./progression-chart";

export default function AthleteProfilePage() {
  return (
    <main>
      <Link href="/" className="backLink">← Home</Link>
      <section className="athleteProfile" aria-labelledby="athlete-profile-title">
        <div className="athleteProfileHeader">
          <div>
            <span className="sectionKicker">ATHLETE PROFILE · PHYSIOLOGICAL SOURCE OF TRUTH</span>
            <h1 id="athlete-profile-title">Thresholds, zones, durability, PBs and training capacities</h1>
            <p>Current training anchors, HR zones, race-derived durability, performance progression and run-history context. Current athlete-state values take priority over the historical lactate report.</p>
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
                <div><strong>{threshold.name}</strong><small>{threshold.lactate}</small></div>
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

        <ProgressionChart />

        <article className="profilePanel capacitiesPanel" aria-labelledby="durability-title">
          <div className="panelHeading">
            <div>
              <span className="sectionKicker">RACE-DERIVED DURABILITY</span>
              <h2 id="durability-title">How long each HR band is currently sustainable</h2>
            </div>
            <span className="sourceBadge">Updated {athleteProfile.durability.updated}</span>
          </div>

          <div className="domainItem">
            <div><strong>{athleteProfile.durability.model}</strong><span>{athleteProfile.durability.basis}</span></div>
            <small>{athleteProfile.durability.note}</small>
          </div>

          <div className="domainHeading">
            <span className="sectionKicker">CHELTENHAM HALF EVIDENCE</span>
            <h2>Why the high-HR estimates are personal rather than generic</h2>
          </div>
          <div className="pbGrid">
            {athleteProfile.durability.raceEvidence.map((item) => (
              <div className="pbCard" key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <small>{item.detail}</small>
                <em>Race-derived working evidence</em>
              </div>
            ))}
          </div>

          <div className="domainHeading">
            <span className="sectionKicker">CURRENT ZONE DURABILITY</span>
            <h2>Working sustainable-duration ranges</h2>
          </div>
          <div className="capacityGrid">
            {athleteProfile.durability.zones.map((zone) => (
              <div className="capacityCard" key={zone.zone}>
                <span>{zone.zone} · {zone.heartRate}</span>
                <strong>{zone.duration}</strong>
                <p>{zone.detail}</p>
                <p><strong>Confidence:</strong> {zone.confidence}</p>
              </div>
            ))}
          </div>

          <div className="domainHeading">
            <span className="sectionKicker">Z5 HIGH-HR SUB-BANDS</span>
            <h2>Threshold+ is too broad for one sustainability number</h2>
          </div>
          <div className="domainList">
            {athleteProfile.durability.highHrBands.map((band) => (
              <div className="domainItem" key={band.range}>
                <div><strong>{band.range}</strong><span>{band.duration}</span></div>
                <small>{band.detail} · Confidence: {band.confidence}</small>
              </div>
            ))}
            <div className="domainItem">
              <div><strong>Training interpretation</strong><span>Durability metric</span></div>
              <small>{athleteProfile.durability.interpretation}</small>
            </div>
          </div>
        </article>

        <div className="profileSplit">
          <article className="profilePanel zonesPanel">
            <div className="panelHeading">
              <div><span className="sectionKicker">CURRENT HR ZONES</span><h2>Training zones</h2></div>
              <span className="sourceBadge">29 Sep 2026</span>
            </div>
            <div className="zoneTable" role="table" aria-label="Current running heart rate zones">
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
              <div><span className="sectionKicker">PERFORMANCE</span><h2>PBs &amp; current race target</h2></div>
              <span className="sourceBadge secondary">Run history</span>
            </div>
            <div className="pbGrid">
              {athleteProfile.personalBests.map((pb) => (
                <div className="pbCard" key={pb.distance}>
                  <span>{pb.distance}</span><strong>{pb.value}</strong><small>{pb.detail}</small><em>{pb.source}</em>
                </div>
              ))}
            </div>
            <div className="domainHeading"><span className="sectionKicker">PHYSIOLOGICAL DOMAINS</span><h2>Intensity boundaries</h2></div>
            <div className="domainList">
              {athleteProfile.domains.map((domain) => (
                <div className="domainItem" key={domain.name}>
                  <div><strong>{domain.name}</strong><span>{domain.range}</span></div><small>{domain.detail}</small>
                </div>
              ))}
            </div>
          </article>
        </div>
      </section>
    </main>
  );
}
