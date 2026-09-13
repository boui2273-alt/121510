#!/usr/bin/env python3
"""準備 GitHub 與雲端部署所需的專案檔案。"""

from pathlib import Path


PROJECT_DIR = Path(__file__).resolve().parent

REQUIRED_DEPENDENCIES = [
    "Flask>=3.0",
    "gunicorn>=21.2",
    "pandas>=2.0",
    "openpyxl>=3.1",
]

GITIGNORE_ENTRIES = [
    "__pycache__/",
    "*.py[cod]",
    ".venv/",
    "venv/",
    "env/",
    ".env",
    "*.log",
    "schools_115_calendar.db",
    "output/*",
    "!output/.gitkeep",
]

PROCFILE_CONTENT = "web: gunicorn --bind 0.0.0.0:$PORT school_web_dashboard:app\n"


def merge_lines(path: Path, required_lines: list[str]) -> bool:
    existing = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    merged = existing[:]
    changed = False
    for line in required_lines:
        if line not in merged:
            merged.append(line)
            changed = True
    if changed:
        path.write_text("\n".join(merged) + "\n", encoding="utf-8")
    return changed


def main() -> None:
    requirements_path = PROJECT_DIR / "requirements.txt"
    gitignore_path = PROJECT_DIR / ".gitignore"
    procfile_path = PROJECT_DIR / "Procfile"

    requirements_changed = merge_lines(requirements_path, REQUIRED_DEPENDENCIES)
    gitignore_changed = merge_lines(gitignore_path, GITIGNORE_ENTRIES)

    if procfile_path.exists() and procfile_path.read_text(encoding="utf-8") != PROCFILE_CONTENT:
        print("⚠️ Procfile 已存在，未覆寫：請確認啟動指令是否使用 school_web_dashboard:app")
    else:
        procfile_path.write_text(PROCFILE_CONTENT, encoding="utf-8")
        print("✅ 已準備 Procfile")

    print(f"{'✅' if requirements_changed else 'ℹ️'} requirements.txt {'已更新' if requirements_changed else '無需更新'}")
    print(f"{'✅' if gitignore_changed else 'ℹ️'} .gitignore {'已更新' if gitignore_changed else '無需更新'}")
    print("完成。此腳本只準備部署檔案，不會執行 git push 或上傳任何憑證。")


if __name__ == "__main__":
    main()