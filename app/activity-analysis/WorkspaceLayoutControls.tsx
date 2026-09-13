"use client";

import { useEffect, useState } from "react";
import {
  BUILT_IN_LAYOUTS,
  LAYOUT_VERSION,
  builtInLayout,
  layoutStorageKey,
  moveLayoutCard,
  normalizeLayout,
  type AnalysisCardId,
  type AnalysisCardSize,
  type AnalysisLayout,
} from "../../lib/activity-analysis/layout";
import { CHANNELS, type Channel } from "../../lib/activity-analysis/projection";
import styles from "./analysis.module.css";

const CARD_LABELS: Record<AnalysisCardId, string> = {
  timeline: "Signal timeline",
  map: "Route map",
  elevation: "Elevation channel",
  intervals: "Intervals / laps",
  zones: "Zones / relationships",
  records: "Best efforts",
  derived: "Derived metrics",
  dynamics: "Running dynamics",
};

interface NamedLayout extends AnalysisLayout { savedAt: string }

export default function WorkspaceLayoutControls({ sport, availableChannels, layout, onChange }: { sport: string; availableChannels: Channel[]; layout: AnalysisLayout; onChange: (layout: AnalysisLayout) => void }) {
  const [named, setNamed] = useState<NamedLayout[]>([]);
  const [name, setName] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const storageKey = layoutStorageKey(sport);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      if (saved) onChange(normalizeLayout(saved, sport, availableChannels));
      const savedNames = JSON.parse(localStorage.getItem(`${storageKey}:named`) ?? "[]");
      if (Array.isArray(savedNames)) setNamed(savedNames.map(value => ({ ...normalizeLayout(value, sport, availableChannels), savedAt: typeof value?.savedAt === "string" ? value.savedAt : "" })).slice(-20));
    } catch { /* Invalid or old browser state falls back to the built-in layout. */ }
    setHydrated(true);
  // The activity sport and available channel inventory are stable for this workspace.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    if (hydrated) localStorage.setItem(storageKey, JSON.stringify(layout));
  }, [hydrated, layout, storageKey]);

  function update(patch: Partial<AnalysisLayout>) {
    onChange(normalizeLayout({ ...layout, ...patch }, sport, availableChannels));
  }

  function updateCard(id: AnalysisCardId, patch: { visible?: boolean; size?: AnalysisCardSize }) {
    update({ cards: layout.cards.map(card => card.id === id ? { ...card, ...patch } : card) });
  }

  function saveNamed() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const value: NamedLayout = { ...layout, id: `saved-${Date.now()}`, name: trimmed.slice(0, 80), savedAt: new Date().toISOString() };
    const next = [...named.filter(item => item.name !== value.name), value].slice(-20);
    setNamed(next); setName("");
    localStorage.setItem(`${storageKey}:named`, JSON.stringify(next));
    onChange(value);
  }

  return <details className={styles.layoutPanel}>
    <summary><span>Workspace layout</span><strong>{layout.name}</strong></summary>
    <div className={styles.layoutTop}>
      <label>Built-in preset<select value="" onChange={event => { if (event.target.value === "auto") onChange(normalizeLayout(builtInLayout("auto", sport), sport, availableChannels)); else { const preset = BUILT_IN_LAYOUTS.find(item => item.id === event.target.value); if (preset) onChange(normalizeLayout({ ...preset, sport }, sport, availableChannels)); } }}><option value="">Choose a preset…</option><option value="auto">Automatic for {sport.replaceAll("_", " ")}</option>{BUILT_IN_LAYOUTS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Saved layout<select value="" onChange={event => { const saved = named.find(item => item.id === event.target.value); if (saved) onChange(normalizeLayout(saved, sport, availableChannels)); }}><option value="">Open saved layout…</option>{named.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Name this layout<input value={name} maxLength={80} placeholder="My race review" onChange={event => setName(event.target.value)} /></label><button disabled={!name.trim()} onClick={saveNamed}>Save layout</button>
    </div>
    <div className={styles.layoutCards}>{layout.cards.map((card, index) => <div key={card.id}>
      <label className={styles.layoutVisible}><input type="checkbox" checked={card.visible} onChange={event => updateCard(card.id, { visible: event.target.checked })} /><span>{CARD_LABELS[card.id]}</span></label>
      <select aria-label={`${CARD_LABELS[card.id]} size`} value={card.size} onChange={event => updateCard(card.id, { size: event.target.value as AnalysisCardSize })}><option value="half">Half</option><option value="wide">Wide</option><option value="full">Full</option></select>
      <button aria-label={`Move ${CARD_LABELS[card.id]} earlier`} disabled={index === 0} onClick={() => onChange(moveLayoutCard(layout, card.id, -1))}>↑</button>
      <button aria-label={`Move ${CARD_LABELS[card.id]} later`} disabled={index === layout.cards.length - 1} onClick={() => onChange(moveLayoutCard(layout, card.id, 1))}>↓</button>
    </div>)}</div>
    <p>Version {LAYOUT_VERSION}. The current configuration is stored for {sport.replaceAll("_", " ")} activities on this browser.</p>
    <div className={styles.layoutChannels}><strong>Preset channels</strong>{layout.channels.map((channel, index) => <span key={channel} style={{ borderColor: `${CHANNELS[channel].color}66` }}>{CHANNELS[channel].label}<button aria-label={`Move ${CHANNELS[channel].label} earlier`} disabled={index === 0} onClick={() => { const channels = [...layout.channels]; [channels[index - 1], channels[index]] = [channels[index], channels[index - 1]]; update({ channels }); }}>←</button><button aria-label={`Hide ${CHANNELS[channel].label}`} disabled={layout.channels.length === 1} onClick={() => update({ channels: layout.channels.filter(item => item !== channel) })}>×</button></span>)}{layout.channels.length < 5 && <select aria-label="Add preset channel" value="" onChange={event => { if (event.target.value) update({ channels: [...layout.channels, event.target.value as Channel] }); }}><option value="">+ Add channel</option>{availableChannels.filter(channel => !layout.channels.includes(channel)).map(channel => <option key={channel} value={channel}>{CHANNELS[channel].label}</option>)}</select>}</div>
  </details>;
}
