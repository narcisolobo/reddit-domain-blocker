import { hostnameOf, isProtected } from "../shared/domain.js";

const POST_PATH = /\/comments\/[a-z0-9]+(\/|$)/i;
// Site-wide and in-subreddit search. Search results are never blocked: someone
// searching for a topic should see every result.
const SEARCH_PATH = /^\/(r\/[^/]+\/)?search\/?$/i;

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

function isSearchPage(url) {
  let path;
  try {
    path = new URL(url).pathname;
  } catch {
    return false;
  }
  return SEARCH_PATH.test(path);
}

function matcher(selector) {
  return (node) => Boolean(node && node.nodeType === 1 && node.matches(selector));
}

const NEW_POST = "shreddit-post";
const OLD_POST = "div.thing.link";

const newAdapter = {
  name: "new",
  observedAttributes: ["content-href", "id"],
  findPosts: (root) => Array.from(root.querySelectorAll(NEW_POST)),
  isPost: matcher(NEW_POST),
  postInfo: (el) => ({
    id: el.getAttribute("id"),
    href: outboundHref(el.getAttribute("content-href")),
  }),
  hideTarget: (el) => [el],
  isPostPage,
  isSearchPage,
};

const oldAdapter = {
  name: "old",
  observedAttributes: ["data-url", "data-fullname"],
  findPosts: (root) => Array.from(root.querySelectorAll(OLD_POST)),
  isPost: matcher(OLD_POST),
  postInfo: (el) => ({
    id: el.getAttribute("data-fullname"),
    href: outboundHref(el.getAttribute("data-url")),
  }),
  hideTarget: (el) => {
    const spacer = el.nextElementSibling;
    return spacer && spacer.classList.contains("clearleft") ? [el, spacer] : [el];
  },
  isPostPage,
  isSearchPage,
};

export function pickAdapter(hostname) {
  return hostname === "old.reddit.com" ? oldAdapter : newAdapter;
}
