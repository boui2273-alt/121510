// 原價屋估價系統 Express 代理伺服器 (CommonJS)
//
// 即時抓取 https://www.coolpc.com.tw/evaluate.php，解析商品清單並以 JSON API 提供給前端。
// 不依賴 HTML 解析函式庫 (cheerio)，改以正規表示式直接從原始 HTML 擷取 <select>/<optgroup>/
// <option> 區塊；解析邏輯 (品名清理/價格擷取/品牌判定/機殼+電源組合偵測) 皆與 crawler.py 保持一致。
//
// public/js/config.js 是純 ESM 模組 (瀏覽器端直接以 <script type="module"> 載入)，
// 這裡用動態 import() 讀取，讓分類/品牌對照表維持單一來源、伺服器與前端共用。

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const iconv = require("iconv-lite");
const path = require("node:path");

const PORT = process.env.PORT || 3000;

// --- HTML 擷取工具 (取代 cheerio) ---------------------------------------------

function extractSelectHtml(html, selectName) {
  // 原價屋頁面的 <select>/<option> 屬性值大多「不加引號」(如 name=n14)，
  // 因此屬性值前後的引號必須視為選用；用同一個反參照群組確保引號成對比對，
  // 沒有引號時該群組即比對空字串，並以 lookahead 確保比對到完整的屬性值邊界。
  const re = new RegExp(
    `<select[^>]*\\bname=(["']?)${selectName}\\1(?=[\\s>])[^>]*>([\\s\\S]*?)</select>`,
    "i"
  );
  const m = html.match(re);
  return m ? m[2] : null;
}

function extractOptgroups(selectHtml) {
  const re = /<optgroup[^>]*\blabel=["']([^"']*)["'][^>]*>([\s\S]*?)<\/optgroup>/gi;
  const groups = [];
  let m;
  while ((m = re.exec(selectHtml)) !== null) {
    groups.push({ label: decodeEntities(m[1]).trim(), html: m[2] });
  }
  return groups;
}

// 原價屋頁面部分 <option> 沒有對應的 </option> 結束標籤 (例如每個 select 開頭
// 的「共有商品 XXX 樣...」統計列)，仰賴 HTML5 的隱式結束規則：下一個 <option>、
// <optgroup>、</optgroup> 或 </select> 出現時視為自動結束。cheerio/bs4 這類真正的
// HTML 解析器會自動處理這點；正規表示式必須用 negative lookahead 明確模擬同樣的
// 邊界規則，否則遇到沒有結束標籤的 <option> 會一路貪婪比對到下一個 </option>，
// 把好幾個商品的文字錯誤合併在一起。
function extractOptionTexts(html) {
  const re = /<option\b[^>]*>((?:(?!<option\b|<\/option>|<optgroup\b|<\/optgroup>|<\/select>)[\s\S])*)/gi;
  const texts = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    texts.push(decodeEntities(stripTags(m[1])).trim());
  }
  return texts;
}

function stripTags(s) {
  return s.replace(/<[^>]*>/g, "");
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}

// --- 原始頁面快取：同一份 HTML 在 TTL 內給所有分類共用，避免重複請求原站 --------

let pageCache = { html: null, fetchedAt: 0 };

async function fetchEvaluatePage(TARGET_URL, USER_AGENT, cacheTtlMs) {
  const now = Date.now();
  if (pageCache.html && now - pageCache.fetchedAt < cacheTtlMs) {
    return pageCache.html;
  }
  const resp = await axios.get(TARGET_URL, {
    headers: { "User-Agent": USER_AGENT },
    responseType: "arraybuffer",
    timeout: 15000,
  });
  // 原價屋使用 Big5 / CP950 編碼，需明確解碼避免亂碼
  const html = iconv.decode(Buffer.from(resp.data), "cp950");
  pageCache = { html, fetchedAt: now };
  return html;
}

// --- 解析單一 <option>：品名/品牌/價格/原價/促銷 (對應 crawler.py parse_product_option) --

