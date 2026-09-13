# CoolPC Monitor (原價屋監控工具)

自動讀取原價屋線上估價系統，持續監控第 11 項「封閉式／開放式水冷」、第 15 項「電源供應器」、第 16 項「機殼風扇／機殼配件」的價格與上下架異動。

## 安裝與啟動

1. 確認已安裝 Node.js (v14+)。
2. 在專案根目錄執行 `npm install` 安裝相依套件。
3. 執行 `npm start` 啟動伺服器。
4. 打開瀏覽器訪問 `http://localhost:3000` 即可使用。

> 若 3000 埠被系統佔用或保留（Windows 開發機常見於 Hyper-V/WSL 的連接埠保留範圍，
> 啟動時會看到 `EACCES`），可用 `PORT=xxxx npm start` 指定其他埠。

選擇分類、設定輪詢間隔後按「▶ 開始監控」。按「🔔 啟用桌面通知」授權後，
偵測到新上架/下架/價格漲跌時會跳出桌面通知並播放提示音。

## 功能

- 價格/庫存異動自動比對（新上架／下架／漲跌，比對基準為上一輪快照）
- 歷史價格走勢 (Chart.js)
- 桌面通知與音效提示（Web Audio API 即時合成，無需外部音檔；每次偵測到異動都會出聲）
- 支援品牌、瓦數、種類、直出／半模組／全模組下拉篩選
- 可選擇單一品項查看價格趨勢圖
- 價格異動與新品／下架分區提醒、自訂價格提醒
  （設定「降價金額 NT$」或「降價百分比 %」門檻，套用在所有監控分類的商品上，
  命中時會額外發出獨立通知、加強提示音，並在異動紀錄中以 🎯 標示）

## 架構

```
coolpc-monitor/
├── server.js            Express 代理伺服器 (CommonJS)：抓取/解析原價屋頁面，提供 JSON API
└── public/
    ├── package.json      {"type":"module"}：僅此子目錄視為 ESM，讓 server.js 用動態 import()
    │                      讀取 config.js 時不必把整個專案都改成 ESM
    ├── index.html        儀表板頁面
    ├── css/style.css      介面樣式
    └── js/
        ├── config.js      共用設定 (分類/品牌對照表、本工具監控的分類子集)
        ├── api.js         封裝對 server.js API 的 fetch 呼叫
        ├── parser.js       統計摘要、快照比對 (新增/下架/漲跌)、跌價提醒門檻判斷的純函式
        ├── storage.js      localStorage 封裝：保存快照、價格歷史、跌價提醒設定
        ├── notify.js       瀏覽器 Notification API + Web Audio 音效提示封裝
        ├── monitor.js      輪詢引擎：定時抓取監控分類、比對、通知/音效
        ├── chart.js        Chart.js 價格走勢圖
        └── app.js          進入點：DOM 渲染與事件綁定
```

**資料流**：`server.js` 用 axios 即時代理抓取原價屋頁面 (與 `crawler.py` 相同的 Big5 解碼、
品名/價格/品牌解析、機殼(+電源)組合偵測邏輯)，並在記憶體中快取原始頁面 60 秒，
避免多個分類、多個分頁同時輪詢時對原站重複發送請求。所有「歷史」「上次快照」與
「跌價提醒設定」都保存在瀏覽器的 `localStorage`，伺服器本身是無狀態的。

**監控範圍**：`config.js` 的 `MONITORED_CATEGORY_KEYS` 目前設為 `["ssd", "ram", "case_psu"]`，
決定了 `/api/categories`、輪詢迴圈與前端分類下拉選單只會用到這 3 類。
`CATEGORY_MAP`／`/api/products/:category` 仍保留完整 12 個分類供彈性查詢，
若要擴大監控範圍，只需調整 `MONITORED_CATEGORY_KEYS`。

**HTML 解析不依賴函式庫**：`server.js` 直接用正規表示式從原始 HTML 擷取
`<select>`/`<optgroup>`/`<option>` 區塊 (取代 cheerio)，需特別處理兩個原價屋頁面的特性：

1. 屬性值大多**不加引號**（如 `name=n14`，而非 `name="n14"`）。
2. 部分 `<option>` **沒有對應的 `</option>` 結束標籤**（例如每個 select 開頭的
   「共有商品 XXX 樣...」統計列），需仰賴 HTML5 的隱式結束規則
   （下一個 `<option>`/`<optgroup>`/`</optgroup>`/`</select>` 出現時視為自動結束），
   正規表示式已用 negative lookahead 明確模擬這個邊界，避免貪婪比對把好幾個商品的文字誤合併在一起。

## API

| 端點 | 說明 |
|--|--|
| `GET /api/categories` | 回傳本工具監控的分類子集 (key/name)：SSD、RAM、機殼(+電源) |
| `GET /api/products/:category` | 即時抓取並回傳該分類的商品清單 (JSON)，支援完整 12 個分類 |

支援的 `:category`：`powersupply` `gpu` `cpu` `mb` `ram` `ssd` `hdd` `case`
`case_psu`（機殼+電源組合）`cooler` `water` `monitor`，與 `crawler.py --category` 一致。

## 合法性與禮貌設計

- 明確 User-Agent，聲明教學/自動化用途。
- 伺服器端 60 秒頁面快取，前端輪詢間隔最低限制 30 秒，避免對原站造成負擔。
- 已確認原價屋 `robots.txt` 允許抓取 `evaluate.php`（與 `crawler.py` 的檢查結果一致），
  故本專案未內建執行期 `robots.txt` 檢查；若目標網站的爬取政策改變，建議手動重新確認。

## CORS

已啟用開放式 CORS (`Access-Control-Allow-Origin: *`)，`/api/*` 可被任何來源的前端呼叫。
若儀表板僅供內部使用、不希望其他網站呼叫這組 API，可將 `server.js` 的 `app.use(cors())`
改為 `app.use(cors({ origin: "https://your-allowed-origin" }))`。

## 與 crawler.py 的差異

|  | `crawler.py` | `coolpc-monitor` |
|--|--|--|
| 執行方式 | CLI 單次批次執行 | 常駐網頁，持續輪詢 |
| 監控範圍 | 支援全部 12 分類，`--category all` | 預設監控 SSD/RAM/機殼(+電源) 3 類 |
| 輸出 | `output/*.csv` / `*.json` | 瀏覽器畫面 + 桌面通知 + 音效 + 走勢圖 |
| 歷史紀錄 | `output/*_history.json` | 瀏覽器 `localStorage` |
| 適合場景 | 排程任務、定期產生報表 | 開著分頁即時盯盤、自訂跌價提醒 |
