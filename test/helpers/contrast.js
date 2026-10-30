function expand(hex) {
  const h = hex.toLowerCase();
  return h.length === 4 ? "#" + [...h.slice(1)].map((c) => c + c).join("") : h;
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(expand(hex).slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Reads `--name: #rgb|#rrggbb` declarations from the first block whose
// selector text is exactly `selector`, at any nesting depth.
export function cssTokens(css, selector) {
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    if (m[1].trim().split("\n").pop().trim() !== selector) continue;
    const tokens = {};
    for (const d of m[2].matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6})\s*;/g)) {
      tokens[d[1]] = expand(d[2]);
    }
    return tokens;
  }
  return {};
}
