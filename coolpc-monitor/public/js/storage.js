// localStorage 封裝：保存每個分類最近一次快照，以及供圖表使用的價格歷史紀錄。
// 伺服器是無狀態代理，所有「歷史」都活在瀏覽器端，換分頁/清 localStorage 即重新開始。

const SNAPSHOT_PREFIX = "coolpc-monitor:snapshot:";
const HISTORY_PREFIX = "coolpc-monitor:history:";
const ALERT_RULE_KEY = "coolpc-monitor:alertRule";
const MAX_HISTORY_POINTS = 288; // 5 分鐘一次的話，約可保留 24 小時
const PRODUCT_HISTORY_PREFIX = "coolpc-monitor:product-history:";

export function getSnapshot(categoryKey) {
  try {
    const raw = localStorage.getItem(SNAPSHOT_PREFIX + categoryKey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSnapshot(categoryKey, items) {
  try {
    localStorage.setItem(SNAPSHOT_PREFIX + categoryKey, JSON.stringify(items));
  } catch {
    // localStorage 已滿或無法使用時靜默略過，不影響監控主流程
  }
}

export function getHistory(categoryKey) {
  try {
    const raw = localStorage.getItem(HISTORY_PREFIX + categoryKey);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function appendHistoryPoint(categoryKey, point) {
  const history = getHistory(categoryKey);
  history.push(point);
  const trimmed = history.slice(-MAX_HISTORY_POINTS);
  try {
    localStorage.setItem(HISTORY_PREFIX + categoryKey, JSON.stringify(trimmed));
  } catch {
    // 忽略寫入失敗
  }
  return trimmed;
}

export function getProductHistory(categoryKey) {
  try {
    return JSON.parse(localStorage.getItem(PRODUCT_HISTORY_PREFIX + categoryKey) || "{}");
  } catch {
    return {};
  }
}

export function appendProductHistory(categoryKey, items, timestamp = Date.now()) {
  const history = getProductHistory(categoryKey);
  for (const item of items) {
    if (typeof item.current_price !== "number") continue;
    const points = history[item.product_name] || [];
    points.push({ t: timestamp, price: item.current_price });
    history[item.product_name] = points.slice(-MAX_HISTORY_POINTS);
  }
  try {
    localStorage.setItem(PRODUCT_HISTORY_PREFIX + categoryKey, JSON.stringify(history));
  } catch {}
  return history;
}

export function clearCategory(categoryKey) {
  localStorage.removeItem(SNAPSHOT_PREFIX + categoryKey);
  localStorage.removeItem(HISTORY_PREFIX + categoryKey);
}

/** 全域跌價提醒門檻 (套用在所有監控分類的商品上)。未設定時回傳 null。 */
export function getAlertRule() {
  try {
    const raw = localStorage.getItem(ALERT_RULE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveAlertRule(rule) {
  try {
    if (rule) {
      localStorage.setItem(ALERT_RULE_KEY, JSON.stringify(rule));
    } else {
      localStorage.removeItem(ALERT_RULE_KEY);
    }
  } catch {
    // 忽略寫入失敗
  }
}
