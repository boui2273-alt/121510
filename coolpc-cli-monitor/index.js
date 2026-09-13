const axios = require('axios');
const iconv = require('iconv-lite');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

// 設定要抓取的目標分類與對應的 Select Name
const TARGET_CATEGORIES = {
    'n11': '11. 開放式水冷',
    'n14': '14. CASE機殼(+電源供應器)',
    'n15': '15. 電源供應器'
};

const DB_FILE = path.join(__dirname, 'coolpc_db.json');

// 自動更新間隔 (毫秒)，預設 5 分鐘；可用環境變數 POLL_INTERVAL_MS 覆寫。
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS) || 5 * 60 * 1000;

async function fetchCoolPC() {
    console.log('🔄 正在抓取原價屋線上估價系統資料...');
    const response = await axios.get('https://www.coolpc.com.tw/evaluate.php', {
        responseType: 'arraybuffer',
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        timeout: 15000
    });

    // 原價屋網頁為 Big5 編碼，需轉換為 UTF-8
    return iconv.decode(response.data, 'big5');
}

function parseData(html) {
    const $ = cheerio.load(html);
    const currentData = {};

    for (const [selectName, categoryName] of Object.entries(TARGET_CATEGORIES)) {
        // 抓取指定的 <select> 標籤底下的所有 <option>
        $(`select[name="${selectName}"] option`).each((i, el) => {
            const id = $(el).val();
            const text = $(el).text().trim();

            // 略過預設選項 (value="0") 與空行
            if (id === '0' || !text) return;

            // 萃取價格：原價屋常見「原價$X ↘ $Y」或「...$X, $Y」等促銷標記，
            // 第一個 $ 金額往往是「原價」而非實際售價，真正的成交價一定是
            // 文字中最後一個 $ 金額，因此要取最後一筆而非第一筆比對結果。
            const priceMatches = [...text.matchAll(/\$(\d+)/g)];
            const price = priceMatches.length
                ? parseInt(priceMatches[priceMatches.length - 1][1], 10)
                : 0;

            // 萃取名稱：先去除「▼下殺到 ...」倒數促銷標語，再取逗號前的品名本體，
            // 避免促銷文字混入商品名稱。
            const name = text.split('▼')[0].split(',')[0].trim();

            // 判斷狀態與促銷 (依據原價屋常用的符號標記)
            const isNew = text.includes('新');
            const hasPromo = text.includes('★') || text.includes('◆') || text.includes('熱賣') || text.includes('送');

            // 同一個 value 編號會在不同 <select>（不同分類）中重複使用，
            // 例如 n14 與 n15 的 value=2、3、4... 是完全不同的商品。
            // 若只用 id 當 key，不同分類的商品會互相覆蓋、導致大量商品從資料庫消失，
            // 因此 key 必須加上 selectName 做分類命名空間。
            const key = `${selectName}_${id}`;

            currentData[key] = {
                id,
                selectName,
                category: categoryName,
                name,
                price,
                isNew,
                hasPromo,
                rawText: text
            };
        });
    }
    return currentData;
}

function compareData(oldData, currentData) {
    const reports = {
        newItems: [],
        priceChanges: [],
        promotions: []
    };

    for (const [key, currentItem] of Object.entries(currentData)) {
        const oldItem = oldData[key];

        // 1. 檢查是否為「新增品項」
        if (!oldItem) {
            reports.newItems.push(currentItem);
        } else {
            // 2. 檢查是否為「價格異動」
            if (oldItem.price !== currentItem.price) {
                const diff = currentItem.price - oldItem.price;
                reports.priceChanges.push({
                    ...currentItem,
                    oldPrice: oldItem.price,
                    diff: diff
                });
            }
        }

        // 3. 收集「活動促銷」品項 (這裡過濾出目前有促銷標記的商品)
        // 若只要"新增"的促銷，可改為: if (!oldItem?.hasPromo && currentItem.hasPromo)
        if (currentItem.hasPromo) {
            reports.promotions.push(currentItem);
        }
    }

    return reports;
}

async function run() {
    let html;
    try {
        html = await fetchCoolPC();
    } catch (error) {
        // 自動更新模式下，單次網路失敗不該中斷整個排程；記錄錯誤並等待下一輪重試。
        console.error('❌ 抓取失敗，將於下次排程重試:', error.message);
        return;
    }

    const currentData = parseData(html);

    let oldData = {};
    if (fs.existsSync(DB_FILE)) {
        oldData = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    } else {
        console.log('⚠️ 找不到歷史紀錄，本次執行將建立基礎資料庫 (不會產生異動報告)。\n');
    }

    const report = compareData(oldData, currentData);

    // ================= 輸出報表 =================
    console.log(`\n📊 【原價屋監控報告】 統計時間: ${new Date().toLocaleString()}\n`);

    if (Object.keys(oldData).length > 0) {
        // 輸出新增品項
        console.log(`🟢 【新增品項】 共 ${report.newItems.length} 件`);
        report.newItems.forEach(item => {
            console.log(`  [${item.category}] ${item.name} - 💰 $${item.price}`);
        });

        // 輸出價格異動
        console.log(`\n🔴 【價格異動】 共 ${report.priceChanges.length} 件`);
        report.priceChanges.forEach(item => {
            const trend = item.diff > 0 ? '🔺上漲' : '🔻降價';
            console.log(`  [${item.category}] ${item.name}`);
            console.log(`    ➔ 舊價: $${item.oldPrice} | 新價: $${item.price} (${trend} $${Math.abs(item.diff)})`);
        });
    }

    // 輸出活動促銷 (擷取前 10 筆作為範例，避免畫面過長)
    console.log(`\n🎁 【活動促銷總覽】 (目前共有 ${report.promotions.length} 件商品進行促銷)`);
    report.promotions.slice(0, 10).forEach(item => {
        console.log(`  [${item.category}] ${item.rawText}`);
    });
    if (report.promotions.length > 10) console.log(`  ... (隱藏其他 ${report.promotions.length - 10} 件)`);

    // ================= 儲存最新狀態 =================
    fs.writeFileSync(DB_FILE, JSON.stringify(currentData, null, 2));
    console.log(`\n✅ 資料庫已更新，共儲存 ${Object.keys(currentData).length} 筆商品狀態。`);
}

// ================= 自動更新迴圈 =================
// 避免上一輪還沒跑完（例如網路很慢）時，下一個 setInterval 又觸發新的一輪重疊執行。
let isRunning = false;

async function tick() {
    if (isRunning) {
        console.log('⏭ 上一輪尚未完成，跳過本次排程。');
        return;
    }
    isRunning = true;
    console.log('='.repeat(60));
    try {
        await run();
    } finally {
        isRunning = false;
    }
    const nextRun = new Date(Date.now() + POLL_INTERVAL_MS);
    console.log(`⏳ 下次自動更新時間：${nextRun.toLocaleString()}（每 ${Math.round(POLL_INTERVAL_MS / 60000)} 分鐘一次，Ctrl+C 結束）`);
}

console.log(`🚀 CoolPC CLI 監控工具啟動，每 ${Math.round(POLL_INTERVAL_MS / 60000)} 分鐘自動更新一次。`);
tick();
setInterval(tick, POLL_INTERVAL_MS);
