import { failureReason } from "./errors.js";
import { parseImport, planImport, checkSyncLimits } from "../shared/transfer.js";
import { recordsFromItems } from "../shared/records.js";
import { statsFromItems } from "../shared/stats.js";

async function restoreStats(local, previous, keys) {
  const put = {};
  const drop = [];
  for (const key of keys) {
    if (Object.hasOwn(previous, key)) put[key] = previous[key];
    else drop.push(key);
  }
  if (Object.keys(put).length) await local.set(put);
  if (drop.length) await local.remove(drop);
}

// The limit pre-check already ran, so a quota error here is Chrome refusing the write.
const syncFailure = (err) => (failureReason(err) === "quota" ? "import-quota" : "error");

export async function importDomains(areas, text, countMode) {
  if (typeof text !== "string") return { ok: false, reason: "unreadable" };
  if (countMode !== "larger" && countMode !== "sum") return { ok: false, reason: "error" };

  const parsed = parseImport(text);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  const skipped = parsed.skipped.length;
  if (parsed.entries.length === 0) return { ok: false, reason: "nothing-to-import", skipped };

  try {
    const [syncItems, localItems, bytesInUse] = await Promise.all([
      areas.sync.get(null),
      areas.local.get(null),
      areas.sync.getBytesInUse(null),
    ]);
    const plan = planImport(
      recordsFromItems(syncItems),
      statsFromItems(localItems),
      parsed.entries,
      countMode,
    );
    const limits = checkSyncLimits({ currentItems: syncItems, bytesInUse, writes: plan.syncItems });
    if (!limits.ok) return limits;

    const localKeys = Object.keys(plan.localItems);
    if (localKeys.length) {
      try {
        await areas.local.set(plan.localItems);
      } catch (err) {
        return { ok: false, reason: syncFailure(err) };
      }
    }
    if (Object.keys(plan.syncItems).length) {
      try {
        await areas.sync.set(plan.syncItems);
      } catch (err) {
        try {
          await restoreStats(areas.local, localItems, localKeys);
        } catch (restoreErr) {
          // Best effort: report the original failure.
          console.error("Could not restore stats after a failed import", restoreErr);
        }
        return { ok: false, reason: syncFailure(err) };
      }
    }
    return { ok: true, outcome: "imported", added: plan.added, merged: plan.merged, skipped };
  } catch (err) {
    return { ok: false, reason: failureReason(err) };
  }
}
