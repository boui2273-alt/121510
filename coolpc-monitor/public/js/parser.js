// 純函式：統計摘要與快照比對 (對應 crawler.py 的 track_changes 邏輯，但比對的是
// server.js 已解析好的 JSON，而非原始 HTML)。

export function formatPrice(n) {
  return n === null || n === undefined ? "" : `NT$ ${n.toLocaleString("zh-Hant")}`;
}

export function computeStats(items) {
  const prices = items.map((i) => i.current_price).filter((n) => typeof n === "number");
  const brands = new Set(items.map((i) => i.brand).filter(Boolean));
  const stats = { count: items.length, brandCount: brands.size };
  if (prices.length) {
    stats.avgPrice = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
    stats.minPrice = Math.min(...prices);
    stats.maxPrice = Math.max(...prices);
  }
  return stats;
}

/**
 * 比對前一份快照 (prevItems) 與這次抓到的商品 (currItems)，回傳：
 *   added    - 新上架商品
 *   removed  - 下架商品
 *   changed  - 價格變動商品 (含 prevPrice / diff)
 * 商品以 product_name 作為比對鍵值，與 crawler.py 一致。
 */
export function diffSnapshots(prevItems, currItems) {
  const prevMap = new Map((prevItems || []).map((i) => [i.product_name, i]));
  const currMap = new Map((currItems || []).map((i) => [i.product_name, i]));

  const added = [];
  const changed = [];
  const removed = [];

  for (const [name, item] of currMap) {
    const prev = prevMap.get(name);
    if (!prev) {
      added.push(item);
      continue;
    }
    const diff =
      typeof item.current_price === "number" && typeof prev.current_price === "number"
        ? item.current_price - prev.current_price
        : 0;
    if (diff !== 0) {
      changed.push({ ...item, prev_price: prev.current_price, price_change: diff });
    }
  }

  for (const [name, prev] of prevMap) {
    if (!currMap.has(name)) {
      removed.push(prev);
    }
  }

  return { added, removed, changed };
}

/**
 * 判斷單一「價格變動」項目 (diffSnapshots 回傳的 changed[i]，含 price_change/prev_price)
 * 是否達到使用者自訂的跌價提醒門檻。門檻套用在「本次監控分類」的所有商品上，
 * 而非綁定特定商品。
 *
 * rule: { type: 'percent' | 'amount', value: number } | null
 *   - type 'amount'  → 降價金額 (NT$) ≥ value 即命中
 *   - type 'percent' → 降價幅度 (相對於前次價格的百分比) ≥ value 即命中
 */
export function matchesAlertRule(item, rule) {
  if (!rule || !rule.type || !(rule.value > 0)) return false;
  if (typeof item.price_change !== "number" || item.price_change >= 0) return false;

  const dropAmount = Math.abs(item.price_change);

  if (rule.type === "amount") {
    return dropAmount >= rule.value;
  }
  if (rule.type === "percent") {
    const base = item.prev_price;
    if (typeof base !== "number" || base <= 0) return false;
    return (dropAmount / base) * 100 >= rule.value;
  }
  return false;
}
