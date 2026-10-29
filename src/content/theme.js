function parseAlpha(token) {
  if (token === undefined) return 1;
  const value = token.endsWith("%") ? Number(token.slice(0, -1)) / 100 : Number(token);
  return Number.isNaN(value) ? null : value;
}

function parseRgba(value) {
  const match = /^rgba?\(([^)]+)\)$/i.exec((value || "").trim());
  if (!match) return null;
  const parts = match[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const [r, g, b] = parts.slice(0, 3).map(Number);
  const a = parseAlpha(parts[3]);
  if ([r, g, b, a].some((n) => n === null || Number.isNaN(n))) return null;
  return { r, g, b, a };
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
  const view = document.defaultView;
  if (!root || !view) return "light";
  if (root.classList.contains("theme-dark")) return "dark";
  if (root.classList.contains("theme-light")) return "light";
  const scheme = view.getComputedStyle(root).colorScheme;
  if (scheme === "dark") return "dark";
  if (scheme === "light") return "light";
  return backgroundTheme(document, view) || "light";
}

export function watchTheme(document, callback) {
  let last = detectTheme(document);
  let observedBody = null;
  const attrOptions = { attributes: true, attributeFilter: ["class", "style"] };
  const observer = new document.defaultView.MutationObserver(() => {
    if (document.body && document.body !== observedBody) {
      observedBody = document.body;
      observer.observe(observedBody, attrOptions);
    }
    const next = detectTheme(document);
    if (next === last) return;
    last = next;
    callback(next);
  });
  observer.observe(document.documentElement, { ...attrOptions, childList: !document.body });
  if (document.body) {
    observedBody = document.body;
    observer.observe(observedBody, attrOptions);
  }
  return () => observer.disconnect();
}
