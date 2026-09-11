# Paul’s Running

Cloud-hosted personal running platform for training planning, structured workouts, Garmin delivery, activity analysis and AI-assisted coaching.

## Project goals

- Make Paul’s Running the system of record for plans, workouts, zones, activities and sync state.
- Reuse FIT Activity Explorer V6 as the activity-analysis foundation.
- Provide a training calendar and structured workout builder for intervals, threshold, easy, long-run and stride sessions.
- Validate workouts before sync with a dedicated QA engine.
- Use Intervals.icu initially as a replaceable bridge to Garmin Connect.
- Keep the architecture open to a future direct Garmin connector.
- Expose safe APIs so ChatGPT/AI clients can review training and make approved plan changes.

## Planned architecture

`ChatGPT / Web App -> Paul’s Running API + Database -> QA -> Intervals.icu -> Garmin Connect -> Garmin Watch`

Completed activities return in the opposite direction and are stored/analyzed by Paul’s Running.

## Project management

Development work is tracked in Linear under the **Paul’s Running** project.

## Status

Initial project setup and architecture phase.
