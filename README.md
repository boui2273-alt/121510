# 校園活動名冊與 Web 排程系統

專案包含兩個工具：

- `school_activity_export.py`：建立名冊骨幹並輸出 CSV/Excel。
- `school_web_dashboard.py`：提供新北市與桃園市公立國小校慶／運動會的 Web 搜尋、勾選與匯出介面。

## 安裝與執行

```powershell
python -m pip install -r requirements.txt
python school_activity_export.py
```

啟動 Web 系統：

```powershell
python school_web_dashboard.py
```

接著開啟 <http://127.0.0.1:5000>。第一次啟動會在專案根目錄建立
`schools_115_calendar.db`，只載入學校名冊與官網來源；日期、學生人數與班級數要按「重新整理抓取系統」後才會從各校官網更新。

## 雲端部署準備

執行以下指令會檢查並補齊 `requirements.txt`、`.gitignore` 與 `Procfile`，不會覆寫既有 README，也不會自動執行 `git push`：

```powershell
python prepare_deployment.py
```

`Procfile` 使用 Gunicorn 啟動 `school_web_dashboard:app`，並讀取雲端平台提供的 `$PORT`。

## 分享給同事使用

本專案已加入 `render.yaml`，可用 Render 建立公開 HTTPS 網址：

1. 登入 <https://render.com>，選擇 **New > Blueprint**。
2. 連結 GitHub repository `boui2273-alt/121510`。
3. 選擇 repository 的 `render.yaml`，按 **Apply**。
4. 部署完成後，將 Render 顯示的 `https://...onrender.com` 網址分享給同事。

免費服務閒置後可能休眠，第一次開啟需要等待幾十秒。SQLite 資料庫會在服務環境中建立示範資料；若要長期保存同事更新的資料，應改用雲端資料庫或掛載持久磁碟。

輸出檔案會放在 `output/`：

- `115學年度新北桃園國小活動日程表.csv`
- `115學年度新北桃園國小活動日程表.xlsx`

目前「學生人數」與「預訂日期」保留空白，之後可以在
`build_school_roster()` 的資料來源改成爬蟲或教育統計 API。

## 真爬蟲資料來源

- 校慶／運動會日期：各校 `homepage_url` 的公開頁面文字，搜尋校慶、運動會、體育表演會等關鍵字與 2026/08 至 2027/01 日期。
- 學生人數與班級數：同一官網頁面中符合「學生人數／學生總數／班級數」格式的公開文字。
- 每筆 API 資料會保留 `event_source_url`、`student_source_url` 與 `crawl_status`，方便追溯來源。

若學校官網沒有直接公開統計數字，系統會顯示「未取得」，不會用估算值補上；這類學校需要另接教育局統計 API 或指定學校統計頁面。