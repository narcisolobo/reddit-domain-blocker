import { build } from "esbuild";
import { copyFileSync, existsSync } from "node:fs";

const entries = [
  ["src/content/index.js", "extension/content.js"],
  ["src/background/index.js", "extension/background.js"],
  ["src/options/index.js", "extension/options.js"],
];

for (const [entry, outfile] of entries) {
  if (!existsSync(entry)) {
    console.warn(`skipped ${entry} (not created yet)`);
    continue;
  }
  await build({ entryPoints: [entry], outfile, bundle: true, format: "iife", target: "chrome120" });
  console.log(`built ${outfile}`);
}

copyFileSync("THIRD_PARTY_LICENSES", "extension/THIRD_PARTY_LICENSES");
console.log("copied extension/THIRD_PARTY_LICENSES");
