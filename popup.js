// popup.js
let cachedData = null;

function fmt(n) {
  if (n === -1 || n == null) return "—";
  return n >= 10000 ? `${(n / 10000).toFixed(1)}万` : n.toLocaleString();
}

function fmtYen(n) {
  if (n == null) return "—";
  return `¥${n.toLocaleString()}`;
}

function timeAgo(ts) {
  if (!ts) return "—";
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1)  return "たった今";
  if (m < 60) return `${m}分前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}時間前`;
  return `${Math.floor(h / 24)}日前`;
}

function renderData(data) {
  if (!data) return;
  cachedData = data;

  const arts      = data.articles ?? [];
  const creator   = data.creator  ?? {};
  const hasSales  = Array.isArray(data.sales?.purchases);
  const purchases = hasSales ? data.sales.purchases : [];

  // ── 今月の売上・購入件数 ──────────────────────────────────
  const now       = new Date();
  const thisYear  = now.getFullYear();
  const thisMonth = now.getMonth();

  const thisMonthBuys = purchases.filter(p => {
    if (p.is_refund) return false;
    const d = new Date(p.purchased_at ?? p.created_at ?? "");
    return !isNaN(d) && d.getFullYear() === thisYear && d.getMonth() === thisMonth;
  });
  const monthSales = thisMonthBuys.reduce((s, p) => s + (p.price ?? 0), 0);
  const monthCount = thisMonthBuys.length;

  // ── 直近3ヶ月の月別売上（棒グラフ用） ────────────────────
  const monthKeys   = [];
  const monthLabels = [];
  for (let i = 2; i >= 0; i--) {
    const d = new Date(thisYear, thisMonth - i, 1);
    const key = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthKeys.push(key);
    monthLabels.push(`${d.getMonth() + 1}月`);
  }
  const monthValues = monthKeys.map(() => 0);
  for (const p of purchases) {
    if (p.is_refund) continue;
    const d = new Date(p.purchased_at ?? p.created_at ?? "");
    if (isNaN(d)) continue;
    const key = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}`;
    const idx = monthKeys.indexOf(key);
    if (idx >= 0) monthValues[idx] += p.price ?? 0;
  }

  // ── 記事統計 ─────────────────────────────────────────────
  const totalLikes = arts.reduce((s, a) => s + (a.likeCount  ?? 0), 0);
  const totalViews = arts.filter(a => a.readCount >= 0).reduce((s, a) => s + a.readCount, 0);
  const hasViews   = arts.some(a => a.readCount >= 0);
  const engRate    = hasViews && totalViews > 0
    ? ((totalLikes / totalViews) * 100).toFixed(1) + "%"
    : "—";

  // ── DOM更新 ───────────────────────────────────────────────
  document.getElementById("updatedAt").textContent = timeAgo(data.updatedAt);

  // Sales hero
  document.getElementById("sSales").textContent      = hasSales ? fmtYen(monthSales)    : "—";
  document.getElementById("sSalesSub").textContent   = hasSales ? `購入${monthCount}件` : "";
  document.getElementById("sPurchases").textContent  = hasSales ? monthCount             : "—";
  document.getElementById("sPurchasesSub").textContent = hasSales ? "件 今月"           : "";
  document.getElementById("salesNoData").style.display = hasSales ? "none" : "block";

  // 4 KPI
  document.getElementById("kFollowers").textContent = fmt(creator.followerCount ?? -1);
  document.getElementById("kViews").textContent     = hasViews ? fmt(totalViews) : "—";
  document.getElementById("kLikes").textContent     = fmt(totalLikes);
  document.getElementById("kEng").textContent       = engRate;

  // Login banner（閲覧数未取得時）
  document.getElementById("loginBanner").style.display = hasViews ? "none" : "block";

  // Mini bar chart（月別売上）
  const ctx = document.getElementById("miniChart").getContext("2d");
  drawMiniBarChart(ctx, monthLabels, monthValues, hasSales);

  document.getElementById("loading").style.display = "none";
  document.getElementById("main").style.display    = "block";
}

function drawMiniBarChart(ctx, labels, values, hasSales) {
  const W = 294, H = 72;
  ctx.canvas.width  = W;
  ctx.canvas.height = H;
  ctx.clearRect(0, 0, W, H);

  if (!hasSales) {
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("売上データなし（ログインが必要です）", W / 2, H / 2 + 4);
    return;
  }

  const max  = Math.max(...values, 1);
  const pad  = { l: 10, r: 10, t: 14, b: 18 };
  const iW   = W - pad.l - pad.r;
  const iH   = H - pad.t - pad.b;
  const n    = values.length;
  const gap  = iW / n;
  const barW = gap * 0.55;

  for (let i = 0; i < n; i++) {
    const x  = pad.l + i * gap + (gap - barW) / 2;
    const bH = Math.max((values[i] / max) * iH, values[i] > 0 ? 2 : 0);
    const y  = pad.t + iH - bH;

    // bar
    ctx.fillStyle = i === n - 1 ? "#6366f1" : "#c7d2fe";
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(x, y, barW, bH, [3, 3, 0, 0]);
      ctx.fill();
    } else {
      ctx.fillRect(x, y, barW, bH);
    }

    // month label
    ctx.fillStyle = "#94a3b8";
    ctx.font = "9px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(labels[i], pad.l + i * gap + gap / 2, H - 4);

    // value label
    if (values[i] > 0) {
      ctx.fillStyle = i === n - 1 ? "#4f46e5" : "#64748b";
      ctx.font = "bold 9px sans-serif";
      const valStr = values[i] >= 10000
        ? `¥${(values[i] / 10000).toFixed(1)}万`
        : `¥${values[i].toLocaleString()}`;
      ctx.fillText(valStr, pad.l + i * gap + gap / 2, y - 3);
    }
  }
}

// ─── 起動 ─────────────────────────────────────────────────────
const CACHE_KEY = "note_stats_v1";

async function loadCache() {
  const r = await chrome.storage.local.get(CACHE_KEY);
  return r[CACHE_KEY] ?? null;
}

function triggerRefresh() {
  return new Promise(resolve => {
    const timer = setTimeout(() => loadCache().then(resolve), 5000);
    try {
      chrome.runtime.sendMessage({ type: "REFRESH" }, async res => {
        clearTimeout(timer);
        if (chrome.runtime.lastError || !res?.data) {
          await new Promise(r => setTimeout(r, 3000));
          resolve(await loadCache());
        } else {
          resolve(res.data);
        }
      });
    } catch {
      clearTimeout(timer);
      setTimeout(() => loadCache().then(resolve), 3000);
    }
  });
}

(async () => {
  const data = await loadCache();
  if (data) {
    renderData(data);
    return;
  }
  document.getElementById("loading").textContent = "データ取得中... (初回は1〜2分かかります)";
  const data2 = await triggerRefresh();
  if (data2) {
    renderData(data2);
  } else {
    document.getElementById("loading").style.display = "none";
    document.getElementById("errorBox").style.display = "block";
    document.getElementById("errorBox").textContent =
      "取得失敗。note.com にログインして「↻ 更新」を押してください。";
  }
})();

document.getElementById("refreshBtn").addEventListener("click", async () => {
  document.getElementById("main").style.display    = "none";
  document.getElementById("errorBox").style.display = "none";
  document.getElementById("loading").style.display = "block";
  document.getElementById("loading").textContent   = "更新中...";
  const data = await triggerRefresh();
  if (data) {
    renderData(data);
  } else {
    document.getElementById("loading").style.display = "none";
    document.getElementById("errorBox").style.display = "block";
    document.getElementById("errorBox").textContent =
      "取得失敗。note.com にログインして再試行してください。";
    if (cachedData) renderData(cachedData);
  }
});

document.getElementById("openDash").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
});

document.getElementById("loginBtn")?.addEventListener("click", () => {
  chrome.tabs.create({ url: "https://note.com/login" });
});
