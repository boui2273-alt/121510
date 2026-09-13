// 瀏覽器 Notification API 封裝：偵測到新增/下架/價格變動時跳出桌面通知。

import { formatPrice } from "./parser.js";

export function isSupported() {
  return typeof Notification !== "undefined";
}

export function permissionState() {
  return isSupported() ? Notification.permission : "unsupported";
}

export async function requestPermission() {
  if (!isSupported()) return "unsupported";
  if (Notification.permission === "default") {
    return Notification.requestPermission();
  }
  return Notification.permission;
}

/**
 * 針對一次分類輪詢的比對結果 (diffSnapshots 回傳值) 發出彙總通知。
 * 若無任何異動，或使用者尚未授權通知權限，則不會顯示任何東西。
 */
export function notifyDiffSummary(categoryName, diff) {
  const { added = [], removed = [], changed = [] } = diff;
  if (!added.length && !removed.length && !changed.length) return;
  if (!isSupported() || Notification.permission !== "granted") return;

  const drops = changed.filter((i) => i.price_change < 0).sort((a, b) => a.price_change - b.price_change);
  const hikes = changed.filter((i) => i.price_change > 0);

  const lines = [];
  if (drops.length) {
    const top = drops[0];
    lines.push(`降價 ${drops.length} 項，最多降 ${formatPrice(Math.abs(top.price_change))}：${top.product_name}`);
  }
  if (hikes.length) lines.push(`漲價 ${hikes.length} 項`);
  if (added.length) lines.push(`新上架 ${added.length} 項`);
  if (removed.length) lines.push(`下架 ${removed.length} 項`);

  new Notification(`🔌 ${categoryName} 價格異動通知`, {
    body: lines.join("\n"),
    tag: `coolpc-monitor-${categoryName}`, // 同分類的通知會互相取代，避免洗版
  });
}

/**
 * 針對「跌價提醒門檻」命中的項目，額外發出一則獨立通知 (不受同分類 tag 覆蓋，
 * 每次命中都會各自顯示)，用來與一般異動通知做區隔。
 */
export function notifyPriceAlert(categoryName, hits) {
  if (!hits.length || !isSupported() || Notification.permission !== "granted") return;
  const sorted = [...hits].sort((a, b) => a.price_change - b.price_change);
  const top = sorted[0];
  const lines = sorted
    .slice(0, 5)
    .map((i) => `${i.product_name} → ${formatPrice(i.current_price)} (↓${formatPrice(Math.abs(i.price_change))})`);
  if (sorted.length > 5) lines.push(`...等共 ${sorted.length} 項`);

  new Notification(`🎯 ${categoryName} 達到跌價提醒門檻！`, {
    body: lines.join("\n"),
    tag: `coolpc-monitor-alert-${categoryName}-${Date.now()}`, // 每次命中都獨立顯示，不互相覆蓋
  });
}

// --- 音效提示 (Web Audio API 即時合成，不需外部音檔) --------------------------

let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = new Ctor();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

/**
 * 瀏覽器的自動播放政策要求音訊必須源自使用者手勢。在「▶ 開始監控」按鈕的
 * click 事件中呼叫這個函式一次，之後計時器觸發的 playChangeSound/playAlertSound
 * 才能正常出聲。
 */
export function primeAudio() {
  getAudioContext();
}

function beep(ctx, freq, startOffsetSec, durationMs, gain = 0.15) {
  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gainNode.gain.value = gain;
  osc.connect(gainNode).connect(ctx.destination);
  const t0 = ctx.currentTime + startOffsetSec;
  osc.start(t0);
  osc.stop(t0 + durationMs / 1000);
}

/** 每次偵測到任何新增/下架/價格變動都會播放的提示音。 */
export function playChangeSound() {
  const ctx = getAudioContext();
  if (!ctx) return; // 尚未經使用者手勢解鎖，或瀏覽器不支援 Web Audio，靜默略過
  beep(ctx, 880, 0, 150);
}

/** 命中跌價提醒門檻時的加強提示音 (兩段音，與一般提示音區隔)。 */
export function playAlertSound() {
  const ctx = getAudioContext();
  if (!ctx) return;
  beep(ctx, 660, 0, 120);
  beep(ctx, 880, 0.14, 150);
}
