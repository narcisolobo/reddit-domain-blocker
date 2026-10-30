import { icon } from "../shared/icons.js";

export const MAX_IMPORT_BYTES = 1048576;
const MAX_SKIPS_SHOWN = 10;

const SKIP_TEXT = {
  "invalid-domain": "isn't a valid domain",
  protected: "is a Reddit domain",
  "invalid-record": "has missing or invalid fields",
  duplicate: "appears more than once",
};

const MAX_DOMAIN_SHOWN = 80;

export function skipText(skip) {
  const domain = skip.domain?.length > MAX_DOMAIN_SHOWN ? `${skip.domain.slice(0, MAX_DOMAIN_SHOWN)}…` : skip.domain;
  return `${domain ?? `Entry ${skip.index + 1}`} ${SKIP_TEXT[skip.reason]}`;
}

function el(doc, tag, text) {
  const node = doc.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(doc, { iconName, label, name, onClick }) {
  const btn = doc.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-restore";
  btn.setAttribute("aria-label", name);
  btn.title = name;
  btn.innerHTML = `${icon(iconName)}<span>${label}</span>`;
  btn.addEventListener("click", onClick);
  return btn;
}

function countChoice(doc) {
  const fieldset = el(doc, "fieldset");
  fieldset.append(el(doc, "legend", "Counts for domains already on your list"));
  for (const [value, text] of [["larger", "Use the larger count"], ["sum", "Add the two counts together"]]) {
    const label = doc.createElement("label");
    const radio = doc.createElement("input");
    radio.type = "radio";
    radio.name = "count-mode";
    radio.value = value;
    radio.checked = value === "larger";
    label.append(radio, ` ${text}`);
    fieldset.append(label);
  }
  return fieldset;
}

export function renderImportReview(root, { added, merged, skipped }, { onImport, onCancel }) {
  const doc = root.ownerDocument;
  const section = el(doc, "section");
  section.setAttribute("aria-labelledby", "import-heading");
  section.setAttribute("aria-describedby", "import-summary");
  const heading = el(doc, "h2", "Review import");
  heading.id = "import-heading";
  heading.tabIndex = -1;
  const summary = el(doc, "p", `${added} new, ${merged} merged, ${skipped.length} skipped`);
  summary.id = "import-summary";
  section.append(heading, summary);

  if (skipped.length > 0) {
    const list = el(doc, "ul");
    for (const skip of skipped.slice(0, MAX_SKIPS_SHOWN)) list.append(el(doc, "li", skipText(skip)));
    if (skipped.length > MAX_SKIPS_SHOWN) list.append(el(doc, "li", `and ${skipped.length - MAX_SKIPS_SHOWN} more`));
    section.append(list);
  }
  if (merged > 0) section.append(countChoice(doc));

  const actions = el(doc, "div");
  actions.className = "review-actions";
  actions.append(
    button(doc, {
      iconName: "upload",
      label: "Import",
      name: "Import",
      onClick: () => onImport(section.querySelector("input[name=count-mode]:checked")?.value ?? "larger"),
    }),
    button(doc, { iconName: "x", label: "Cancel", name: "Cancel import", onClick: onCancel }),
  );
  section.append(actions);
  section.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  });

  root.textContent = "";
  root.append(section);
}

export function clearImportReview(root) {
  root.textContent = "";
}
