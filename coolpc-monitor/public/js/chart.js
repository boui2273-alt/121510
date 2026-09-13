// 價格歷史折線圖，使用 CDN 載入的 Chart.js (index.html 已引入全域 `Chart`)。

let chartInstance = null;

function timeLabel(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString("zh-Hant", { hour: "2-digit", minute: "2-digit" });
}

/** 以最新的歷史資料重繪圖表；同一個 canvas 上重複呼叫會自動汰換舊圖表實例。 */
export function renderChart(canvasEl, categoryName, historyPoints) {
  if (typeof Chart === "undefined") return; // Chart.js CDN 尚未載入或載入失敗

  const labels = historyPoints.map((p) => timeLabel(p.t));
  const data = historyPoints.map((p) => p.avg);

  if (chartInstance) {
    chartInstance.data.labels = labels;
    chartInstance.data.datasets[0].data = data;
    chartInstance.data.datasets[0].label = `${categoryName} 平均價格`;
    chartInstance.update();
    return chartInstance;
  }

  chartInstance = new Chart(canvasEl, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: `${categoryName} 平均價格`,
          data,
          borderColor: "#e07a3f",
          backgroundColor: "rgba(224, 122, 63, 0.15)",
          tension: 0.25,
          fill: true,
          pointRadius: 2,
        },
      ],
    },
    options: {
      responsive: true,
      animation: false,
      scales: {
        y: { beginAtZero: false, ticks: { callback: (v) => `NT$${v}` } },
      },
      plugins: {
        legend: { display: true },
      },
    },
  });
  return chartInstance;
}

export function renderProductChart(canvasEl, productName, historyPoints) {
  const points = historyPoints || [];
  const chart = renderChart(canvasEl, productName || "請選擇品項", points.map((p) => ({ t: p.t, avg: p.price })));
  if (chart) {
    chart.data.datasets[0].label = productName ? `${productName} 價格` : "請選擇品項";
    chart.update();
  }
  return chart;
}
