"use client";

import { useCallback, useEffect, useState } from "react";
import type { ActivityDebriefView, DebriefSource } from "../../../lib/debriefs/contracts";
import { DEBRIEF_LIMITS } from "../../../lib/debriefs/contracts";
import styles from "./debrief.module.css";

type ApiEnvelope<T> = { data?: T; error?: { code?: string; message?: string } };

class DebriefApiError extends Error {
  constructor(message: string, readonly code?: string) { super(message); }
}

async function debriefApi(activityId: string, init?: RequestInit): Promise<ActivityDebriefView | null> {
  const response = await fetch(`/api/v1/activities/${encodeURIComponent(activityId)}/debrief`, {
    ...init,
    cache: "no-store",
    headers: {
      "X-Client-Id": "activity-analysis-debrief",
      "X-Request-Id": crypto.randomUUID(),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  const payload = await response.json().catch(() => ({})) as ApiEnvelope<ActivityDebriefView | null>;
  if (!response.ok || payload.data === undefined) {
    throw new DebriefApiError(payload.error?.message ?? `${response.status} ${response.statusText}`, payload.error?.code);
  }
  return payload.data;
}

const SECTIONS = [
  { key: "bodyFeel", label: "How the body felt", prompt: "Legs, breathing, niggles. How did it feel early on versus at the end?" },
  { key: "mentalState", label: "Mind", prompt: "Motivation, confidence, mindset. Was there a point you wanted to stop?" },
  { key: "context", label: "Context", prompt: "Sleep, food, stress, kit, time since your last run, anything unusual." },
  { key: "planNotes", label: "Versus the plan", prompt: "What differed from the plan, and why?" },
  { key: "learnings", label: "What I learned", prompt: "What went well, and what would you change next time?" },
] as const;

type FieldKey = (typeof SECTIONS)[number]["key"];
type Form = Record<FieldKey, string> & { rpe: string };

const SOURCE_LABEL: Record<DebriefSource, string> = { "voice-chat": "Voice chat with Claude", "text-chat": "Chat with Claude", "web-edit": "Edited on the website" };

const RPE_OPTIONS = Array.from({ length: Math.round((DEBRIEF_LIMITS.rpeMax - DEBRIEF_LIMITS.rpeMin) / DEBRIEF_LIMITS.rpeStep) + 1 }, (_, index) => DEBRIEF_LIMITS.rpeMin + index * DEBRIEF_LIMITS.rpeStep);

function formFrom(debrief: ActivityDebriefView | null): Form {
  return {
    rpe: debrief?.rpe !== undefined ? String(debrief.rpe) : "",
    bodyFeel: debrief?.bodyFeel ?? "",
    mentalState: debrief?.mentalState ?? "",
    context: debrief?.context ?? "",
    planNotes: debrief?.planNotes ?? "",
    learnings: debrief?.learnings ?? "",
  };
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
}

export default function DebriefPanel({ activityId }: { activityId: string }) {
  const [debrief, setDebrief] = useState<ActivityDebriefView | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Form>(formFrom(null));
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);

  const load = useCallback(async () => {
    setError(""); setConflict(false);
    try { setDebrief(await debriefApi(activityId)); }
    catch (value) { setError(value instanceof Error ? value.message : String(value)); setDebrief(null); }
  }, [activityId]);

  useEffect(() => { setDebrief(undefined); setEditing(false); void load(); }, [load]);

  const startEditing = () => { setForm(formFrom(debrief ?? null)); setError(""); setConflict(false); setEditing(true); };

  async function save() {
    setSaving(true); setError(""); setConflict(false);
    try {
      const saved = await debriefApi(activityId, {
        method: "PUT",
        body: JSON.stringify({
          rpe: form.rpe === "" ? null : Number(form.rpe),
          bodyFeel: form.bodyFeel, mentalState: form.mentalState, context: form.context, planNotes: form.planNotes, learnings: form.learnings,
          source: "web-edit",
          expectedVersion: debrief?.version ?? 0,
        }),
      });
      setDebrief(saved); setEditing(false);
    } catch (value) {
      if (value instanceof DebriefApiError && value.code === "VERSION_CONFLICT") setConflict(true);
      setError(value instanceof Error ? value.message : String(value));
    } finally { setSaving(false); }
  }

  const header = <div className={styles.heading}>
    <div><span className={styles.eyebrow}>DEBRIEF</span><h3>How it felt</h3></div>
    {!editing && debrief !== undefined && <button className={styles.secondary} onClick={startEditing}>{debrief ? "Edit debrief" : "Add debrief"}</button>}
  </div>;

  if (debrief === undefined) return <section id="debrief" className={styles.panel} aria-busy="true">{header}<p className={styles.muted}>Loading debrief…</p></section>;

  if (editing) return <section id="debrief" className={styles.panel}>
    {header}
    <form className={styles.form} onSubmit={event => { event.preventDefault(); void save(); }}>
      <label className={styles.field}>
        <span>Session RPE</span>
        <select value={form.rpe} onChange={event => setForm({ ...form, rpe: event.target.value })}>
          <option value="">Not rated</option>
          {RPE_OPTIONS.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
        <small>1 is very easy, 10 is maximal. Multiplied by minutes it gives the session load.</small>
      </label>
      {SECTIONS.map(section => <label className={styles.field} key={section.key}>
        <span>{section.label}</span>
        <textarea rows={3} maxLength={DEBRIEF_LIMITS.textMaxLength} value={form[section.key]} placeholder={section.prompt} onChange={event => setForm({ ...form, [section.key]: event.target.value })} />
      </label>)}
      <div className={styles.actions}>
        <button type="submit" className={styles.primary} disabled={saving}>{saving ? "Saving…" : "Save debrief"}</button>
        <button type="button" className={styles.secondary} disabled={saving} onClick={() => { setEditing(false); setError(""); setConflict(false); }}>Cancel</button>
      </div>
      <div role="status" aria-live="polite">
        {error && <p className={styles.error}>{error}{conflict && <> <button type="button" className={styles.link} onClick={() => { setEditing(false); void load(); }}>Reload the latest version</button></>}</p>}
      </div>
    </form>
  </section>;

  if (!debrief) return <section id="debrief" className={styles.panel}>
    {header}
    <p className={styles.muted}>No debrief yet. Talk the run through with Claude and it will appear here, or add one yourself.</p>
    {error && <p className={styles.error} role="status">{error}</p>}
  </section>;

  const filled = SECTIONS.filter(section => debrief[section.key]);
  return <section id="debrief" className={styles.panel}>
    {header}
    <div className={styles.summary}>
      <div className={styles.stat}><small>RPE</small><strong>{debrief.rpe ?? "–"}<span>/10</span></strong></div>
      {debrief.derived.sessionRpeLoad !== undefined && <div className={styles.stat}><small>Session load</small><strong>{debrief.derived.sessionRpeLoad}<span> AU</span></strong></div>}
      <p className={styles.meta}>Recorded {when(debrief.recordedAt)} · {SOURCE_LABEL[debrief.source]}{debrief.version > 1 ? ` · version ${debrief.version}` : ""}</p>
    </div>
    {filled.length === 0 ? <p className={styles.muted}>Only an RPE was recorded for this run.</p>
      : <dl className={styles.sections}>{filled.map(section => <div key={section.key}><dt>{section.label}</dt><dd>{debrief[section.key]}</dd></div>)}</dl>}
    {error && <p className={styles.error} role="status">{error}</p>}
  </section>;
}
