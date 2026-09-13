// 進入點：串接 config/api/parser/storage/notify/monitor/chart，負責 DOM 渲染與事件綁定。

import { CATEGORY_MAP, DEFAULT_POLL_INTERVAL_MS, MIN_POLL_INTERVAL_MS } from "./config.js";
import { fetchCategories } from "./api.js";
import { computeStats, formatPrice } from "./parser.js";
import { getSnapshot, getProductHistory, getAlertRule, saveAlertRule } from "./storage.js";
import * as notify from "./notify.js";
import * as monitor from "./monitor.js";
import { renderProductChart } from "./chart.js";

const categorySelect = document.getElementById("categorySelect");
const brandFilter = document.getElementById("brandFilter");
const wattageFilter = document.getElementById("wattageFilter");
const typeFilter = document.getElementById("typeFilter");
const moduleFilter = document.getElementById("moduleFilter");
const productSelect = document.getElementById("productSelect");
const pollIntervalInput = document.getElementById("pollInterval");
const startStopBtn = document.getElementById("startStopBtn");
const notifyBtn = document.getElementById("notifyBtn");
const notifyStatus = document.getElementById("notifyStatus");
const statEl = document.getElementById("stat");
const lastUpdatedEl = document.getElementById("lastUpdated");
const tblEl = document.getElementById("tbl");
const brandMarketEl = document.getElementById("brandMarket");
const priceChangesLogEl = document.getElementById("priceChangesLog");
const stockChangesLogEl = document.getElementById("stockChangesLog");
const chartCanvas = document.getElementById("priceChart");
const alertTypeSelect = document.getElementById("alertType");
const alertValueInput = document.getElementById("alertValue");
const alertApplyBtn = document.getElementById("alertApplyBtn");
const alertStatusEl = document.getElementById("alertStatus");

let selectedCategory = "water";
let currentItems = [];
const MAX_LOG_ENTRIES = 60;

// --- 分類下拉選單 (伺服器只回傳本工具監控的子集：SSD/RAM/機殼(+電源)) -----------

async function populateCategories() {
  let categories;
  try {
    categories = await fetchCategories();
  } catch {
    // API 尚未就緒 (例如伺服器剛啟動) 時的備援，避免畫面完全空白。
    categories = [
      { key: "water", name: CATEGORY_MAP.water.name },
      { key: "powersupply", name: CATEGORY_MAP.powersupply.name },
      { key: "fan_accessory", name: CATEGORY_MAP.fan_accessory.name },
    ];
  }
  categorySelect.innerHTML = categories
    .map((c) => `<option value="${c.key}">${c.name}</option>`)
    .join("");
  categorySelect.value = selectedCategory;
}

// --- 品牌篩選 --------------------------------------------------------------

function populateBrandFilter(items) {
  const container = brandFilter.parentElement;
  if (!items.length || !("brand" in items[0])) {
    container.style.display = "none";
    return;
  }
  const brands = [...new Set(items.map((i) => i.brand).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "zh-Hant")
  );
  brandFilter.innerHTML =
    '<option value="">全部品牌</option>' + brands.map((b) => `<option value="${b}">${b}</option>`).join("");
  container.style.display = "";
}

function setOptions(select, label, values, formatter = (v) => v) {
  const previous = select.value;
  select.innerHTML = `<option value="">全部${label}</option>` + values
    .map((v) => `<option value="${v}">${formatter(v)}</option>`).join("");
  if (values.map(String).includes(previous)) select.value = previous;
}

function populateFilters(items) {
  populateBrandFilter(items);
  setOptions(wattageFilter, "瓦數", [...new Set(items.map((i) => i.wattage).filter(Boolean))].sort((a,b) => a-b), (v) => `${v}W`);
  setOptions(typeFilter, "種類", [...new Set(items.map((i) => i.product_type).filter(Boolean))].sort());
  setOptions(moduleFilter, "形式", [...new Set(items.map((i) => i.module_type).filter(Boolean))].sort());
  wattageFilter.parentElement.style.display = selectedCategory === "powersupply" ? "" : "none";
  moduleFilter.parentElement.style.display = selectedCategory === "powersupply" ? "" : "none";
}

function populateProductSelect(items) {
  const previous = productSelect.value;
  productSelect.innerHTML = '<option value="">請選擇品項</option>' + items
    .map((i) => `<option value="${encodeURIComponent(i.product_name)}">${i.product_name}</option>`).join("");
  if (items.some((i) => encodeURIComponent(i.product_name) === previous)) productSelect.value = previous;
}

function filteredItems() {
  const brand = brandFilter.value;
  return currentItems.filter((i) =>
    (!brand || i.brand === brand) &&
    (!wattageFilter.value || String(i.wattage) === wattageFilter.value) &&
    (!typeFilter.value || i.product_type === typeFilter.value) &&
    (!moduleFilter.value || i.module_type === moduleFilter.value)
  );
}

