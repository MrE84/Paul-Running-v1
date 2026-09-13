# Activity intelligence algorithms

The canonical FIT payload is immutable. Analysis is stored as a versioned projection and may be recomputed when `PROJECTION_VERSION`, the activity, the applicable zone revision, the linked calendar item, or the workout revision changes.

## Batch B v1.1.0

- **Intervals:** device laps are retained. Detected efforts are continuous samples at or above the activity's 72nd speed percentile, last at least 45 seconds, and tolerate gaps up to 20 seconds. Custom intervals store projection indices only. Planned workout steps are aligned sequentially by elapsed time or recorded distance; compliance is the percentage of measured seconds within the step target.
- **Zones and distributions:** the most recent zone set effective at the activity timestamp is selected. Time in zone is accumulated from sample-to-sample duration, excluding recording breaks and missing values. Histograms and relationship plots use the selected range when one exists.
- **Best efforts:** duration efforts maximize average recorded speed for rolling 5-second to 20-minute windows. Distance efforts minimize elapsed time over common running distances. Peak speed, heart-rate, power, and cadence signals use time-weighted rolling means with at least 80% measured coverage and no recording break.
- **Efficiency and decoupling:** speed/HR and power/HR are ratios of range means. Aerobic decoupling is `100 × (1 - second-half speed/HR ÷ first-half speed/HR)`. It is eligible only when both speed and heart rate exist; steady selections are the most useful interpretation.
- **Grade-adjusted pace:** graded speed is converted to equivalent level-running speed with the Minetti-style cost polynomial `155.4g⁵ - 30.4g⁴ - 43.3g³ + 46.3g² + 19.5g + 3.6`, where `g` is decimal grade clamped to ±45%. The metric requires speed and grade samples.
- **Internal load:** `100 × Σ(zone seconds × zone number²) ÷ (3600 × highest zone number²)`. This yields 100 for one hour entirely in the highest configured HR zone. It is unavailable without an activity-date HR zone revision.
- **Weather:** up to ten route/time waypoints are queried from the Open-Meteo historical archive in UTC. The nearest hourly observation is retained with provider, model, algorithm version, requested time, and observation time. Wind is decomposed against travel bearing; positive headwind means wind coming from the runner's direction of travel. Ambient temperature is never written into the FIT device-temperature channel.

Missing streams, indoor activities, provider failures, short recordings, and recording breaks return unavailable or partial results rather than inferred zeroes. Best-against-history and all-time PB classification belongs to the longitudinal canonical-history work; this activity-level engine exposes addressable effort windows for that later query.

## Batch C v1.0.0

- **Multi-activity comparison:** accepts two to six unique canonical projections. Traces align by elapsed time, recorded distance, or a matched planned/recorded/detected interval. Manual offsets are applied to display coordinates only. Relative mode subtracts an interpolated value from the first selected activity; no source samples are changed. Peak-preserving buckets retain source indices when a trace exceeds the display budget.
- **Longitudinal aggregation:** weekly and monthly totals use canonical activity timestamps, distance, duration, elevation and configured HR-zone time. The load fallback is explicitly 50 points per moving hour only when configured-zone load is unavailable.
- **Fitness, fatigue and form:** daily training impulse is projected with exponential response curves. Defaults are 42 days for fitness and 7 days for fatigue, both configurable in the URL and dashboard. Form is fitness minus fatigue. These are transparent workload models, not medical measures.
- **Fitness answer:** pace-to-HR efficiency compares the earlier and later halves of activities with overlapping speed and heart-rate data. A change above +2% is improving, below −2% is declining, and the band between is stable. Fewer than four eligible activities returns insufficient data.
- **Efficiency and PB history:** easy pace is time-weighted inside the configured easy HR zone. Threshold trend uses a named tempo/threshold/work interval or the longest 5–60 minute interval. Distance PBs are classified chronologically from rolling efforts. Equipment mileage appears only when canonical source metadata names equipment.
- **Saved layouts:** built-in and named layouts are versioned, validated against available channels, and stored by sport in browser storage. Arbitrary properties and unknown card/channel identifiers are discarded.
- **Data quality:** hard physiological ranges, rate-of-change spikes, robust local outliers and impossible running GPS jumps are flagged. Optional interpolation is a cloned display layer with provenance. Raw FIT payloads, persisted projections and canonical statistics remain unchanged.
- **Privacy-safe export:** the map and GPX export share one endpoint/custom-region predicate. Masked gaps become separate GPX track segments so an export cannot draw a straight line across a hidden home region.
- **Performance and resilience:** chart reduction is linear and peak preserving; long activities receive a smaller recommended display budget. Heavy map/timeline clients stay dynamically loaded. Each major panel has an error boundary so one malformed stream does not disable the rest of the analysis.

The current in-browser cost is bounded for normal FIT files. A Web Worker remains the next scaling step if production telemetry shows that projection, anomaly detection, or comparison blocks the main thread on files materially larger than the fixture and long-run test set.
