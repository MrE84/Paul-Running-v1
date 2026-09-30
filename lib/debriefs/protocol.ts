import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * PAU-88: the debrief protocol and coaching guide served to Claude through the MCP.
 *
 * Claude cannot load files from the repository between chats, so the app hands it the
 * guide on request. The short protocol lives in code so it is always available; the longer
 * coaching knowledge base is a markdown file that can be edited without touching code.
 */

export const DEBRIEF_GUIDE_VERSION = "2026-09-30";

export const DEBRIEF_PROTOCOL = `# Paul's run debrief protocol

Follow this when Paul wants to talk through a run. The aim is to capture how the run felt,
alongside the data, in his own words.

1. Get the activity. Call sync_activities if a recent run is missing, then identify the
   activity id (list_activities on the activity connection). Back-to-back runs are separate
   activities and each gets its own debrief.
2. Read the numbers quietly first (get_activity_analysis, and get_activity_debrief in case
   one already exists). Do not lead with them.
3. Ask before you interpret. Open with feeling: "How did that feel, and why do you think it
   felt that way?" Ask one or two questions at a time and let Paul talk. He has asked to be
   asked more questions, not given a verdict up front.
4. Cover, across the conversation: effort (RPE 1-10 and what was planned), body (legs, breathing,
   niggles, early versus late), mind (confidence, motivation, any point he wanted to stop),
   context (sleep, food, stress, kit, time since last run) and what differed from the plan
   and why. Probe mismatches between what he felt and what the data shows; they are the
   useful signal.
5. Only then offer your read of the data, and tie it to what he told you. Be honest, including
   where the numbers do not support a comforting story. Do not diagnose injuries.
6. Summarise back in his own words, confirm the RPE, and ask whether anything should be
   corrected. Do not guess an RPE he has not given.
7. After he confirms, call save_activity_debrief once per activity. Use his wording, keep each
   field to what he actually said, and leave out fields he did not cover. If get_activity_debrief
   returned an existing version, pass it as expectedVersion so a website edit is not overwritten.
8. Tell him the debrief is saved and where to see it (the Debrief section on that activity page).

Privacy: debriefs can include health details. Save only what Paul said about his own run,
and never put them anywhere public.
`;

const GUIDE_FILE = path.join("lib", "debriefs", "guide", "coaching-knowledge-base.md");

export interface DebriefGuide {
  version: string;
  protocol: string;
  /** Coaching knowledge base markdown; null when the file could not be read. */
  knowledgeBase: string | null;
  note?: string;
}

export async function loadDebriefGuide(root = process.cwd()): Promise<DebriefGuide> {
  try {
    const knowledgeBase = await readFile(path.join(root, GUIDE_FILE), "utf8");
    return { version: DEBRIEF_GUIDE_VERSION, protocol: DEBRIEF_PROTOCOL, knowledgeBase };
  } catch {
    return {
      version: DEBRIEF_GUIDE_VERSION,
      protocol: DEBRIEF_PROTOCOL,
      knowledgeBase: null,
      note: "The coaching knowledge base file could not be read on this server; follow the protocol and ask open questions.",
    };
  }
}
