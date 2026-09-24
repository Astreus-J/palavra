import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// Discover all test files under src/ recursively
const findTestFiles = (dir: string): string[] => {
  const entries = readdirSync(dir, { recursive: true });
  return entries
    .filter((entry): entry is string => typeof entry === "string" && entry.endsWith(".test.ts"))
    .map((entry) => join(dir, entry));
};

const testFiles = findTestFiles("src");

if (testFiles.length === 0) {
  console.log("No test files found under src/");
  process.exit(0);
}

const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...testFiles], {
  stdio: "inherit",
});

process.exit(result.status ?? 1);
