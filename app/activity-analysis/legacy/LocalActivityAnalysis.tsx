"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import ActivityWorkspace from "../ActivityWorkspace";
import { loadBrowserFitFile } from "../../../lib/activity-analysis/browser";
import { projectActivity, type AnalysisProjection } from "../../../lib/activity-analysis/projection";
import type { DecodedFit, UnitSystem } from "../../../lib/activity-analysis/contracts";
import styles from "./local-analysis.module.css";

export default function LocalActivityAnalysis() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [projection, setProjection] = useState<AnalysisProjection | null>(null);
  const [decoded, setDecoded] = useState<DecodedFit | null>(null);
  const [units, setUnits] = useState<UnitSystem>("metric");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Choose a FIT file. It is decoded and analysed only in this browser tab.");

  async function open(file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      const analysed = await loadBrowserFitFile(file);
      setDecoded(analysed.parsed);
      setProjection(projectActivity(analysed.source, analysed.parsed));
      setMessage(`${file.name} decoded locally. Nothing was uploaded or persisted.`);
    } catch (error) {
      setDecoded(null); setProjection(null);
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  }

  return <main className={styles.page}>
    <header className={styles.topbar}>
      <div><Link href="/activity-analysis">← Activity Analysis</Link><strong>Private local FIT analysis</strong><span>Same projection, timeline, selection and map engine · no persistence</span></div>
      <div className={styles.controls}><label>Units<select value={units} onChange={event => setUnits(event.target.value as UnitSystem)}><option value="metric">Metric</option><option value="imperial">Imperial</option></select></label><button disabled={busy} onClick={() => inputRef.current?.click()}>{busy ? "Decoding…" : projection ? "Open another FIT" : "Choose FIT file"}</button></div>
      <input ref={inputRef} hidden type="file" accept=".fit" onChange={event => { void open(event.target.files?.[0]); event.currentTarget.value = ""; }} />
    </header>
    <div className={styles.notice}>{message}</div>
    {!projection || !decoded ? <section className={styles.empty} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void open(event.dataTransfer.files?.[0]); }}><strong>Drop a Garmin FIT file here</strong><span>The file never leaves the browser. OpenStreetMap street tiles are off by default for local files and can be enabled explicitly inside the map panel.</span><button onClick={() => inputRef.current?.click()}>Browse FIT files</button></section> : <section className={styles.workspace}><ActivityWorkspace projection={projection} units={units} loadRaw={async () => decoded} /></section>}
  </main>;
}
