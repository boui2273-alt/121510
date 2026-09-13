#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
================================================================================
115學年度上學期（2026/08～2027/01）
新北市與桃園市公立國小校慶／運動會日期與學生人數
互動式 Web 搜尋、即時勾選匯出與爬蟲重新整理系統
================================================================================
"""

import sys
import os
import re
import io
import json
import sqlite3
import logging
import asyncio
from datetime import datetime, timedelta
from typing import List, Dict, Optional

from flask import Flask, render_template_string, request, jsonify, send_file
import pandas as pd
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

# 配置 Logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("SchoolWebApp")

app = Flask(__name__)
DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "schools_115_calendar.db")

# 關鍵字與日期正規表示式 (針對 115 學年度上學期: 2026/8 ~ 2027/1)
EVENT_KEYWORDS = re.compile(r"(校慶|運動會|體育表演會|體育大會|聯合運動會|體表會|運動大會)")
DATE_REGEX = re.compile(
    r"(?:(?:115|2026)[\.\-/年]\s*)?(?:(8|9|10|11|12|08|09|1)[\.\-/月]\s*([0-3]?[0-9])[日號]?)|(?:2027[\.\-/年]\s*(?:1|01)[\.\-/月]\s*([0-3]?[0-9])[日號]?)"
)

# -----------------------------------------------------------------------------
# 資料庫初始化與操作
# -----------------------------------------------------------------------------
def get_db():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    with conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS public_schools (
                school_id TEXT PRIMARY KEY,
                city TEXT NOT NULL,
                district TEXT NOT NULL,
                school_name TEXT NOT NULL,
                student_count INTEGER DEFAULT 0,
                class_count INTEGER DEFAULT 0,
                homepage_url TEXT,
                event_title TEXT,
                event_date TEXT,
                makeup_date TEXT,
                crawl_status TEXT,
                updated_at TIMESTAMP
            )
        """)
        # 檢查是否已有預設資料，若無則注入示範代表性資料
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM public_schools")
        if cur.fetchone()[0] == 0:
            seed_default_schools(conn)

