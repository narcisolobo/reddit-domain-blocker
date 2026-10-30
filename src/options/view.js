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
      case "deleted":
        return { kind: "status", text: `Deleted ${domain} permanently` };
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
    if (result.reason === "not-archived") {
      return { kind: "error", text: `${domain || "That domain"} is blocked again, so it wasn't deleted.` };
    }
    if (typeof result.reason === "string" && Object.hasOwn(ERROR_TEXT, result.reason)) {
      return { kind: "error", text: ERROR_TEXT[result.reason] };
    }
  }
  return GENERIC;
}

export const EMPTY_TEXT =
  "No blocked domains yet. Paste one above, or right-click an outgoing link on Reddit and choose Block this domain.";

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function th(doc, text, { hidden = false } = {}) {
  const node = doc.createElement("th");
  node.scope = "col";
  if (hidden) node.append(el(doc, "span", "visually-hidden", text));
  else node.textContent = text;
  return node;
}

function countCell(doc, domain, stats) {
  const td = el(doc, "td", "count", String(stats.get(domain)?.blockedCount ?? 0));
  td.dataset.countFor = domain;
  return td;
}

function rowButton(doc, { action, domain, className, iconName, label, ariaLabel, title, onClick }) {
  const btn = doc.createElement("button");
  btn.type = "button";
  btn.className = className;
  btn.dataset.domain = domain;
  btn.dataset.action = action;
  btn.setAttribute("aria-label", ariaLabel);
  btn.title = title;
  btn.innerHTML = `${icon(iconName)}<span>${label}</span>`;
  btn.addEventListener("click", () => onClick(domain));
  return btn;
}

function confirmGroup(doc, domain, handlers) {
  const group = el(doc, "span", "confirm-group");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", `Confirm deleting ${domain}`);
  group.append(
    el(doc, "span", "confirm-text", "Really delete?"),
    rowButton(doc, {
      action: "confirm",
      domain,
      className: "btn btn-small btn-remove",
      iconName: "trash",
      label: "Confirm",
      ariaLabel: `Confirm delete of ${domain}`,
      title: `Delete ${domain} permanently`,
      onClick: handlers.onConfirm,
    }),
    rowButton(doc, {
      action: "cancel",
      domain,
      className: "btn btn-small btn-restore",
      iconName: "x",
      label: "Cancel",
      ariaLabel: `Cancel delete of ${domain}`,
      title: `Keep ${domain}`,
      onClick: handlers.onCancel,
    }),
  );
  group.addEventListener("keydown", (event) => {
    // Holding Enter on Delete must not auto-repeat into Confirm or Cancel.
    if ((event.key === "Enter" || event.key === " ") && event.repeat) {
      event.preventDefault();
    } else if (event.key === "Escape") {
      event.preventDefault();
      handlers.onCancel(domain);
    }
  });
  return group;
}

function buildTable(doc, captionText, headers) {
  const table = el(doc, "table", "domains");
  table.append(el(doc, "caption", "", captionText));
  const thead = doc.createElement("thead");
  const row = doc.createElement("tr");
  row.append(...headers);
  thead.append(row);
  const tbody = doc.createElement("tbody");
  table.append(thead, tbody);
  return { table, tbody };
}

const byDomain = (a, b) => a.domain.localeCompare(b.domain);

export function renderList(root, records, stats, handlers) {
  const doc = root.ownerDocument;
  const active = records.filter((r) => r.status === "active").sort(byDomain);

  root.textContent = "";
  if (active.length === 0) {
    root.append(el(doc, "p", "empty", EMPTY_TEXT));
    return;
  }

  const { table, tbody } = buildTable(doc, "Blocked domains", [
    th(doc, "Domain"),
    th(doc, "Posts hidden"),
    th(doc, "Actions", { hidden: true }),
  ]);
  for (const rec of active) {
    const tr = doc.createElement("tr");
    const tdAction = el(doc, "td", "actions");
    tdAction.append(
      rowButton(doc, {
        action: "remove",
        domain: rec.domain,
        className: "btn btn-remove",
        iconName: "trash",
        label: "Remove",
        ariaLabel: `Remove ${rec.domain}`,
        title: `Archive ${rec.domain}`,
        onClick: handlers.onRemove,
      }),
    );
    tr.append(el(doc, "td", "domain", rec.domain), countCell(doc, rec.domain, stats), tdAction);
    tbody.append(tr);
  }
  root.append(table);
}

function formatDate(doc, ms) {
  if (!Number.isFinite(ms)) return el(doc, "td", "archived-at");
  const date = new Date(ms);
  const time = doc.createElement("time");
  time.dateTime = date.toISOString();
  time.textContent = date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  const td = el(doc, "td", "archived-at");
  td.append(time);
  return td;
}

// `confirming` is the domain whose Delete is awaiting confirmation, or null.
export function renderArchived(root, records, stats, handlers, confirming = null) {
  const doc = root.ownerDocument;
  const archived = records.filter((r) => r.status === "archived").sort(byDomain);

  root.textContent = "";
  if (archived.length === 0) {
    root.append(el(doc, "p", "empty", "No archived domains."));
    return;
  }

  const { table, tbody } = buildTable(doc, "Archived domains", [
    th(doc, "Domain"),
    th(doc, "Archived"),
    th(doc, "Posts hidden"),
    th(doc, "Actions", { hidden: true }),
  ]);
  for (const rec of archived) {
    const tr = doc.createElement("tr");
    const tdAction = el(doc, "td", "actions");
    tdAction.append(
      rowButton(doc, {
        action: "restore",
        domain: rec.domain,
        className: "btn btn-restore",
        iconName: "arrow-back-up",
        label: "Restore",
        ariaLabel: `Restore ${rec.domain}`,
        title: `Block ${rec.domain} again`,
        onClick: handlers.onRestore,
      }),
      rec.domain === confirming
        ? confirmGroup(doc, rec.domain, handlers)
        : rowButton(doc, {
            action: "delete",
            domain: rec.domain,
            className: "btn btn-remove",
            iconName: "trash",
            label: "Delete permanently",
            ariaLabel: `Delete permanently: ${rec.domain}`,
            title: `Delete ${rec.domain} and its history`,
            onClick: handlers.onDelete,
          }),
    );
    tr.append(el(doc, "td", "domain", rec.domain), formatDate(doc, rec.archivedAt), countCell(doc, rec.domain, stats), tdAction);
    tbody.append(tr);
  }
  root.append(table);
}

export function updateCounts(doc, stats) {
  for (const cell of doc.querySelectorAll("[data-count-for]")) {
    cell.textContent = String(stats.get(cell.dataset.countFor)?.blockedCount ?? 0);
  }
}
