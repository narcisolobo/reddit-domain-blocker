import { icon } from "../shared/icons.js";

const ERROR_TEXT = {
  invalid: "That doesn't look like a web address. Try something like example.com.",
  protected: "Reddit's own domains can't be blocked.",
  ip: "IP addresses can't be blocked. Use a domain name.",
  "single-label": "That needs a full domain, like example.com.",
  empty: "Type or paste a domain or web address.",
  quota: "The list is full. Remove some domains and try again.",
  error: "Something went wrong. Please try again.",
};

const GENERIC = { kind: "error", text: ERROR_TEXT.error };

export function messageFor(result) {
  if (result === null || typeof result !== "object") return GENERIC;
  const domain = typeof result.domain === "string" ? result.domain : "";
  if (result.ok === true) {
    switch (result.outcome) {
      case "added":
        return { kind: "status", text: `Added ${domain}` };
      case "restored":
        return { kind: "status", text: `Restored ${domain}` };
      case "exists":
        return { kind: "status", text: `${domain} is already on the list` };
      case "archived":
      case "already-archived":
        return { kind: "status", text: `Removed ${domain}` };
      default:
        return GENERIC;
    }
  }
  if (result.ok === false) {
    if (result.reason === "not-found") {
      return { kind: "error", text: `${domain || "That domain"} isn't on the list.` };
    }
    if (typeof result.reason === "string" && Object.hasOwn(ERROR_TEXT, result.reason)) {
      return { kind: "error", text: ERROR_TEXT[result.reason] };
    }
  }
  return GENERIC;
}

export const EMPTY_TEXT =
  "No blocked domains yet. Paste one above, or right-click a link on Reddit once that menu is added.";

export function renderList(root, records, handlers) {
  const doc = root.ownerDocument;
  const active = records
    .filter((r) => r.status === "active")
    .sort((a, b) => a.domain.localeCompare(b.domain));

  root.textContent = "";
  if (active.length === 0) {
    const p = doc.createElement("p");
    p.className = "empty";
    p.textContent = EMPTY_TEXT;
    root.append(p);
    return;
  }

  const table = doc.createElement("table");
  table.className = "domains";
  const caption = doc.createElement("caption");
  caption.textContent = "Blocked domains";
  const thead = doc.createElement("thead");
  const headRow = doc.createElement("tr");
  const thDomain = doc.createElement("th");
  thDomain.scope = "col";
  thDomain.textContent = "Domain";
  const thActions = doc.createElement("th");
  thActions.scope = "col";
  const hidden = doc.createElement("span");
  hidden.className = "visually-hidden";
  hidden.textContent = "Actions";
  thActions.append(hidden);
  headRow.append(thDomain, thActions);
  thead.append(headRow);

  const tbody = doc.createElement("tbody");
  for (const rec of active) {
    const tr = doc.createElement("tr");
    const tdDomain = doc.createElement("td");
    tdDomain.className = "domain";
    tdDomain.textContent = rec.domain;
    const tdAction = doc.createElement("td");
    tdAction.className = "actions";
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-remove";
    btn.dataset.domain = rec.domain;
    btn.setAttribute("aria-label", `Remove ${rec.domain}`);
    btn.title = `Archive ${rec.domain}`;
    btn.innerHTML = `${icon("trash")}<span>Remove</span>`;
    btn.addEventListener("click", () => handlers.onRemove(rec.domain));
    tdAction.append(btn);
    tr.append(tdDomain, tdAction);
    tbody.append(tr);
  }
  table.append(caption, thead, tbody);
  root.append(table);
}
