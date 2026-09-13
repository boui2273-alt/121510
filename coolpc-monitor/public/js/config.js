// 共用設定 —— 同時被 server.js (Node) 與瀏覽器端 (app.js 等) 匯入。
// 純 ESM、不含任何 Node 專屬 API，因此可以直接以 <script type="module"> 載入。

export const TARGET_URL = "https://www.coolpc.com.tw/evaluate.php";

export const USER_AGENT =
  "CoolPCMonitorProxy/1.0 (+educational; course: web-scraping-automation; " +
  "respects robots.txt; contact: teacher@example.edu)";

export const API_BASE = "/api";

// 伺服器端快取原始頁面的時間 (毫秒)：避免多個瀏覽器分頁同時輪詢時重複轟炸原站。
export const SERVER_CACHE_TTL_MS = 60 * 1000;

// 前端預設輪詢間隔 (毫秒)。
export const DEFAULT_POLL_INTERVAL_MS = 5 * 60 * 1000;
export const MIN_POLL_INTERVAL_MS = 30 * 1000;

// 商品分類對照表 (與 crawler.py 的 CATEGORY_MAP 一致)。
export const CATEGORY_MAP = {
  powersupply: { select_name: "n15", name: "電源供應器", filename: "powersupply" },
  gpu: { select_name: "n12", name: "顯示卡", filename: "gpu" },
  cpu: { select_name: "n4", name: "CPU處理器", filename: "cpu" },
  mb: { select_name: "n5", name: "主機板", filename: "mb" },
  ram: { select_name: "n6", name: "記憶體", filename: "ram" },
  ssd: { select_name: "n7", name: "固態硬碟SSD", filename: "ssd" },
  hdd: { select_name: "n8", name: "傳統硬碟HDD", filename: "hdd" },
  case: { select_name: "n14", name: "機殼", filename: "case" },
  case_psu: { select_name: "n14", name: "機殼(+電源)", filename: "case_psu", comboOnly: true },
  cooler: { select_name: "n10", name: "CPU散熱器", filename: "cooler" },
  water: { select_name: "n11", name: "封閉式／開放式水冷", filename: "water" },
  fan_accessory: { select_name: "n16", name: "機殼風扇／機殼配件", filename: "fan_accessory" },
  monitor: { select_name: "n13", name: "螢幕", filename: "monitor" },
};

export const CATEGORY_KEYS = Object.keys(CATEGORY_MAP);

// 本工具實際監控/輪詢的分類子集：SSD、RAM、機殼(+電源) 組合。
// CATEGORY_MAP／/api/products/:category 仍保留完整 12 個分類供彈性查詢，
// 但 /api/categories、monitor.js 的輪詢迴圈、以及前端分類下拉選單都只會用到這個子集。
export const MONITORED_CATEGORY_KEYS = ["water", "powersupply", "fan_accessory"];

// 品牌對照表 (與 crawler.py 的 BRAND_MAP 一致)。
export const BRAND_MAP = {
  "華碩": "華碩 / ASUS", "ASUS": "華碩 / ASUS", "ROG": "華碩 / ASUS", "TUF": "華碩 / ASUS",
  "海韻": "海韻 / Seasonic", "SEASONIC": "海韻 / Seasonic",
  "台達": "台達 / DELTA", "DELTA": "台達 / DELTA",
  "APEXGAMING": "Apexgaming / 美商艾湃", "美商艾湃": "Apexgaming / 美商艾湃", "首利": "Apexgaming / 美商艾湃",
  "COUGAR": "COUGAR / 美洲獅", "美洲獅": "COUGAR / 美洲獅",
  "振華": "振華 / Super Flower", "SUPER FLOWER": "振華 / Super Flower",
  "MONTECH": "Montech / 君主", "君主": "Montech / 君主",
  "銀欣": "銀欣 / SilverStone", "SILVERSTONE": "銀欣 / SilverStone",
  "酷碼": "酷碼 / Cooler Master", "COOLER MASTER": "酷碼 / Cooler Master", "COOLERMASTER": "酷碼 / Cooler Master",
  "XPG": "XPG / 威剛", "威剛": "XPG / 威剛", "ADATA": "XPG / 威剛",
  "保銳": "保銳 / ENERMAX", "ENERMAX": "保銳 / ENERMAX",
  "ANTEC": "Antec / 安鈦克", "安鈦克": "Antec / 安鈦克",
  "全漢": "全漢 / FSP", "FSP": "全漢 / FSP",
  "微星": "微星 / MSI", "MSI": "微星 / MSI",
  "DEEPCOOL": "DEEPCOOL / 九州風神", "九州風神": "DEEPCOOL / 九州風神",
  "BITFENIX": "BitFenix / 火鳥", "火鳥": "BitFenix / 火鳥",
  "THERMALRIGHT": "Thermalright / 利民", "利民": "Thermalright / 利民", "索摩樂": "Thermalright / 利民",
  "DARKFLASH": "darkFlash / 大飛", "大飛": "darkFlash / 大飛",
  "NZXT": "NZXT / 恩傑", "恩傑": "NZXT / 恩傑",
  "ASROCK": "ASRock / 華擎", "華擎": "ASRock / 華擎",
  "技嘉": "技嘉 / GIGABYTE", "GIGABYTE": "技嘉 / GIGABYTE", "AORUS": "技嘉 / GIGABYTE",
  "THERMALTAKE": "曜越 / Thermaltake", "曜越": "曜越 / Thermaltake",
  "LIAN LI": "聯力 / LIAN LI", "聯力": "聯力 / LIAN LI",
  "ZOTAC": "索泰 / ZOTAC", "INNO3D": "映眾 / INNO3D", "撼訊": "撼訊 / PowerColor",
  "藍寶石": "藍寶石 / Sapphire", "麗臺": "麗臺 / Leadtek",
  "美光": "美光 / Micron", "金士頓": "金士頓 / Kingston", "十銓": "十銓 / Team",
  "科賦": "科賦 / KLEVV", "芝奇": "芝奇 / G.SKILL", "WD": "WD / 威騰",
  "SEAGATE": "Seagate / 希捷", "TOSHIBA": "Toshiba / 東芝", "SAMSUNG": "三星 / Samsung",
};
