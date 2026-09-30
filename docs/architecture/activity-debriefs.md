# Post-run debriefs (PAU-80, PAU-81, PAU-82, PAU-83)

A debrief is Paul's own account of how one completed run felt, captured in a conversation with Claude and shown on the website beside the objective analysis. Numbers alone miss things: on 30 Sep 2026 a warm-up heart rate of 172 against a 149 cap only made sense once Paul explained heavy legs, a knee niggle and a shoelace stop.

## Data model

One debrief per activity, keyed by `activityId` and stored apart from the activity document.

| Field | Type | Notes |
|---|---|---|
| `activityId` | string | Must be an existing activity of the athlete. |
| `version` | integer | Starts at 1, +1 on every change. Used for optimistic concurrency. |
| `rpe` | number, optional | Session RPE, 1-10 in steps of 0.5. |
| `bodyFeel` | text, optional | Legs, breathing, niggles. |
| `mentalState` | text, optional | Motivation, confidence, mindset. |
| `context` | text, optional | Sleep, food, stress, kit, anything unusual. |
| `planNotes` | text, optional | What differed from the plan and why. |
| `learnings` | text, optional | What went well, what to change. |
| `recordedAt` | ISO timestamp | When the debrief happened; defaults to the time of the first save. May be hours after the run. |
| `source` | `voice-chat` \| `text-chat` \| `web-edit` | How it was captured. |
| `createdAt`, `updatedAt` | ISO timestamp | |

Text fields are trimmed and limited to 4000 characters. A debrief must contain an RPE or at least one text field.

Derived on read, not stored: `derived.sessionRpeLoad` = `rpe` x activity duration in minutes (Foster session-RPE, rounded), and `derived.durationSeconds`.

Example:

```json
{
  "activityId": "fd36696f-7c79-44a1-96da-5d17a9f9e8cf",
  "version": 1,
  "rpe": 7,
  "bodyFeel": "Heavy legs. Right knee niggle at the start that disappeared after the run.",
  "mentalState": "Felt unfit and was relieved when the clock stopped.",
  "context": "Stopped to tie my shoelaces.",
  "recordedAt": "2026-09-30T20:30:00.000Z",
  "source": "voice-chat",
  "derived": { "durationSeconds": 1691, "sessionRpeLoad": 197 }
}
```

## Decisions

- **One debrief per activity, editable, with history.** Every change appends an immutable revision (`activity_debrief_revision`) recording who saved it, readable with `GET .../debrief?history=1`.
- **Back-to-back runs** are separate activities and get separate debriefs.
- **Structured fields, all optional.** Enough structure to compare and aggregate (RPE, load), free text where the detail is.
- **Create-or-update semantics.** Omitted fields keep their value; blank text or `null` RPE clears one. Saving identical content is a no-op (no new version), so a repeated call from Claude is safe. This is why debrief writes do not use the `Idempotency-Key` mechanism.
- **Conflicts.** `expectedVersion` is optional; when given and stale the save fails with `409 VERSION_CONFLICT` and the current version, so Claude never silently overwrites a website edit. Saves for one activity are serialized with the same advisory-lock mechanism as other entities.
- **Planned-vs-felt effort** is not included yet; it depends on PAU-78 (linking imported activities to their calendar item).

## Storage (PAU-82)

Stored in the existing `training_api_documents` table as kind `activity_debrief` (id = activity id, `sort_key` = `recordedAt`) and `activity_debrief_revision` (id = `activityId@version`). No change to existing tables or data; migration `0006_activity_debriefs.sql` only adds a partial index and is also applied lazily by the store.

Because debriefs are separate documents, re-importing or repairing an activity (which rewrites the `activity` document under the same id) never changes or loses its debrief. Deleting an activity is not an operation the app performs; if an activity were ever removed its debrief would remain, and `GET /debriefs` still lists it without activity-derived fields.

## Privacy

Debriefs can contain health-related detail. They are served only by authenticated routes (bearer token, or the website's browser session with same-origin checks on writes), are never part of a public or shareable page, are returned with `Cache-Control: private, no-store`, and their free text is never put in audit events or error messages. Audit events record only `debrief.saved`, the activity id, the version and the actor.

## Surfaces

- Website: Debrief section on `/activity-analysis/{activityId}` (view, add, edit); the training calendar marks completed runs that have a debrief (PAU-86, PAU-87).
- Training MCP: `save_activity_debrief`, `get_activity_debrief`, `list_activity_debriefs`, `get_debrief_guide` (PAU-84, PAU-85, PAU-88).
- Activity MCP (read-only): `get_activity_debrief`, `list_activity_debriefs`.
- HTTP API: see `docs/training-api.md`.
