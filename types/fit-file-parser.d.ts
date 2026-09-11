declare module "fit-file-parser" {
  export interface FitParserOptions {
    force?: boolean;
    speedUnit?: string;
    lengthUnit?: string;
    temperatureUnit?: string;
    elapsedRecordField?: boolean;
    mode?: "list" | "cascade" | "both" | string;
  }

  export default class FitParser {
    constructor(options?: FitParserOptions);
    parseAsync(data: Uint8Array | ArrayBuffer): Promise<Record<string, any>>;
  }
}