function parseProductOption(rawText, groupLabel, BRAND_MAP) {
  if (!/\$\d+/.test(rawText)) return null;

  let cleanStr = rawText.replace(/[◆★]/g, "");
  cleanStr = cleanStr.replace(/\s*熱賣\s*$/, "").trim();

  let origPrice = null;
  let currentPrice = null;

  const dropMatch = cleanStr.match(/\$(\d+)\s*↘\s*\$(\d+)/);
  if (dropMatch) {
    origPrice = parseInt(dropMatch[1], 10);
    currentPrice = parseInt(dropMatch[2], 10);
  } else {
    const origMatch = cleanStr.match(/原價\s*\$(\d+)/);
    if (origMatch) origPrice = parseInt(origMatch[1], 10);

    const allPrices = [...cleanStr.matchAll(/\$(\d+)/g)].map((m) => parseInt(m[1], 10));
    if (allPrices.length) {
      currentPrice = allPrices[allPrices.length - 1];
      if (origPrice === null && allPrices.length >= 2) origPrice = allPrices[0];
    }
  }

  if (origPrice === currentPrice) origPrice = null;

  const siteDiscount =
    origPrice && currentPrice && origPrice > currentPrice ? origPrice - currentPrice : 0;

  let name = cleanStr;
  name = name.replace(/原價\s*\$\d+！?/g, "");
  name = name.replace(/▼.*$/, "");
  name = name.replace(/,\s*\$\d+.*$/, "");
  name = name.replace(/\$\d+.*$/, "");
  name = name.trim();
  if (!name) return null;

  let brand = null;
  const upperName = name.toUpperCase();
  for (const [k, v] of Object.entries(BRAND_MAP)) {
    if (upperName.includes(k)) {
      brand = v;
      break;
    }
  }
  if (!brand && groupLabel) {
    const upperGroup = groupLabel.toUpperCase();
    for (const [k, v] of Object.entries(BRAND_MAP)) {
      if (upperGroup.includes(k)) {
        brand = v;
        break;
      }
    }
  }
  if (!brand) brand = name.split(/\s+/)[0] || "其他";

  return {
    product_name: name,
    brand,
    current_price: currentPrice,
    orig_price: origPrice,
    site_discount: siteDiscount,
    group: groupLabel,
    raw_text: rawText,
  };
}

// 判斷機殼品名是否為「機殼+電源」組合商品 (對應 crawler.py is_case_psu_bundle)。
// 只比對「電源」字樣並不可靠：機殼商品常見「電源艙」「側置電源」等純機殼功能敘述，
// 並非搭售電源。真正的組合商品符合下列任一：
//   1. 「內附<瓦數>W...電源」：機殼內建電源
//   2. 名稱中最後一個「+」符號之後出現「電源」：以「+」串接了另一項電源供應器
function isCasePsuBundle(name) {
  if (/內附\s*\d+\s*W[^,，]*電源/.test(name)) return true;
  const plusIdx = name.lastIndexOf("+");
  if (plusIdx !== -1 && name.slice(plusIdx).includes("電源")) return true;
  return false;
}

function enrichItem(item, catKey) {
  const name = item.product_name;
  const wattMatch = name.match(/(?:^|[^\d])(\d{3,4})\s*W\b/i);
  item.wattage = wattMatch ? Number(wattMatch[1]) : null;

  if (catKey === "water") {
    item.product_type = /開放式|水箱|幫浦|泵浦頭|冷排/.test(name) && !/一體式|AIO/i.test(name)
      ? "開放式水冷"
      : "封閉式水冷";
  } else if (catKey === "powersupply") {
    item.product_type = /\bSFX(?:-L)?\b/i.test(name) ? "SFX／SFX-L" : /\bATX(?:\s*3(?:\.\d)?|\b)/i.test(name) ? "ATX" : "其他電源";
  } else if (catKey === "fan_accessory") {
    item.product_type = /風扇|\d+\s*cm|\d+\s*mm/i.test(name)
      ? "機殼風扇"
      : /控制器|集線器|HUB/i.test(name) ? "控制器／集線器" : "線材／其他配件";
  } else {
    item.product_type = item.group || "其他";
  }

  if (/全模(?:組)?/i.test(name)) item.module_type = "全模組";
  else if (/半模(?:組)?/i.test(name)) item.module_type = "半模組";
  else if (/直出|非模組/i.test(name)) item.module_type = "直出／非模組";
  else item.module_type = "未標示";
  return item;
}

