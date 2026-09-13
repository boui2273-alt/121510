// 輪詢引擎：定時抓取「本工具監控的分類子集」(SSD/RAM/機殼(+電源))，逐一與
// localStorage 快照比對、記錄歷史價格、觸發通知/音效，並回呼 onCategoryUpdate
// 讓 app.js 更新畫面。
//
// 每個分類個別呼叫 /api/products/:category，但因 server.js 對原始頁面做了
// SERVER_CACHE_TTL_MS 的快取，一輪多次呼叫實際上通常只打一次原站。

import { MONITORED_CATEGORY_KEYS, CATEGORY_MAP, DEFAULT_POLL_INTERVAL_MS } from "./config.js";
import { fetchCategoryProducts } from "./api.js";
import { diffSnapshots, computeStats, matchesAlertRule } from "./parser.js";
import { getSnapshot, saveSnapshot, appendHistoryPoint, appendProductHistory, getAlertRule } from "./storage.js";
import { notifyDiffSummary, notifyPriceAlert, playChangeSound, playAlertSound } from "./notify.js";

let intervalHandle = null;
let currentIntervalMs = DEFAULT_POLL_INTERVAL_MS;

export function isRunning() {
  return intervalHandle !== null;
}

/** 輪詢單一分類：抓取 → 比對快照 → 存檔 → 比對跌價提醒門檻 → 通知/音效 → 回呼。 */
export async function pollCategory(categoryKey, { onCategoryUpdate, onError } = {}) {
  try {
    const resp = await fetchCategoryProducts(categoryKey);
    const items = resp.items;
    const prevItems = getSnapshot(categoryKey);
    const diff = diffSnapshots(prevItems, items);
    const stats = computeStats(items);
    const categoryName = CATEGORY_MAP[categoryKey].name;

    saveSnapshot(categoryKey, items);
    if (typeof stats.avgPrice === "number") {
      appendHistoryPoint(categoryKey, { t: Date.now(), avg: stats.avgPrice });
    }
    appendProductHistory(categoryKey, items);

    let alertHits = [];
    const hasDiff = diff.added.length || diff.removed.length || diff.changed.length;

    if (prevItems) {
      // 第一次抓取沒有比對基準，不視為「異動」，避免開頁就跳一堆通知/響一堆音效。
      notifyDiffSummary(categoryName, diff);
      if (hasDiff) playChangeSound();

      const rule = getAlertRule();
      alertHits = diff.changed.filter((item) => matchesAlertRule(item, rule));
      if (alertHits.length) {
        notifyPriceAlert(categoryName, alertHits);
        playAlertSound();
      }
    }

    const result = {
      categoryKey,
      items,
      diff,
      alertHits,
      stats,
      fetchedAt: resp.fetched_at,
      isFirstRun: !prevItems,
    };
    onCategoryUpdate?.(result);
    return result;
  } catch (e) {
    onError?.(categoryKey, e);
    return null;
  }
}

/** 依序輪詢所有監控分類 (逐一 await，避免同時對 server 發多個平行請求)。 */
export async function pollAll({ onCategoryUpdate, onError } = {}) {
  for (const key of MONITORED_CATEGORY_KEYS) {
    await pollCategory(key, { onCategoryUpdate, onError });
  }
}

export function startMonitor({ intervalMs = DEFAULT_POLL_INTERVAL_MS, onCategoryUpdate, onError } = {}) {
  stopMonitor();
  currentIntervalMs = intervalMs;
  pollAll({ onCategoryUpdate, onError }); // 立即跑第一輪，不等第一個 interval
  intervalHandle = setInterval(() => pollAll({ onCategoryUpdate, onError }), currentIntervalMs);
}

export function stopMonitor() {
  if (intervalHandle !== null) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
