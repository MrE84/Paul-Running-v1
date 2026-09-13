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
