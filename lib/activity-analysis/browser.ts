import FitParser from "fit-file-parser";
import { analyseDecodedFit } from "./core";
import type { AnalysedActivity, BrowserFitInput, RemoteFitInput } from "./contracts";

function validateFitHeader(bytes: Uint8Array): void {
  if (bytes.length < 12 || String.fromCharCode(...bytes.slice(8, 12)) !== ".FIT") {
    throw new Error("The file does not contain a valid FIT header.");
  }
}

export async function decodeFitBytes(bytes: Uint8Array): Promise<Record<string, any>> {
  validateFitHeader(bytes);
  const parser = new FitParser({
    force: true,
    speedUnit: "m/s",
    lengthUnit: "m",
    temperatureUnit: "celsius",
    elapsedRecordField: true,
    mode: "both",
  });
  return parser.parseAsync(bytes);
}

export async function analyseFitBytes(input: BrowserFitInput): Promise<AnalysedActivity> {
  const parsed = await decodeFitBytes(input.bytes);
  return analyseDecodedFit(input.source, parsed);
}

export async function loadBrowserFitFile(file: File): Promise<AnalysedActivity> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return analyseFitBytes({
    bytes,
    source: {
      id: `${file.name}:${file.size}:${file.lastModified}`,
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      origin: "browser",
    },
  });
}

export async function loadRemoteFit(input: RemoteFitInput): Promise<AnalysedActivity> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(input.url, { headers: input.headers });
  if (!response.ok) {
    throw new Error(`Unable to fetch FIT activity (${response.status}).`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return analyseFitBytes({
    bytes,
    source: {
      id: input.externalId ?? input.url,
      name: input.name,
      size: bytes.byteLength,
      origin: "backend",
      externalId: input.externalId,
      sourceFileUrl: input.url,
    },
  });
}