// --- 表格 / 統計卡片 ---------------------------------------------------------

function renderTable(items) {
  if (!items.length) {
    tblEl.innerHTML = "";
    return;
  }
  const cols = ["product_name", "brand", "wattage", "product_type", "module_type", "current_price", "orig_price", "site_discount"];
  const headers = ["產品名稱", "品牌", "瓦數", "種類", "直出／模組", "價格", "原價", "站內折價"];
  let html = "<thead><tr>" + headers.map((h) => `<th>${h}</th>`).join("") + "</tr></thead><tbody>";
  html += items
    .map((r) => "<tr>" + cols.map((c) => `<td>${r[c] ?? ""}</td>`).join("") + "</tr>")
    .join("");
  html += "</tbody>";
  tblEl.innerHTML = html;
}

function renderStats(items) {
  const s = computeStats(items);
  let chips = `<div class="chip">${s.count}<small>總筆數</small></div>`;
  chips += `<div class="chip">${s.brandCount}<small>包含品牌數</small></div>`;
  if (typeof s.avgPrice === "number") {
    chips += `<div class="chip">${formatPrice(s.avgPrice)}<small>平均價格</small></div>`;
    chips += `<div class="chip">${formatPrice(s.minPrice)} ~ ${formatPrice(s.maxPrice)}<small>價格區間</small></div>`;
  }
  statEl.innerHTML = chips;
}

function renderBrandMarket(items) {
  const groups = new Map();
  for (const item of items) {
    if (typeof item.current_price !== "number") continue;
    const prices = groups.get(item.brand) || [];
    prices.push(item.current_price);
    groups.set(item.brand, prices);
  }
  const rows = [...groups.entries()].map(([brand, prices]) => ({
    brand,
    count: prices.length,
    avg: Math.round(prices.reduce((sum, price) => sum + price, 0) / prices.length),
    min: Math.min(...prices),
    max: Math.max(...prices),
  })).sort((a, b) => b.count - a.count || a.avg - b.avg);
  if (!rows.length) {
    brandMarketEl.innerHTML = "";
    return;
  }
  brandMarketEl.innerHTML = `<thead><tr><th>品牌</th><th>品項數</th><th>平均價</th><th>最低價</th><th>最高價</th></tr></thead><tbody>${rows.map((row) =>
    `<tr class="${/XPG|威剛/i.test(row.brand) ? "xpg-row" : ""}"><td>${row.brand}</td><td>${row.count}</td><td>${formatPrice(row.avg)}</td><td>${formatPrice(row.min)}</td><td>${formatPrice(row.max)}</td></tr>`
  ).join("")}</tbody>`;
}

function renderCurrentCategory() {
  const items = filteredItems();
  renderTable(items);
  renderStats(items);
  renderBrandMarket(items);
  populateProductSelect(items);
  renderSelectedProductChart();
}

function renderSelectedProductChart() {
  const name = productSelect.value ? decodeURIComponent(productSelect.value) : "";
  const history = getProductHistory(selectedCategory);
  renderProductChart(chartCanvas, name, name ? history[name] || [] : []);
}

// --- 異動紀錄 ----------------------------------------------------------------