// --- 抓取指定分類 (對應 crawler.py scrape_category) --------------------------

function scrapeCategory(html, catKey, CATEGORY_MAP, BRAND_MAP) {
  const catInfo = CATEGORY_MAP[catKey];
  if (!catInfo) throw new Error(`未知分類：${catKey}`);

  const selectHtml = extractSelectHtml(html, catInfo.select_name);
  if (!selectHtml) return [];

  let parsedItems = [];
  const optgroups = extractOptgroups(selectHtml);

  if (optgroups.length) {
    for (const group of optgroups) {
      for (const text of extractOptionTexts(group.html)) {
        const item = parseProductOption(text, group.label, BRAND_MAP);
        if (item) {
          item.category = catInfo.name;
          parsedItems.push(enrichItem(item, catKey));
        }
      }
    }
  } else {
    for (const text of extractOptionTexts(selectHtml)) {
      const item = parseProductOption(text, "", BRAND_MAP);
      if (item) {
        item.category = catInfo.name;
        parsedItems.push(enrichItem(item, catKey));
      }
    }
  }

  if (catInfo.comboOnly) {
    parsedItems = parsedItems.filter((item) => isCasePsuBundle(item.product_name));
  }

  // 去重：若同一商品在「特價專區」與「品牌專區」同時出現，保留包含原價資訊的項目
  const uniqueMap = new Map();
  for (const item of parsedItems) {
    const existing = uniqueMap.get(item.product_name);
    if (!existing) {
      uniqueMap.set(item.product_name, item);
    } else if (item.orig_price && !existing.orig_price) {
      uniqueMap.set(item.product_name, item);
    }
  }

  return [...uniqueMap.values()];
}

// --- 主流程 -------------------------------------------------------------------

async function main() {
  const config = await import("./public/js/config.js");
  const { TARGET_URL, USER_AGENT, CATEGORY_MAP, MONITORED_CATEGORY_KEYS, BRAND_MAP, SERVER_CACHE_TTL_MS } =
    config;

  const app = express();
  app.use(cors());
  app.use(express.static(path.join(__dirname, "public")));

  // 只回傳本工具實際監控的分類子集 (SSD/RAM/機殼(+電源))，供前端下拉選單與輪詢迴圈使用。
  // /api/products/:category 本身仍支援 CATEGORY_MAP 裡的完整 12 個分類，未被移除。
  app.get("/api/categories", (req, res) => {
    res.json(
      MONITORED_CATEGORY_KEYS.map((key) => ({
        key,
        name: CATEGORY_MAP[key].name,
        comboOnly: Boolean(CATEGORY_MAP[key].comboOnly),
      }))
    );
  });

  app.get("/api/products/:category", async (req, res) => {
    const { category } = req.params;
    if (!CATEGORY_MAP[category]) {
      return res.status(404).json({ error: `未知分類：${category}` });
    }
    try {
      const html = await fetchEvaluatePage(TARGET_URL, USER_AGENT, SERVER_CACHE_TTL_MS);
      const items = scrapeCategory(html, category, CATEGORY_MAP, BRAND_MAP);
      res.json({
        category,
        category_name: CATEGORY_MAP[category].name,
        fetched_at: new Date(pageCache.fetchedAt).toISOString(),
        count: items.length,
        items,
      });
    } catch (e) {
      res.status(502).json({ error: `爬取失敗：${e.message}` });
    }
  });

  app.listen(PORT, () => {
    console.log(`[*] 原價屋監控代理伺服器已啟動：http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error("[X] 伺服器啟動失敗：", err);
  process.exit(1);
});
