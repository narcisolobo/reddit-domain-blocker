import { hostnameOf } from "../shared/domain.js";

export const MENU_ID = "block-domain";

// Hosts Reddit sends promoted-post clicks through. Ads look like ordinary
// posts, so a refusal on one of these says it's an ad.
const AD_HOSTS = ["alb.reddit.com"];

export function isAdLink(linkUrl) {
  return AD_HOSTS.includes(hostnameOf(linkUrl));
}

export async function registerMenu(contextMenus) {
  await contextMenus.removeAll();
  await contextMenus.create({
    id: MENU_ID,
    title: "Block this domain",
    contexts: ["link"],
    documentUrlPatterns: ["*://*.reddit.com/*"],
  });
}

export function menuNoticeFor(result, linkUrl) {
  if (result.ok) {
    if (result.outcome === "exists") return { kind: "status", text: `${result.domain} is already blocked.` };
    return null;
  }
  switch (result.reason) {
    case "protected":
      if (isAdLink(linkUrl)) {
        return { kind: "error", text: "This looks like an ad. Ads can't be blocked by domain." };
      }
      return {
        kind: "error",
        text: "Reddit's own links can't be blocked. Right-click the post's outbound link instead.",
      };
    case "invalid":
    case "empty":
    case "single-label":
      return { kind: "error", text: "That link has no domain that can be blocked." };
    case "ip":
      return { kind: "error", text: "IP addresses can't be blocked." };
    case "quota":
      return { kind: "error", text: "The block list is full. Remove some domains on the options page." };
    default:
      return { kind: "error", text: "Couldn't block that domain. Please try again." };
  }
}
