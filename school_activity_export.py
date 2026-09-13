from pathlib import Path

import pandas as pd


OUTPUT_DIR = Path(__file__).resolve().parent / "output"
CSV_FILENAME = "115學年度新北桃園國小活動日程表.csv"
EXCEL_FILENAME = "115學年度新北桃園國小活動日程表.xlsx"

REQUIRED_COLUMNS = [
    "縣市",
    "行政區",
    "學校代碼",
    "學校名稱",
    "學生人數",
    "活動名稱",
    "預訂日期",
    "活動網址",
]


def build_school_roster() -> pd.DataFrame:
    """建立名冊骨幹，後續可將爬蟲或統計資料填入空白欄位。"""
    schools_template = [
        {
            "縣市": "新北市",
            "行政區": "板橋區",
            "學校代碼": "014601",
            "學校名稱": "新北市板橋區板橋國民小學",
            "學生人數": "",
            "活動名稱": "校慶運動會",
            "預訂日期": "",
            "活動網址": "https://...",
        },
        {
            "縣市": "桃園市",
            "行政區": "桃園區",
            "學校代碼": "034601",
            "學校名稱": "桃園市桃園區桃園國民小學",
            "學生人數": "",
            "活動名稱": "校慶運動大會",
            "預訂日期": "",
            "活動網址": "https://...",
        },
    ]

    roster = pd.DataFrame(schools_template, columns=REQUIRED_COLUMNS)
    if roster["學校代碼"].duplicated().any():
        raise ValueError("學校代碼不可重複")
    return roster


def export_school_roster() -> tuple[Path, Path]:
    roster = build_school_roster()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    csv_path = OUTPUT_DIR / CSV_FILENAME
    excel_path = OUTPUT_DIR / EXCEL_FILENAME
    roster.to_csv(csv_path, index=False, encoding="utf-8-sig")
    roster.to_excel(excel_path, index=False, engine="openpyxl")
    return csv_path, excel_path


if __name__ == "__main__":
    csv_file, excel_file = export_school_roster()
    print(f"基礎表單已成功匯出：{csv_file}")
    print(f"Excel 檔案已成功匯出：{excel_file}")