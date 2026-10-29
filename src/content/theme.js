function parseRgba(value) {
  const match = /^rgba?\(([^)]+)\)$/.exec((value || "").trim());
  if (!match) return null;
  const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return null;
  const alpha = parts.length > 3 ? parts[3] : 1;
  return { r: parts[0], g: parts[1], b: parts[2], a: alpha };
}

function luminance({ r, g, b }) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function backgroundTheme(document, view) {
  for (const el of [document.body, document.documentElement]) {
    if (!el) continue;
    const color = parseRgba(view.getComputedStyle(el).backgroundColor);
    if (color && color.a > 0) return luminance(color) < 0.5 ? "dark" : "light";
  }
  return null;
}

export function detectTheme(document) {
  const root = document.documentElement;
  if (root.classList.contains("theme-dark")) return "dark";
  if (root.classList.contains("theme-light")) return "light";
  const view = document.defaultView;
  const scheme = view.getComputedStyle(root).colorScheme;
  if (scheme === "dark") return "dark";
  if (scheme === "light") return "light";
  return backgroundTheme(document, view) || "light";
}

export function watchTheme(document, callback) {
  let last = detectTheme(document);
  const observer = new document.defaultView.MutationObserver(() => {
    const next = detectTheme(document);
    if (next === last) return;
    last = next;
    callback(next);
  });
  const options = { attributes: true, attributeFilter: ["class", "style"] };
  observer.observe(document.documentElement, options);
  if (document.body) observer.observe(document.body, options);
  return () => observer.disconnect();
}
