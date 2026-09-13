// 對 server.js 提供的 REST API 進行封裝。

import { API_BASE } from "./config.js";

export async function fetchCategories() {
  const resp = await fetch(`${API_BASE}/categories`);
  if (!resp.ok) throw new Error(`讀取分類清單失敗：HTTP ${resp.status}`);
  return resp.json();
}

export async function fetchCategoryProducts(categoryKey) {
  const resp = await fetch(`${API_BASE}/products/${encodeURIComponent(categoryKey)}`);
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || `讀取商品資料失敗：HTTP ${resp.status}`);
  }
  return resp.json();
}
