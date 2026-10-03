import { readFile } from "node:fs/promises";
import path from "node:path";

const weeklyFiles = [
  "2026-10-05 - Week 1.md",
  "2026-10-12 - Week 2.md",
  "2026-10-19 - Week 3.md",
  "2026-10-26 - Week 4.md",
  "2026-11-02 - Week 5.md",
] as const;

export async function readTrainingProgramme() {
  const root = path.join(process.cwd(), "coaches area");
  const [master, ...weeks] = await Promise.all([
    readFile(path.join(root, "Half Marathon Plan 1-30.md"), "utf8"),
    ...weeklyFiles.map((file) => readFile(path.join(root, "weekly plans", file), "utf8")),
  ]);
  return { master, weeks };
}
