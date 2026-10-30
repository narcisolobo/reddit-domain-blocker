export const LIGHT = {
  bg: "#f6f7f8",
  fg: "#1c1c1c",
  border: "#6b7280",
  btnBg: "#ffffff",
  btnHover: "#e9ebed",
  focus: "#005fcc",
  error: "#b3261e",
};

export const DARK = {
  bg: "#1a1a1b",
  fg: "#e8eaed",
  border: "#8b949e",
  btnBg: "#272729",
  btnHover: "#343437",
  focus: "#4d90fe",
  error: "#ff8a80",
};

function block(selector, p) {
  return `${selector} {
  --rdb-bg: ${p.bg};
  --rdb-fg: ${p.fg};
  --rdb-border: ${p.border};
  --rdb-btn-bg: ${p.btnBg};
  --rdb-btn-hover: ${p.btnHover};
  --rdb-focus: ${p.focus};
  --rdb-error: ${p.error};
}`;
}

export function paletteCss(selector) {
  return `${block(selector, LIGHT)}\n${block(`${selector}[data-theme="dark"]`, DARK)}`;
}
