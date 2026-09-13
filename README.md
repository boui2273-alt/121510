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
`schools_115_calendar.db`，並載入附件提供的示範學校資料。

## 雲端部署準備

執行以下指令會檢查並補齊 `requirements.txt`、`.gitignore` 與 `Procfile`，不會覆寫既有 README，也不會自動執行 `git push`：

```powershell
python prepare_deployment.py
```

`Procfile` 使用 Gunicorn 啟動 `school_web_dashboard:app`，並讀取雲端平台提供的 `$PORT`。

輸出檔案會放在 `output/`：

- `115學年度新北桃園國小活動日程表.csv`
- `115學年度新北桃園國小活動日程表.xlsx`

目前「學生人數」與「預訂日期」保留空白，之後可以在
`build_school_roster()` 的資料來源改成爬蟲或教育統計 API。