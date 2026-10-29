import { hostnameOf, isProtected } from "../shared/domain.js";

const POST_PATH = /\/comments\/[a-z0-9]+(\/|$)/i;

function outboundHref(value) {
  if (!value) return null;
  const host = hostnameOf(value);
  if (!host || isProtected(host)) return null;
  return value;
}

function isPostPage(url) {
  let path;
  try {
    path = new URL(url).pathname;
  } catch {
    return false;
  }
  return POST_PATH.test(path);
}

const newAdapter = {
  name: "new",
  observedAttributes: ["content-href", "id"],
  findPosts: (root) => Array.from(root.querySelectorAll("shreddit-post")),
  postInfo: (el) => ({
    id: el.getAttribute("id"),
    href: outboundHref(el.getAttribute("content-href")),
  }),
  hideTarget: (el) => [el],
  isPostPage,
};

const oldAdapter = {
  name: "old",
  observedAttributes: ["data-url", "data-fullname"],
  findPosts: (root) => Array.from(root.querySelectorAll("div.thing.link")),
  postInfo: (el) => ({
    id: el.getAttribute("data-fullname"),
    href: outboundHref(el.getAttribute("data-url")),
  }),
  hideTarget: (el) => {
    const spacer = el.nextElementSibling;
    return spacer && spacer.classList.contains("clearleft") ? [el, spacer] : [el];
  },
  isPostPage,
};

export function pickAdapter(hostname) {
  return hostname === "old.reddit.com" ? oldAdapter : newAdapter;
}
