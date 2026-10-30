import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const TILE = "#24303a";
const LINK = "#ffffff";
const SLASH = "#ff5c5c";
const STROKE = 2.7;

// Tabler's link-off: every path but the slash is the link; the slash is drawn
// separately in red, over a wider tile-colored stroke so it stays clear of the
// link at 16px.
const svg = readFileSync(join(root, "node_modules/@tabler/icons/icons/outline/link-off.svg"), "utf8");
const paths = [...svg.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);
const SLASH_D = "M3 3l18 18";
if (!paths.includes(SLASH_D)) throw new Error("link-off.svg no longer has the expected slash path");
const link = paths.filter((d) => d !== SLASH_D).map((d) => `<path d="${d}"/>`).join("");

const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
<rect width="24" height="24" rx="4.5" fill="${TILE}"/>
<g transform="translate(2 2) scale(.8333)" fill="none" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round">
<g stroke="${LINK}">${link}</g>
<path d="${SLASH_D}" stroke="${TILE}" stroke-width="${STROKE + 2.2}"/>
<path d="${SLASH_D}" stroke="${SLASH}"/>
</g>
</svg>`;

mkdirSync(join(root, "extension/icons"), { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const png = new Resvg(source, { fitTo: { mode: "width", value: size } }).render().asPng();
  writeFileSync(join(root, `extension/icons/icon-${size}.png`), png);
  console.log(`wrote extension/icons/icon-${size}.png`);
}
