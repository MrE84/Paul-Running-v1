# FIT Activity Explorer integration

PAU-8 integrates the supplied FIT Activity Explorer into Paul's Running as `/activity-analysis`.

## Source baseline

The supplied explorer used `fit-file-parser` 3.0.2 and decoded FIT content entirely in the browser. Its core workflow was preserved:

- load one or more `.fit` files;
- activity/session summary metrics;
- chartable record streams including HR, pace, speed, cadence, altitude, power, temperature, distance, grade, vertical oscillation, ground contact time and respiration rate when present;
- GPS route rendering from FIT semicircle coordinates;
- lap summary and raw lap messages;
- searchable/paged record messages;
- all decoded FIT sections in table and JSON form;
- decoded JSON export plus record/lap CSV export;
- metric/imperial display units.

## Privacy model

Files selected in the Activity Analysis UI are read with the browser `File` API and passed directly to `fit-file-parser`. The UI does not upload those bytes to Paul's Running or Vercel. This preserves the original explorer's local/private decode model while allowing the analysis UI itself to be cloud hosted.

## Reusable analysis boundary

`lib/activity-analysis/core.ts` contains the provider-neutral analysis functions. It accepts decoded FIT objects and produces the same summary, records, laps, decoded groups, chart series and route data regardless of where the FIT bytes originated.

`lib/activity-analysis/browser.ts` exposes two ingress paths:

1. `loadBrowserFitFile(file)` for a user-selected local file;
2. `loadRemoteFit(input)` for a completed activity file made available by a backend/provider endpoint.

Both paths call `decodeFitBytes` and then `analyseDecodedFit`, so backend activity ingestion can feed the same analysis implementation without creating a second parser or metric model.

## Validation

The mandatory build gate includes `lib/activity-analysis/core.test.ts`, covering summary parity, running cadence semantics, raw decoded groups, route conversion, chart series, local/backend source parity and CSV export. The Vercel preview must compile the browser parser and serve `/activity-analysis` successfully before merge.