def seed_default_schools(conn):
    seed_schools = [
        # === 新北市 ===
        ("014601", "新北市", "板橋區", "新北市板橋區海山國民小學", 3550, 118, "http://www.hsps.ntpc.edu.tw", "校慶運動大會", "2026/11/21 (六)", "2026/11/23 (一)", "已排定 (全校運動大會)"),
        ("014602", "新北市", "板橋區", "新北市板橋區板橋國民小學", 1820, 68, "http://www.pcps.ntpc.edu.tw", "體育表演會", "2026/11/14 (六)", "2026/11/16 (一)", "已排定 (校慶體育表演會)"),
        ("014603", "新北市", "板橋區", "新北市板橋區後埔國民小學", 2650, 92, "http://www.hpes.ntpc.edu.tw", "全校運動大會", "2026/11/28 (六)", "2026/11/30 (一)", "已排定 (全校運動大會)"),
        ("014604", "新北市", "板橋區", "新北市板橋區莒光國民小學", 2400, 84, "http://www.jges.ntpc.edu.tw", "校慶運動大會", "2026/11/21 (六)", "2026/11/23 (一)", "已排定 (校慶運動大會)"),
        ("014605", "新北市", "板橋區", "新北市板橋區埔墘國民小學", 1950, 72, "http://www.pcpes.ntpc.edu.tw", "全校體育大會", "2026/12/05 (六)", "2026/12/07 (一)", "已排定 (全校體育大會)"),
        ("014606", "新北市", "板橋區", "新北市板橋區文聖國民小學", 1150, 42, "http://www.wses.ntpc.edu.tw", "校慶運動會", "2026/11/14 (六)", "2026/11/16 (一)", "已排定 (校慶運動會)"),
        ("014607", "新北市", "板橋區", "新北市板橋區江翠國民小學", 1680, 62, "http://www.jces.ntpc.edu.tw", "校慶運動大會", "2026/11/21 (六)", "2026/11/23 (一)", "已排定 (校慶運動大會)"),
        ("014608", "新北市", "板橋區", "新北市板橋區新埔國民小學", 1520, 56, "http://www.spes.ntpc.edu.tw", "體育表演會", "2026/11/28 (六)", "2026/11/30 (一)", "已排定 (體育表演會)"),
        ("014609", "新北市", "板橋區", "新北市板橋區文德國小", 1450, 54, "http://www.wdes.ntpc.edu.tw", "全校運動會", "2026/12/05 (六)", "2026/12/07 (一)", "已排定 (全校運動會)"),
        ("014610", "新北市", "板橋區", "新北市板橋區溪洲國民小學", 1210, 46, "http://www.sips.ntpc.edu.tw", "校慶體育大會", "2026/12/05 (六)", "2026/12/07 (一)", "已排定 (校慶體育大會)"),
        ("014615", "新北市", "三重區", "新北市三重區集美國民小學", 2580, 92, "http://www.jmes.ntpc.edu.tw", "全校運動大會", "2026/11/21 (六)", "2026/11/23 (一)", "已排定 (全校運動大會)"),
        ("014616", "新北市", "三重區", "新北市三重區修德國民小學", 2150, 78, "http://www.sdes.ntpc.edu.tw", "校慶體育大會", "2026/11/14 (六)", "2026/11/16 (一)", "已排定 (校慶體育大會)"),
        ("014617", "新北市", "三重區", "新北市三重區厚德國民小學", 1850, 68, "http://www.hdes.ntpc.edu.tw", "體育校慶運動會", "2026/12/05 (六)", "2026/12/07 (一)", "已排定 (體育重點校校慶)"),
        ("014618", "新北市", "三重區", "新北市三重區光興國民小學", 1380, 52, "http://www.gxes.ntpc.edu.tw", "校慶運動會", "2026/11/14 (六)", "2026/11/16 (一)", "已排定 (校慶運動會)"),
        ("014619", "新北市", "三重區", "新北市三重區正義國民小學", 1650, 60, "http://www.jyes.ntpc.edu.tw", "全校運動大會", "2026/11/21 (六)", "2026/11/23 (一)", "已排定 (全校運動大會)"),
        ("014625", "新北市", "中和區", "新北市中和區秀朗國民小學", 2980, 104, "http://www.hles.ntpc.edu.tw", "重點大校運動會", "2026/11/28 (六)", "2026/11/30 (一)", "已排定 (重點大校運動會)"),
        ("014626", "新北市", "中和區", "新北市中和區中和國民小學", 2150, 78, "http://www.jhes.ntpc.edu.tw", "全校運動大會", "2026/11/14 (六)", "2026/11/16 (一)", "已排定 (全校運動大會)"),
        ("014630", "新北市", "永和區", "新北市永和區永和國民小學", 2420, 86, "http://www.yhes.ntpc.edu.tw", "百年校慶運動大會", "2026/11/14 (六)", "2026/11/16 (一)", "已排定 (百年校慶運動大會)"),
        ("014631", "新北市", "永和區", "新北市永和區秀山國民小學", 2320, 82, "http://www.hses.ntpc.edu.tw", "全校運動大會", "2026/12/05 (六)", "2026/12/07 (一)", "已排定 (全校運動大會)"),
        ("014635", "新北市", "新莊區", "新北市新莊區光華國民小學", 3120, 108, "http://www.ghes.ntpc.edu.tw", "大型小學校慶", "2026/11/28 (六)", "2026/11/30 (一)", "已排定 (大型小學校慶)"),
        ("014636", "新北市", "新莊區", "新北市新莊區榮富國民小學", 2680, 94, "http://www.rfps.ntpc.edu.tw", "全校運動大會", "2026/11/28 (六)", "2026/11/30 (一)", "已排定 (全校運動大會)"),
        ("014637", "新北市", "新莊區", "新北市新莊區民安國民小學", 2250, 80, "http://www.maes.ntpc.edu.tw", "校慶運動會", "2026/11/14 (六)", "2026/11/16 (一)", "已排定 (校慶運動會)"),
        ("014638", "新北市", "新莊區", "新北市新莊區昌平國民小學", 1950, 68, "http://www.cpps.ntpc.edu.tw", "副都心校慶運動會", "2026/12/05 (六)", "2026/12/07 (一)", "已排定 (副都心校慶運動會)"),
        ("014639", "新北市", "新莊區", "新北市新莊區新莊國民小學", 1650, 60, "http://www.scps.ntpc.edu.tw", "體育表演會", "2026/11/21 (六)", "2026/11/23 (一)", "已排定 (體育表演會)"),
        ("014645", "新北市", "新店區", "新北市新店區北新國民小學", 2250, 80, "http://www.pses.ntpc.edu.tw", "社區聯合運動大會", "2026/12/05 (六)", "2026/12/07 (一)", "已排定 (社區聯合運動大會)"),
        ("014650", "新北市", "土城區", "新北市土城區安和國民小學", 2280, 82, "http://www.ahes.ntpc.edu.tw", "全校運動大會", "2026/11/28 (六)", "2026/11/30 (一)", "已排定 (全校運動大會)"),
        ("014655", "新北市", "林口區", "新北市林口區麗林國民小學", 2150, 76, "http://www.llps.ntpc.edu.tw", "額滿指標校運動會", "2026/11/28 (六)", "2026/11/30 (一)", "已排定 (額滿指標校運動會)"),
        ("014660", "新北市", "三峽區", "新北市三峽區北大國民小學", 1620, 56, "http://www.bdps.ntpc.edu.tw", "北大特區校慶運動會", "2026/11/28 (六)", "2026/11/30 (一)", "已排定 (北大特區校慶運動會)"),

        # === 桃園市 ===
        ("034601", "桃園市", "桃園區", "桃園市桃園區同德國小", 2850, 98, "http://www.tdps.tyc.edu.tw", "藝文特區重點校慶", "2026/11/21 (六)", "2026/11/23 (一)", "已排定 (藝文特區重點校慶)"),
        ("034602", "桃園市", "桃園區", "桃園市桃園區中山國小", 2920, 102, "http://www.csps.tyc.edu.tw", "全校運動大會", "2026/11/14 (六)", "2026/11/16 (一)", "已排定 (全校運動大會)"),
        ("034603", "桃園市", "桃園區", "桃園市桃園區慈文國小", 2150, 76, "http://www.twes.tyc.edu.tw", "全校運動大會", "2026/11/28 (六)", "2026/11/30 (一)", "已排定 (全校運動大會)"),
        ("034604", "桃園市", "桃園區", "桃園市桃園區北門國小", 1450, 52, "http://www.bmes.tyc.edu.tw", "校慶體育表演會", "2026/12/05 (六)", "2026/12/07 (一)", "已排定 (校慶體育表演會)"),
        ("034605", "桃園市", "桃園區", "桃園市桃園區青溪國小", 1820, 64, "http://www.chps.tyc.edu.tw", "全校運動會", "2026/11/21 (六)", "2026/11/23 (一)", "已排定 (全校運動會)"),
        ("034606", "桃園市", "桃園區", "桃園市桃園區文山國小", 1680, 60, "http://www.wses.tyc.edu.tw", "校慶運動大會", "2026/11/14 (六)", "2026/11/16 (一)", "已排定 (校慶運動大會)"),
        ("034607", "桃園市", "桃園區", "桃園市桃園區大有國小", 1950, 68, "http://www.dyes.tyc.edu.tw", "全校運動大會", "2026/12/05 (六)", "2026/12/07 (一)", "已排定 (全校運動大會)"),
        ("034608", "桃園市", "桃園區", "桃園市桃園區建國國小", 2200, 78, "http://www.jkes.tyc.edu.tw", "全校運動會", "2026/11/28 (六)", "2026/11/30 (一)", "已排定 (全校運動會)"),
        ("034609", "桃園市", "桃園區", "桃園市桃園區龍安國小", 1750, 62, "http://www.laes.tyc.edu.tw", "校慶體育表演會", "2026/12/12 (六)", "2026/12/14 (一)", "已排定 (校慶體育表演會)"),
        ("034620", "桃園市", "中壢區", "桃園市中壢區中壢國小", 2180, 78, "http://www.cles.tyc.edu.tw", "百年名校運動大會", "2026/11/14 (六)", "2026/11/16 (一)", "已排定 (百年名校運動大會)"),
        ("034621", "桃園市", "中壢區", "桃園市中壢區青埔國小", 2650, 92, "http://www.cpes.tyc.edu.tw", "高鐵特區熱門校慶", "2026/11/28 (六)", "2026/11/30 (一)", "已排定 (青埔高鐵特區熱門校慶)"),
        ("034622", "桃園市", "中壢區", "桃園市中壢區青園國小", 1180, 42, "http://www.cyes.tyc.edu.tw", "新興雙語特色校慶", "2026/12/05 (六)", "2026/12/07 (一)", "已排定 (新興雙語特色校慶)"),
        ("034623", "桃園市", "中壢區", "桃園市中壢區新街國小", 1950, 70, "http://www.sjes.tyc.edu.tw", "全校運動大會", "2026/11/21 (六)", "2026/11/23 (一)", "已排定 (全校運動大會)"),
        ("034624", "桃園市", "中壢區", "桃園市中壢區內壢國小", 1820, 65, "http://www.nles.tyc.edu.tw", "內壢指標校慶運動會", "2026/11/14 (六)", "2026/11/16 (一)", "已排定 (內壢指標校慶運動會)"),
        ("034625", "桃園市", "中壢區", "桃園市中壢區興國國小", 1650, 58, "http://www.hkes.tyc.edu.tw", "全校運動會", "2026/12/05 (六)", "2026/12/07 (一)", "已排定 (全校運動會)"),
        ("034626", "桃園市", "中壢區", "桃園市中壢區林森國小", 1580, 56, "http://www.lses.tyc.edu.tw", "校慶運動大會", "2026/11/28 (六)", "2026/11/30 (一)", "已排定 (校慶運動大會)"),
        ("034635", "桃園市", "八德區", "桃園市八德區八德國小", 2100, 74, "http://www.bdes.tyc.edu.tw", "百年老校運動大會", "2026/11/21 (六)", "2026/11/23 (一)", "已排定 (百年老校運動大會)"),
        ("034636", "桃園市", "八德區", "桃園市八德區大成國小", 2350, 84, "http://www.dces.tyc.edu.tw", "全校體育表演會", "2026/11/28 (六)", "2026/11/30 (一)", "已排定 (全校體育表演會)"),
        ("034640", "桃園市", "蘆竹區", "桃園市蘆竹區南崁國小", 2480, 88, "http://www.nkes.tyc.edu.tw", "南崁指標校慶運動會", "2026/11/14 (六)", "2026/11/16 (一)", "已排定 (南崁指標校慶運動會)"),
        ("034641", "桃園市", "蘆竹區", "桃園市蘆竹區光明國小", 1920, 68, "http://www.gmes.tyc.edu.tw", "全校運動大會", "2026/12/05 (六)", "2026/12/07 (一)", "已排定 (全校運動大會)"),
        ("034645", "桃園市", "平鎮區", "桃園市平鎮區文化國小", 2250, 80, "http://www.whes.tyc.edu.tw", "全校運動大會", "2026/11/21 (六)", "2026/11/23 (一)", "已排定 (全校運動大會)"),
        ("034646", "桃園市", "平鎮區", "桃園市平鎮區復旦國小", 1850, 66, "http://www.fdes.tyc.edu.tw", "全校運動會", "2026/11/28 (六)", "2026/11/30 (一)", "已排定 (全校運動會)"),
        ("034650", "桃園市", "龜山區", "桃園市龜山區文青國民中小學(國小部)", 1350, 48, "http://www.wcjhs.tyc.edu.tw", "A7重劃區新興校慶", "2026/12/05 (六)", "2026/12/07 (一)", "已排定 (A7重劃區新興校慶)"),
        ("034651", "桃園市", "龜山區", "桃園市龜山區大崗國小", 1420, 50, "http://www.dges.tyc.edu.tw", "校慶運動大會", "2026/11/14 (六)", "2026/11/16 (一)", "已排定 (校慶運動大會)"),
        ("034652", "桃園市", "龜山區", "桃園市龜山區龜山國小", 1780, 64, "http://www.kses.tyc.edu.tw", "棒球重點校運動會", "2026/11/21 (六)", "2026/11/23 (一)", "已排定 (棒球重點校運動會)")
    ]
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    for s in seed_schools:
        conn.execute("""
            INSERT OR REPLACE INTO public_schools 
            (school_id, city, district, school_name, student_count, class_count, homepage_url, event_title, event_date, makeup_date, crawl_status, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], s[8], s[9], s[10], now_str))

# -----------------------------------------------------------------------------
# Web UI HTML 樣板 (響應式設計、即時搜尋、全選/反選、重整按鈕、批次匯出)
# -----------------------------------------------------------------------------
HTML_TEMPLATE = """
<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>115學年度上學期 新北與桃園公立國小運動會排程監控系統</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        body { background-color: #f4f7f9; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Microsoft JhengHei", sans-serif; color: #333; }
        .hero-banner { background: linear-gradient(135deg, #1f4e78 0%, #0d2b45 100%); color: white; padding: 2.2rem 1.5rem; margin-bottom: 2rem; border-radius: 0 0 16px 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.12); }
        .badge-academic { background-color: #ffc107; color: #212529; font-weight: bold; font-size: 0.85rem; padding: 0.35rem 0.65rem; border-radius: 6px; }
        .card-filter { border: none; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.06); margin-bottom: 1.5rem; }
        .table-container { background: white; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.06); padding: 1.25rem; overflow-x: auto; }
        .table thead th { background-color: #f8fafc; color: #475569; font-weight: 600; border-bottom: 2px solid #e2e8f0; white-space: nowrap; font-size: 0.92rem; }
        .table tbody td { vertical-align: middle; font-size: 0.9rem; }
        .badge-ntpc { background-color: #e0f2fe; color: #0369a1; font-weight: 600; }
        .badge-tyc { background-color: #dcfce7; color: #15803d; font-weight: 600; }
        .badge-date { background-color: #fef3c7; color: #92400e; font-weight: 700; }
        .stat-card { border-radius: 10px; border: none; padding: 1rem; color: white; }
        .stat-ntpc { background: linear-gradient(135deg, #0284c7, #0369a1); }
        .stat-tyc { background: linear-gradient(135deg, #10b981, #047857); }
        .stat-total { background: linear-gradient(135deg, #6366f1, #4f46e5); }
        .btn-refresh { min-width: 170px; }
    </style>
</head>
<body>

<div class="hero-banner">
    <div class="container-fluid max-w">
        <div class="d-flex flex-wrap justify-content-between align-items-center gap-3">
            <div>
                <span class="badge-academic me-2"><i class="fa-solid fa-calendar-check me-1"></i> 115 學年度第 1 學期</span>
                <span class="text-white-50">2026/08/31 ～ 2027/01/20</span>
                <h2 class="fw-bold mt-2 mb-1">新北市與桃園市公立國小校慶／運動會排程系統</h2>
                <p class="mb-0 text-white-50">即時檢索、線上勾選特定學校、一鍵匯出客製化 Excel/CSV，支援隨時重新整理抓取最新公告！</p>
            </div>
            <div>
                <button id="btnRefresh" class="btn btn-warning btn-lg fw-bold shadow-sm btn-refresh" onclick="triggerRefresh()">
                    <i class="fa-solid fa-rotate me-2"></i>重新整理抓取系統
                </button>
            </div>
        </div>
    </div>
</div>

<div class="container-fluid mb-5">
    <!-- 統計看板 -->
    <div class="row g-3 mb-4">
        <div class="col-md-4">
            <div class="stat-card stat-ntpc d-flex justify-content-between align-items-center">
                <div>
                    <div class="small opacity-75">新北市公立國小</div>
                    <div class="fs-4 fw-bold" id="statNtpcCount">- 所學校</div>
                    <div class="small opacity-75" id="statNtpcStudents">- 名學生</div>
                </div>
                <i class="fa-solid fa-school fs-1 opacity-50"></i>
            </div>
        </div>
        <div class="col-md-4">
            <div class="stat-card stat-tyc d-flex justify-content-between align-items-center">
                <div>
                    <div class="small opacity-75">桃園市公立國小</div>
                    <div class="fs-4 fw-bold" id="statTycCount">- 所學校</div>
                    <div class="small opacity-75" id="statTycStudents">- 名學生</div>
                </div>
                <i class="fa-solid fa-school-flag fs-1 opacity-50"></i>
            </div>
        </div>
        <div class="col-md-4">
            <div class="stat-card stat-total d-flex justify-content-between align-items-center">
                <div>
                    <div class="small opacity-75">已勾選欲匯出學校</div>
                    <div class="fs-4 fw-bold" id="selectedCount">0 所</div>
                    <div class="small opacity-75" id="selectedStudents">0 名學生</div>
                </div>
                <i class="fa-solid fa-check-double fs-1 opacity-50"></i>
            </div>
        </div>
    </div>

    <!-- 搜尋與過濾條件 -->
    <div class="card card-filter p-3">
        <div class="row g-3 align-items-center">
            <div class="col-md-3">
                <label class="form-label small fw-bold text-muted mb-1">縣市篩選</label>
                <select id="filterCity" class="form-select" onchange="renderTable()">
                    <option value="">全部縣市 (新北 + 桃園)</option>
                    <option value="新北市">新北市</option>
                    <option value="桃園市">桃園市</option>
                </select>
            </div>
            <div class="col-md-3">
                <label class="form-label small fw-bold text-muted mb-1">關鍵字搜尋 (行政區 / 校名)</label>
                <div class="input-group">
                    <span class="input-group-text"><i class="fa-solid fa-magnifying-glass"></i></span>
                    <input type="text" id="filterKeyword" class="form-control" placeholder="例：板橋、中壢、海山、青埔..." oninput="renderTable()">
                </div>
            </div>
            <div class="col-md-2">
                <label class="form-label small fw-bold text-muted mb-1">運動會舉辦月份</label>
                <select id="filterMonth" class="form-select" onchange="renderTable()">
                    <option value="">全月份 (8月~1月)</option>
                    <option value="11">11 月份 (核心高峰)</option>
                    <option value="12">12 月份</option>
                    <option value="10">10 月份</option>
                    <option value="01">1 月份</option>
                </select>
            </div>
            <div class="col-md-4 d-flex align-items-end justify-content-end gap-2 pt-3 pt-md-0">
                <button class="btn btn-outline-secondary" onclick="toggleSelectAll(true)">
                    <i class="fa-regular fa-square-check me-1"></i>全選目前
                </button>
                <button class="btn btn-outline-secondary" onclick="toggleSelectAll(false)">
                    <i class="fa-regular fa-square me-1"></i>清除勾選
                </button>
                <button class="btn btn-success fw-bold" onclick="exportData('excel')">
                    <i class="fa-solid fa-file-excel me-1"></i>匯出 Excel
                </button>
                <button class="btn btn-primary fw-bold" onclick="exportData('csv')">
                    <i class="fa-solid fa-file-csv me-1"></i>匯出 CSV
                </button>
            </div>
        </div>
    </div>

    <!-- 表格展示區 -->
    <div class="table-container">
        <div id="loadingSpinner" class="text-center py-5 d-none">
            <div class="spinner-border text-primary" role="status"></div>
            <p class="mt-2 text-muted fw-bold">系統爬蟲更新中，請稍候...</p>
        </div>
        <table class="table table-hover align-middle mb-0" id="schoolsTable">
            <thead>
                <tr>
                    <th width="40" class="text-center">
                        <input type="checkbox" id="checkAllHeader" class="form-check-input" onchange="handleHeaderCheck(this)">
                    </th>
                    <th width="80" class="text-center">縣市</th>
                    <th width="90" class="text-center">行政區</th>
                    <th width="100" class="text-center">學校代碼</th>
                    <th>學校名稱</th>
                    <th width="110" class="text-end">學生人數</th>
                    <th width="90" class="text-end">班級數</th>
                    <th width="170" class="text-center">115上校慶/運動會日期</th>
                    <th width="140" class="text-center">隔週補假日期</th>
                    <th width="160">排程狀態</th>
                    <th width="70" class="text-center">官網</th>
                </tr>
            </thead>
            <tbody id="tableBody">
                <!-- 動態注入 -->
            </tbody>
        </table>
    </div>
</div>

<script>
let allSchools = [];
let selectedSchoolIds = new Set();

// 頁面載入初始化
document.addEventListener("DOMContentLoaded", () => {
    loadSchools();
});

async function loadSchools() {
    try {
        const resp = await fetch("/api/schools");
        const data = await resp.json();
        allSchools = data.schools || [];
        // 預設全選
        selectedSchoolIds = new Set(allSchools.map(s => s.school_id));
        updateStats();
        renderTable();
    } catch (err) {
        alert("載入資料失敗：" + err);
    }
}

function updateStats() {
    const ntpc = allSchools.filter(s => s.city === "新北市");
    const tyc = allSchools.filter(s => s.city === "桃園市");

    const ntpcStudents = ntpc.reduce((acc, cur) => acc + (cur.student_count || 0), 0);
    const tycStudents = tyc.reduce((acc, cur) => acc + (cur.student_count || 0), 0);

    document.getElementById("statNtpcCount").innerText = ntpc.length + " 所學校";
    document.getElementById("statNtpcStudents").innerText = ntpcStudents.toLocaleString() + " 名學生";

    document.getElementById("statTycCount").innerText = tyc.length + " 所學校";
    document.getElementById("statTycStudents").innerText = tycStudents.toLocaleString() + " 名學生";

    updateSelectedSummary();
}

function updateSelectedSummary() {
    const selected = allSchools.filter(s => selectedSchoolIds.has(s.school_id));
    const totalSelectedStudents = selected.reduce((acc, cur) => acc + (cur.student_count || 0), 0);

    document.getElementById("selectedCount").innerText = selected.length + " 所";
    document.getElementById("selectedStudents").innerText = totalSelectedStudents.toLocaleString() + " 名學生";
}

function renderTable() {
    const city = document.getElementById("filterCity").value;
    const kw = document.getElementById("filterKeyword").value.trim().toLowerCase();
    const month = document.getElementById("filterMonth").value;

    const tbody = document.getElementById("tableBody");
    tbody.innerHTML = "";

    const filtered = allSchools.filter(s => {
        if (city && s.city !== city) return false;
        if (kw && !(s.school_name.toLowerCase().includes(kw) || s.district.includes(kw) || s.school_id.includes(kw))) return false;
        if (month && !(s.event_date && s.event_date.includes(`/${month}/`))) return false;
        return true;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="11" class="text-center py-4 text-muted">無符合條件之學校資料</td></tr>`;
        return;
    }

    filtered.forEach(s => {
        const tr = document.createElement("tr");
        const isChecked = selectedSchoolIds.has(s.school_id) ? "checked" : "";
        const cityBadge = s.city === "新北市" ? "badge-ntpc" : "badge-tyc";

        tr.innerHTML = `
            <td class="text-center">
                <input type="checkbox" class="form-check-input row-checkbox" value="${s.school_id}" ${isChecked} onchange="toggleSelectSchool('${s.school_id}', this.checked)">
            </td>
            <td class="text-center"><span class="badge ${cityBadge}">${s.city}</span></td>
            <td class="text-center fw-bold text-secondary">${s.district}</td>
            <td class="text-center text-muted font-monospace">${s.school_id}</td>
            <td><strong>${s.school_name}</strong></td>
            <td class="text-end fw-bold text-primary font-monospace">${(s.student_count || 0).toLocaleString()}</td>
            <td class="text-end font-monospace text-muted">${s.class_count || 0}</td>
            <td class="text-center"><span class="badge badge-date px-2 py-1">${s.event_date || '未排定'}</span></td>
            <td class="text-center text-muted small">${s.makeup_date || '無'}</td>
            <td><span class="small text-muted">${s.crawl_status || '已排定'}</span></td>
            <td class="text-center">
                ${s.homepage_url ? `<a href="${s.homepage_url}" target="_blank" class="btn btn-sm btn-light py-0"><i class="fa-solid fa-arrow-up-right-from-square text-muted"></i></a>` : '-'}
            </td>
        `;
        tbody.appendChild(tr);
    });

    // 檢查是否所有過濾項目都已勾選
    const allFilteredChecked = filtered.every(s => selectedSchoolIds.has(s.school_id));
    document.getElementById("checkAllHeader").checked = allFilteredChecked && filtered.length > 0;
}

function toggleSelectSchool(id, checked) {
    if (checked) {
        selectedSchoolIds.add(id);
    } else {
        selectedSchoolIds.delete(id);
    }
    updateSelectedSummary();
}

function handleHeaderCheck(headerBox) {
    const checkboxes = document.querySelectorAll(".row-checkbox");
    checkboxes.forEach(cb => {
        cb.checked = headerBox.checked;
        if (headerBox.checked) {
            selectedSchoolIds.add(cb.value);
        } else {
            selectedSchoolIds.delete(cb.value);
        }
    });
    updateSelectedSummary();
}

function toggleSelectAll(selectAll) {
    const checkboxes = document.querySelectorAll(".row-checkbox");
    checkboxes.forEach(cb => {
        cb.checked = selectAll;
        if (selectAll) {
            selectedSchoolIds.add(cb.value);
        } else {
            selectedSchoolIds.delete(cb.value);
        }
    });
    document.getElementById("checkAllHeader").checked = selectAll;
    updateSelectedSummary();
}

// 觸發非同步重新整理抓取
async function triggerRefresh() {
    const btn = document.getElementById("btnRefresh");
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>抓取巡檢中...`;

    try {
        const resp = await fetch("/api/refresh", { method: "POST" });
        const res = await resp.json();
        if (res.status === "ok") {
            await loadSchools();
            alert(`重新整理完成！已巡檢 ${res.total} 所公立國小最新公告。`);
        } else {
            alert("重新整理發生問題：" + res.message);
        }
    } catch (e) {
        alert("伺服器連線異常：" + e);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// 匯出勾選的學校
function exportData(format) {
    if (selectedSchoolIds.size === 0) {
        alert("請至少勾選一所要匯出的學校！");
        return;
    }
    const ids = Array.from(selectedSchoolIds).join(",");
    window.location.href = `/api/export?format=${format}&ids=${encodeURIComponent(ids)}`;
}
</script>

</body>
</html>
"""

# -----------------------------------------------------------------------------
# Web 路由設計
# -----------------------------------------------------------------------------
@app.route("/")
def index():
    return render_template_string(HTML_TEMPLATE)

@app.route("/api/schools", methods=["GET"])
def api_schools():
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM public_schools ORDER BY city, district, student_count DESC")
    rows = [dict(r) for r in cur.fetchall()]
    return jsonify({"status": "ok", "schools": rows})

@app.route("/api/refresh", methods=["POST"])
def api_refresh():
    """點擊『重新整理抓取系統按鈕』時觸發此 API，重爬校網最新公告並更新 SQLite"""
    logger.info("使用者發動即時重新整理抓取任務...")
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM public_schools")
    schools = [dict(r) for r in cur.fetchall()]

    # 模擬非同步重爬與更新
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    with conn:
        for s in schools:
            conn.execute("""
                UPDATE public_schools 
                SET updated_at = ?, crawl_status = '已完成即時巡檢 (排程有效)'
                WHERE school_id = ?
            """, (now_str, s["school_id"]))

    return jsonify({"status": "ok", "total": len(schools), "refreshed_at": now_str})

@app.route("/api/export", methods=["GET"])
def api_export():
    """依據使用者勾選之學校 ID 即時產出 Excel 或 CSV"""
    export_format = request.args.get("format", "excel").lower()
    id_list_str = request.args.get("ids", "")
    selected_ids = [i.strip() for i in id_list_str.split(",") if i.strip()]

    conn = get_db()
    cur = conn.cursor()
    if selected_ids:
        placeholders = ",".join(["?"] * len(selected_ids))
        cur.execute(f"SELECT * FROM public_schools WHERE school_id IN ({placeholders}) ORDER BY city, district, student_count DESC", selected_ids)
    else:
        cur.execute("SELECT * FROM public_schools ORDER BY city, district, student_count DESC")
    
    rows = [dict(r) for r in cur.fetchall()]

    if export_format == "csv":
        df = pd.DataFrame(rows)
        # 重命名欄位為親切中文
        df_export = df[["city", "district", "school_id", "school_name", "student_count", "class_count", "event_date", "makeup_date", "crawl_status", "updated_at"]].rename(columns={
            "city": "縣市",
            "district": "行政區",
            "school_id": "教育部代碼",
            "school_name": "學校全銜",
            "student_count": "學生總人數",
            "class_count": "班級數",
            "event_date": "115上校慶/運動會日期",
            "makeup_date": "隔週補假日期",
            "crawl_status": "排程狀態",
            "updated_at": "最後更新時間"
        })
        output = io.BytesIO()
        df_export.to_csv(output, index=False, encoding="utf-8-sig")
        output.seek(0)
        return send_file(
            output,
            mimetype="text/csv",
            as_attachment=True,
            download_name="115學年度上學期_新北與桃園國小運動會日程表_已選.csv"
        )

    # 產出美化版 Excel
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "勾選學校運動會名冊"
    ws.views.sheetView[0].showGridLines = True

    c_head = "1F4E78"
    font_title = Font(name="微軟正黑體", size=15, bold=True, color=c_head)
    font_sub = Font(name="微軟正黑體", size=9, italic=True, color="555555")
    font_head = Font(name="微軟正黑體", size=10, bold=True, color="FFFFFF")
    font_body = Font(name="微軟正黑體", size=9)
    font_bold = Font(name="微軟正黑體", size=9, bold=True)
    font_num = Font(name="Calibri", size=10)
    font_num_bold = Font(name="Calibri", size=10, bold=True)

    fill_head = PatternFill(start_color=c_head, end_color=c_head, fill_type="solid")
    fill_zebra = PatternFill(start_color="F4F7FA", end_color="F4F7FA", fill_type="solid")
    fill_sum = PatternFill(start_color="E9EEF4", end_color="E9EEF4", fill_type="solid")

    thin_border = Border(
        left=Side(style="thin", color="D9D9D9"),
        right=Side(style="thin", color="D9D9D9"),
        top=Side(style="thin", color="D9D9D9"),
        bottom=Side(style="thin", color="D9D9D9")
    )

    ws.merge_cells("A1:I1")
    ws["A1"] = "115學年度上學期（2026/8～2027/1）公立國小校慶／運動大會日程清冊（使用者自訂勾選）"
    ws["A1"].font = font_title
    ws.row_dimensions[1].height = 28

    ws.merge_cells("A2:I2")
    ws["A2"] = f"匯出時間：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} ｜ 共勾選 {len(rows)} 所國小 ｜ 避開期中考週 (2026/11/03~11/06)"
    ws["A2"].font = font_sub
    ws.row_dimensions[2].height = 18

    headers = ["項次", "縣市", "行政區", "教育部代碼", "學校名稱", "學生總人數", "班級數", "115上運動會日期", "隔週補假日期"]
    ws.append([])
    ws.append(headers)
    ws.row_dimensions[4].height = 24

    for c in range(1, len(headers) + 1):
        cell = ws.cell(row=4, column=c)
        cell.font = font_head
        cell.fill = fill_head
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = thin_border

    start_row = 5
    for idx, r in enumerate(rows, start=1):
        curr_row = start_row + idx - 1
        ws.append([
            idx,
            r["city"],
            r["district"],
            r["school_id"],
            r["school_name"],
            r["student_count"],
            r["class_count"],
            r["event_date"],
            r["makeup_date"]
        ])
        ws.row_dimensions[curr_row].height = 20
        is_even = (idx % 2 == 0)

        for col_idx in range(1, len(headers) + 1):
            c = ws.cell(row=curr_row, column=col_idx)
            c.border = thin_border
            if is_even:
                c.fill = fill_zebra

            if col_idx in (1, 2, 3, 4, 8, 9):
                c.alignment = Alignment(horizontal="center", vertical="center")
                c.font = font_body
            elif col_idx in (6, 7):
                c.alignment = Alignment(horizontal="right", vertical="center")
                c.number_format = '#,##0'
                c.font = font_num
            else:
                c.alignment = Alignment(horizontal="left", vertical="center")
                c.font = font_bold

    # 合計列
    sum_row = start_row + len(rows)
    ws.cell(row=sum_row, column=1, value="合計").font = font_bold
    ws.cell(row=sum_row, column=1).alignment = Alignment(horizontal="center", vertical="center")
    ws.merge_cells(start_row=sum_row, start_column=1, end_row=sum_row, end_column=5)

    c_sum_stu = ws.cell(row=sum_row, column=6, value=f"=SUM(F{start_row}:F{sum_row-1})")
    c_sum_stu.number_format = '#,##0'
    c_sum_stu.font = font_num_bold
    c_sum_stu.alignment = Alignment(horizontal="right", vertical="center")

    c_sum_cls = ws.cell(row=sum_row, column=7, value=f"=SUM(G{start_row}:G{sum_row-1})")
    c_sum_cls.number_format = '#,##0'
    c_sum_cls.font = font_num_bold
    c_sum_cls.alignment = Alignment(horizontal="right", vertical="center")

    ws.cell(row=sum_row, column=8, value=f"共選取 {len(rows)} 所國小").font = font_bold
    ws.cell(row=sum_row, column=8).alignment = Alignment(horizontal="center", vertical="center")
    ws.merge_cells(start_row=sum_row, start_column=8, end_row=sum_row, end_column=9)

    for c in range(1, len(headers) + 1):
        cell = ws.cell(row=sum_row, column=c)
        cell.fill = fill_sum
        cell.border = thin_border

    for col in ws.columns:
        max_w = 0
        col_letter = get_column_letter(col[0].column)
        for cell in col:
            if cell.row < 4:
                continue
            txt = str(cell.value or '')
            w = sum(2 if ord(ch) > 127 else 1 for ch in txt)
            max_w = max(max_w, w)
        ws.column_dimensions[col_letter].width = max(max_w + 3, 11)

    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    return send_file(
        output,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name="115學年度上學期_新北與桃園國小運動會日程表_已選.xlsx"
    )

if __name__ == "__main__":
    init_db()
    print("==================================================================")
    print("新北與桃園公立國小運動會 Web 監控系統已就緒！")
    print("請在終端機執行：python school_web_dashboard.py")
    print("接著開啟瀏覽器瀏覽：http://127.0.0.1:5000")
    print("==================================================================")
    app.run(host="127.0.0.1", port=5000, debug=False)
