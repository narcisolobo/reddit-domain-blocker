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

const IMPORT_TEXT = {
  unreadable: "That file isn't a Reddit Domain Blocker export. Nothing was imported.",
  "unsupported-version": "That export is from a different version of Reddit Domain Blocker. Nothing was imported.",
  "import-quota": "Chrome refused to save the import. Nothing was imported. Try again in a minute.",
  "file-too-big": "That file is too large to be an export. Nothing was imported.",
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
      case "exported":
        return { kind: "status", text: `Exported ${result.count} ${result.count === 1 ? "domain" : "domains"}` };
      case "imported":
        return { kind: "status", text: `Imported: ${result.added} new, ${result.merged} merged, ${result.skipped} skipped.` };
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
    if (result.reason === "nothing-to-import") {
      return {
        kind: "error",
        text: result.skipped === 0
          ? "That file has no domains in it. Nothing was imported."
          : "Nothing to import: every entry in that file was skipped.",
      };
    }
    if (Object.hasOwn(IMPORT_TEXT, result.reason)) return { kind: "error", text: IMPORT_TEXT[result.reason] };
    if (result.reason === "too-many") {
      return { kind: "error", text: `That import would go over Chrome's limit of 512 domains by ${result.over}. Nothing was imported.` };
    }
    if (result.reason === "too-large") {
      const kb = Math.ceil(result.over / 1024);
      return { kind: "error", text: `That import would go over Chrome's sync storage limit by about ${kb} KB. Nothing was imported.` };
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
  node.setAttribute("role", "columnheader");
  if (hidden) node.append(el(doc, "span", "visually-hidden", text));
  else node.textContent = text;
  return node;
}

// Shown only in the stacked layout; the column header already names the cell
// for a screen reader, so the label is hidden from it.
function cellLabel(doc, text) {
  const label = el(doc, "span", "cell-label", text);
  label.setAttribute("aria-hidden", "true");
  return label;
}

function dataCell(doc, className, label, ...content) {
  const td = el(doc, "td", className);
  td.setAttribute("role", "cell");
  td.append(cellLabel(doc, label), ...content);
  return td;
}

function countCell(doc, domain, stats) {
  const td = dataCell(doc, "count", "Posts hidden", el(doc, "span", "count-value", String(stats.get(domain)?.blockedCount ?? 0)));
  td.dataset.countFor = domain;
  return td;
}

function actionsCell(doc) {
  const td = el(doc, "td", "actions");
  td.setAttribute("role", "cell");
  return td;
}

function row(doc, ...cells) {
  const tr = doc.createElement("tr");
  tr.setAttribute("role", "row");
  tr.append(...cells);
  return tr;
}

function rowButton(doc, { action, domain, className, iconName, label, name, onClick }) {
  const btn = doc.createElement("button");
  btn.type = "button";
  btn.className = className;
  btn.dataset.domain = domain;
  btn.dataset.action = action;
  btn.setAttribute("aria-label", name);
  btn.title = name;
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
      name: `Confirm delete of ${domain}`,
      onClick: handlers.onConfirm,
    }),
    rowButton(doc, {
      action: "cancel",
      domain,
      className: "btn btn-small btn-restore",
      iconName: "x",
      label: "Cancel",
      name: `Cancel delete of ${domain}`,
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

// The section heading names the table, so there is no caption to repeat it.
// Explicit roles keep the table semantics when the narrow layout changes display.
function buildTable(doc, labelledBy, headers) {
  const table = el(doc, "table", "domains");
  table.setAttribute("role", "table");
  table.setAttribute("aria-labelledby", labelledBy);
  const thead = doc.createElement("thead");
  thead.setAttribute("role", "rowgroup");
  thead.append(row(doc, ...headers));
  const tbody = doc.createElement("tbody");
  tbody.setAttribute("role", "rowgroup");
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

  const { table, tbody } = buildTable(doc, "active-heading", [
    th(doc, "Domain"),
    th(doc, "Posts hidden"),
    th(doc, "Actions", { hidden: true }),
  ]);
  for (const rec of active) {
    const tdAction = actionsCell(doc);
    tdAction.append(
      rowButton(doc, {
        action: "remove",
        domain: rec.domain,
        className: "btn btn-remove",
        iconName: "trash",
        label: "Remove",
        name: `Remove ${rec.domain}`,
        onClick: handlers.onRemove,
      }),
    );
    tbody.append(row(doc, dataCell(doc, "domain", "Domain", rec.domain), countCell(doc, rec.domain, stats), tdAction));
  }
  root.append(table);
}

function formatDate(doc, ms) {
  if (!Number.isFinite(ms)) return dataCell(doc, "archived-at", "Archived");
  const date = new Date(ms);
  const time = doc.createElement("time");
  time.dateTime = date.toISOString();
  time.textContent = date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  return dataCell(doc, "archived-at", "Archived", time);
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

  const { table, tbody } = buildTable(doc, "archived-heading", [
    th(doc, "Domain"),
    th(doc, "Archived"),
    th(doc, "Posts hidden"),
    th(doc, "Actions", { hidden: true }),
  ]);
  for (const rec of archived) {
    const tdAction = actionsCell(doc);
    tdAction.append(
      rowButton(doc, {
        action: "restore",
        domain: rec.domain,
        className: "btn btn-restore",
        iconName: "arrow-back-up",
        label: "Restore",
        name: `Restore ${rec.domain}`,
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
            name: `Delete permanently: ${rec.domain}`,
            onClick: handlers.onDelete,
          }),
    );
    tbody.append(row(doc, dataCell(doc, "domain", "Domain", rec.domain), formatDate(doc, rec.archivedAt), countCell(doc, rec.domain, stats), tdAction));
  }
  root.append(table);
}

export function updateCounts(doc, stats) {
  for (const cell of doc.querySelectorAll("[data-count-for]")) {
    cell.querySelector(".count-value").textContent = String(stats.get(cell.dataset.countFor)?.blockedCount ?? 0);
  }
}
