export const PROTECTED_DOMAINS = ["reddit.com", "redd.it", "redditmedia.com", "redditstatic.com"];

function stripTrailingDots(host) {
  return host.replace(/\.+$/, "");
}

function matchesDomain(host, domain) {
  return host === domain || host.endsWith("." + domain);
}

export function isProtected(domain) {
  const host = String(domain).toLowerCase();
  return PROTECTED_DOMAINS.some((p) => matchesDomain(host, p));
}

export function normalizeInput(input) {
  const text = String(input ?? "").trim();
  if (!text) return { ok: false, reason: "empty" };

  let candidate = text;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    // A scheme without "//" (mailto:, javascript:) is not a host; "host:port" is.
    if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(text)) return { ok: false, reason: "invalid" };
    candidate = "https://" + text;
  }

  let url;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "invalid" };

  let host = stripTrailingDots(url.hostname.toLowerCase());
  if (!host) return { ok: false, reason: "invalid" };
  if (host.startsWith("[") || /^\d+(\.\d+){3}$/.test(host)) return { ok: false, reason: "ip" };

  host = host.replace(/^www\./, "");
  if (!host.includes(".")) return { ok: false, reason: "single-label" };
  if (isProtected(host)) return { ok: false, reason: "protected" };
  return { ok: true, domain: host };
}

export function hostnameOf(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = stripTrailingDots(url.hostname.toLowerCase());
  return host || null;
}

export function findBlockingDomain(hostname, activeDomains) {
  const host = String(hostname).toLowerCase();
  let best = null;
  for (const domain of activeDomains) {
    if (matchesDomain(host, domain) && (best === null || domain.length > best.length)) best = domain;
  }
  return best;
}
