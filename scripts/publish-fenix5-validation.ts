import {
  prepareFenix5LiveValidation,
  publishFenix5LiveValidation,
  type Fenix5LiveValidationInput,
} from "../lib/integrations/fenix5-publisher";

interface CliArgs {
  template?: string;
  date?: string;
  time: string;
  timezone: string;
  publish: boolean;
  paceLow: number;
  paceHigh: number;
  lthr?: number;
  hrLow?: number;
  hrHigh?: number;
  version: number;
  help: boolean;
}

const ALLOWED_TEMPLATES = [
  "fenix5-time-auto",
  "fenix5-distance-auto",
  "fenix5-repeat-pace",
  "fenix5-hr-range",
  "fenix5-manual-lap",
] as const;

function numeric(value: string | undefined, flag: string): number {
  const result = Number(value);
  if (!value || !Number.isFinite(result)) throw new Error(`${flag} requires a finite number.`);
  return result;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    time: "09:00:00",
    timezone: "Europe/London",
    publish: false,
    paceLow: 300,
    paceHigh: 320,
    version: 1,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--template":
        args.template = argv[++i];
        break;
      case "--date":
        args.date = argv[++i];
        break;
      case "--time":
        args.time = argv[++i] ?? "";
        break;
      case "--timezone":
        args.timezone = argv[++i] ?? "";
        break;
      case "--pace-low":
        args.paceLow = numeric(argv[++i], "--pace-low");
        break;
      case "--pace-high":
        args.paceHigh = numeric(argv[++i], "--pace-high");
        break;
      case "--lthr":
        args.lthr = numeric(argv[++i], "--lthr");
        break;
      case "--hr-low":
        args.hrLow = numeric(argv[++i], "--hr-low");
        break;
      case "--hr-high":
        args.hrHigh = numeric(argv[++i], "--hr-high");
        break;
      case "--version":
        args.version = numeric(argv[++i], "--version");
        break;
      case "--publish":
        args.publish = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function usage(): string {
  return `Fenix 5 live validation publisher\n\nUsage:\n  npm run validate:fenix5 -- --template fenix5-time-auto --date YYYY-MM-DD [options]\n\nSafe default:\n  Without --publish this performs a local QA/translation dry-run only.\n\nTemplates:\n  ${ALLOWED_TEMPLATES.join("\n  ")}\n\nOptions:\n  --time HH:MM[:SS]      Local start time (default 09:00:00)\n  --timezone IANA        Timezone (default Europe/London)\n  --pace-low SECONDS     Faster/lower pace bound in sec/km (default 300)\n  --pace-high SECONDS    Slower/upper pace bound in sec/km (default 320)\n  --lthr BPM             Required for fenix5-hr-range\n  --hr-low BPM           Required for fenix5-hr-range\n  --hr-high BPM          Required for fenix5-hr-range\n  --version N            Canonical source version (default 1)\n  --publish              Actually create/update ONE Intervals.icu event\n  --help                  Show this help\n\nPublishing credentials:\n  INTERVALS_ICU_API_KEY must be set in the environment.\n  INTERVALS_ICU_ATHLETE_ID is optional and defaults to 0 (own account).\n\nThe API key is never accepted as a command-line argument and is never printed.`;
}

function buildInput(args: CliArgs): Fenix5LiveValidationInput {
  if (!args.template || !ALLOWED_TEMPLATES.includes(args.template as (typeof ALLOWED_TEMPLATES)[number])) {
    throw new Error(`--template is required and must be one of: ${ALLOWED_TEMPLATES.join(", ")}.`);
  }
  if (!args.date) throw new Error("--date is required.");
  if (!Number.isInteger(args.version) || args.version < 1) {
    throw new Error("--version must be a positive integer.");
  }

  if (args.template === "fenix5-hr-range") {
    if (args.lthr === undefined || args.hrLow === undefined || args.hrHigh === undefined) {
      throw new Error("fenix5-hr-range requires --lthr, --hr-low and --hr-high.");
    }
  }

  return {
    templateId: args.template,
    localDate: args.date,
    localTime: args.time,
    timezone: args.timezone,
    sourceVersion: args.version,
    templateConfig: {
      // Non-HR templates do not use these fallback HR values. HR validation
      // requires explicit values above so an athlete-specific target is never guessed.
      lthrBpm: args.lthr ?? 170,
      hrLowBpm: args.hrLow ?? 140,
      hrHighBpm: args.hrHigh ?? 150,
      paceLowSecPerKm: args.paceLow,
      paceHighSecPerKm: args.paceHigh,
      manualLapPlaceholderSeconds: 60,
    },
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const input = buildInput(args);
  const dryRun = prepareFenix5LiveValidation(input);
  console.log("Validated Intervals.icu event payload:");
  console.log(JSON.stringify(dryRun.event, null, 2));
  if (dryRun.warnings.length) {
    console.log("Warnings:");
    for (const warning of dryRun.warnings) console.log(`- ${warning}`);
  }

  if (!args.publish) {
    console.log("DRY RUN ONLY — no external request was made. Add --publish to send this one event.");
    return;
  }

  const apiKey = process.env.INTERVALS_ICU_API_KEY;
  if (!apiKey) {
    throw new Error("INTERVALS_ICU_API_KEY is required for --publish. Do not paste the key into chat or pass it on the command line.");
  }

  const published = await publishFenix5LiveValidation(input, {
    auth: { type: "api_key", apiKey },
    athleteId: process.env.INTERVALS_ICU_ATHLETE_ID ?? "0",
  });

  if (!published.attempted) {
    throw new Error(
      `Workout was not published: ${published.delivery?.reason ?? "not eligible for the rolling window"}.`,
    );
  }
  if (!published.result?.ok) {
    throw new Error(
      `Intervals.icu publish failed: ${published.result?.code ?? "UNKNOWN"} ${published.result?.message ?? ""}`.trim(),
    );
  }

  console.log(`Published successfully. Intervals.icu event ID: ${published.result.externalId}`);
  console.log(`Delivery state: ${published.delivery?.deliveryState ?? "unknown"}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