function pushLogEntries(categoryName, diff, alertHits, fetchedAt) {
  const { added = [], removed = [], changed = [] } = diff;
  if (!added.length && !removed.length && !changed.length) return;

  const alertNames = new Set((alertHits || []).map((i) => i.product_name));
  const time = new Date(fetchedAt || Date.now()).toLocaleTimeString("zh-Hant", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const entries = [];
  for (const item of changed) {
    const isAlert = alertNames.has(item.product_name);
    const arrow = item.price_change < 0 ? "↓" : "↑";
    const cls = item.price_change < 0 ? "down" : "up";
    const prefix = isAlert ? "🎯 " : "";
    entries.push(
      `<li class="log-entry ${cls}${isAlert ? " alert" : ""}"><b>[${categoryName}]</b> ${prefix}${arrow} ${formatPrice(
        Math.abs(item.price_change)
      )} — ${item.product_name} <span class="log-time">${time}</span></li>`
    );
  }
  for (const item of added) {
    entries.push(
      `<li class="log-entry new"><b>[${categoryName}]</b> ✨ 新上架 — ${item.product_name} <span class="log-time">${time}</span></li>`
    );
  }
  for (const item of removed) {
    entries.push(
      `<li class="log-entry gone"><b>[${categoryName}]</b> 🗑 下架 — ${item.product_name} <span class="log-time">${time}</span></li>`
    );
  }

  const priceEntries = entries.slice(0, changed.length);
  const stockEntries = entries.slice(changed.length);
  if (priceEntries.length) priceChangesLogEl.insertAdjacentHTML("afterbegin", priceEntries.join(""));
  if (stockEntries.length) stockChangesLogEl.insertAdjacentHTML("afterbegin", stockEntries.join(""));
  for (const el of [priceChangesLogEl, stockChangesLogEl]) while (el.children.length > MAX_LOG_ENTRIES) el.removeChild(el.lastChild);
}

// --- 監控回呼 ----------------------------------------------------------------

function onCategoryUpdate(result) {
  const { categoryKey, items, diff, alertHits, stats, fetchedAt, isFirstRun } = result;
  const categoryName = CATEGORY_MAP[categoryKey].name;

  if (!isFirstRun) pushLogEntries(categoryName, diff, alertHits, fetchedAt);

  if (categoryKey === selectedCategory) {
    currentItems = items;
    populateFilters(items);
    renderCurrentCategory();
    lastUpdatedEl.textContent = `最後更新：${new Date(fetchedAt).toLocaleString("zh-Hant")}（共 ${stats.count} 筆）`;
    renderSelectedProductChart();
  }
}

function onError(categoryKey, err) {
  console.error(`[monitor] ${categoryKey} 抓取失敗：`, err);
  if (categoryKey === selectedCategory) {
    lastUpdatedEl.textContent = `⚠ 更新失敗：${err.message}`;
  }
}

// --- 事件綁定 ----------------------------------------------------------------

categorySelect.addEventListener("change", () => {
  selectedCategory = categorySelect.value;
  const categoryName = CATEGORY_MAP[selectedCategory].name;

  // 切換分類時，先用 localStorage 裡的舊快照墊底，不必等下一輪輪詢才有畫面。
  const snapshot = getSnapshot(selectedCategory) || [];
  currentItems = snapshot;
  populateFilters(snapshot);
  renderCurrentCategory();
  lastUpdatedEl.textContent = snapshot.length ? "顯示上次快取結果，等待下一輪輪詢更新…" : "尚無資料，請開始監控。";
  renderSelectedProductChart();
});

[brandFilter, wattageFilter, typeFilter, moduleFilter].forEach((el) => el.addEventListener("change", renderCurrentCategory));
productSelect.addEventListener("change", renderSelectedProductChart);

startStopBtn.addEventListener("click", () => {
  if (monitor.isRunning()) {
    monitor.stopMonitor();
    startStopBtn.textContent = "▶ 開始監控";
    startStopBtn.classList.remove("active");
  } else {
    notify.primeAudio(); // 必須源自使用者手勢，才能讓計時器之後觸發的提示音正常播放
    const seconds = Math.max(Number(pollIntervalInput.value) || 300, MIN_POLL_INTERVAL_MS / 1000);
    pollIntervalInput.value = seconds;
    monitor.startMonitor({ intervalMs: seconds * 1000, onCategoryUpdate, onError });
    startStopBtn.textContent = "⏸ 停止監控";
    startStopBtn.classList.add("active");
  }
});

notifyBtn.addEventListener("click", async () => {
  const perm = await notify.requestPermission();
  updateNotifyStatus(perm);
});

function updateNotifyStatus(perm) {
  const labels = {
    granted: "✅ 已授權通知",
    denied: "🚫 已封鎖通知（請至瀏覽器設定開啟）",
    default: "尚未授權",
    unsupported: "此瀏覽器不支援通知",
  };
  notifyStatus.textContent = labels[perm] || "";
}

// --- 跌價提醒門檻 (套用在所有監控分類的商品上，非綁定特定商品) --------------------

function describeAlertRule(rule) {
  if (!rule) return "尚未設定跌價提醒";
  const unit = rule.type === "percent" ? "%" : "NT$";
  return `目前設定：任何商品降價 ≥ ${rule.value}${unit} 即提醒`;
}

function applyAlertRuleToUI(rule) {
  alertTypeSelect.value = rule?.type || "";
  alertValueInput.value = rule?.value ?? "";
  alertValueInput.disabled = !rule;
  alertStatusEl.textContent = describeAlertRule(rule);
}

alertTypeSelect.addEventListener("change", () => {
  alertValueInput.disabled = !alertTypeSelect.value;
});

alertApplyBtn.addEventListener("click", () => {
  const type = alertTypeSelect.value;
  const value = Number(alertValueInput.value);

  if (!type || !(value > 0)) {
    saveAlertRule(null);
    applyAlertRuleToUI(null);
    return;
  }

  const rule = { type, value };
  saveAlertRule(rule);
  applyAlertRuleToUI(rule);
});

// --- 初始化 -------------------------------------------------------------------

async function init() {
  pollIntervalInput.value = DEFAULT_POLL_INTERVAL_MS / 1000;
  updateNotifyStatus(notify.permissionState());
  applyAlertRuleToUI(getAlertRule());
  await populateCategories();

  const snapshot = getSnapshot(selectedCategory) || [];
  currentItems = snapshot;
  populateFilters(snapshot);
  renderCurrentCategory();
  lastUpdatedEl.textContent = snapshot.length ? "顯示上次快取結果，請按「開始監控」取得最新資料。" : "尚無資料，請按「開始監控」。";
  renderSelectedProductChart();
}

init();
