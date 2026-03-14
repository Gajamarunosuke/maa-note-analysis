// dashboard.js
Chart.defaults.font.family = "'Noto Sans JP','Hiragino Sans',sans-serif";
Chart.defaults.font.size = 11;

// ─── 定数 ───────────────────────────────────────────────────
const CAT_COLORS = {
  "市況夕刊":   "#3b82f6",
  "Lvシリーズ": "#f59e0b",
  "シリーズ物語":"#8b5cf6",
  "コーヒー":   "#f97316",
  "その他":     "#10b981",
};
const CAT_BG = {
  "市況夕刊":"c-market","Lvシリーズ":"c-lv",
  "シリーズ物語":"c-story","コーヒー":"c-coffee","その他":"c-other",
};
const MEDALS = ["🥇","🥈","🥉"];

// ─── 状態 ───────────────────────────────────────────────────
let currentCat        = "all";
let currentPaidFilter = "all"; // "all" | "paid" | "free"
let top10SortKey      = "likeCount";
let tableSortKey      = "date"; // "date" | "readCount" | "likeCount" | "commentCount" | "engRate"
let tableSortDir      = "desc"; // "asc" | "desc"
let currentPeriod     = 30;
let chartGran         = "day";
let paidSortKey       = "sales";
let salesGranularity  = "month";
let allArticles       = [];
let currentData       = null;
const charts          = {};

// ─── カテゴリ判定 ────────────────────────────────────────────
function categorize(title) {
  if (/杜のカエル|杜の投資家/.test(title)) return "市況夕刊";
  if (/Lv|🐶/.test(title))                  return "Lvシリーズ";
  if (/🐼|🐭|🐨|🐈|🐘/.test(title))        return "シリーズ物語";
  if (/☕|コーヒー/.test(title))             return "コーヒー";
  return "その他";
}

// ─── フォーマット ────────────────────────────────────────────
function fmt(n) {
  if (n == null || n < 0) return "—";
  return n >= 10000 ? `${(n / 10000).toFixed(1)}万` : n.toLocaleString();
}
function fmtYen(n) {
  if (n == null || n < 0) return "—";
  return `¥${n.toLocaleString()}`;
}
function fmtDate(s) {
  if (!s) return "";
  const d = new Date(s);
  return isNaN(d) ? s
    : `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}
function timeAgo(ts) {
  if (!ts) return "—";
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1)  return "たった今";
  if (m < 60) return `${m}分前`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}時間前` : `${Math.floor(h / 24)}日前`;
}
function pct(n) { return n == null || n < 0 ? "—" : n.toFixed(2) + "%"; }

// ─── 売上データ抽出ヘルパー ──────────────────────────────────
function extractSalesMonth(sales, year, month) {
  if (!sales?.summary) return null;
  const histories =
    sales.summary.sales_histories ??
    sales.summary.monthly_sales   ??
    sales.summary.histories       ?? [];
  return histories.find(h => h.year === year && h.month === month) ?? null;
}

function getSalesAmount(entry) {
  if (!entry) return 0;
  return entry.amount ?? entry.sales ?? entry.total ?? 0;
}

function getSalesCount(entry) {
  if (!entry) return 0;
  return entry.count ?? entry.purchase_count ?? entry.purchases ?? 0;
}

// ─── 売上セクション レンダリング ─────────────────────────────
async function renderSalesSection(sales) {
  const now      = new Date();
  const thisYear = now.getFullYear();
  const thisMonth = now.getMonth() + 1;
  const lastYear  = thisMonth === 1 ? thisYear - 1 : thisYear;
  const lastMonth = thisMonth === 1 ? 12 : thisMonth - 1;

  const lastMo = extractSalesMonth(sales, lastYear, lastMonth);
  const lastSales = getSalesAmount(lastMo);

  // 今月分は生データ(purchases)から集計（summaryはサーバー集計に遅延があるため）
  const rawPurchases = sales?.purchases ?? [];
  const thisMonthBuys = rawPurchases.filter(p => {
    if (p.is_refund) return false;
    const d = new Date(p.purchased_at ?? p.created_at ?? "");
    return !isNaN(d) && d.getFullYear() === thisYear && d.getMonth() + 1 === thisMonth;
  });
  const currentSales = thisMonthBuys.reduce((s, p) => s + (p.price ?? 0), 0);
  const purchases    = thisMonthBuys.length;

  // 月次目標
  const r = await chrome.storage.local.get("monthlyGoal");
  const goal = r.monthlyGoal || 0;

  if (!sales || sales.error) {
    const statusEl = document.getElementById("salesStatus");
    statusEl.style.display = "block";
    if (sales?.needsLogin) {
      statusEl.textContent = "⚠ 売上取得には「売上管理ページ」でのパスワード再確認が必要です";
      const btn = document.getElementById("salesVerifyBtn");
      if (btn) {
        btn.style.display = "inline-block";
        btn.onclick = () => chrome.tabs.create({ url: "https://note.com/sitesettings/salesmanage" });
      }
    } else if (sales?.error) {
      statusEl.textContent = `取得エラー: ${sales.error}`;
    }
    return;
  }

  // 今月売上
  document.getElementById("sCurrentSales").textContent    = fmtYen(currentSales);
  document.getElementById("sCurrentSalesSub").textContent = `${thisMonth}月実績`;

  // 先月比
  if (lastSales > 0) {
    const diff = currentSales - lastSales;
    const rate = (diff / lastSales * 100).toFixed(1);
    const sign = diff >= 0 ? "+" : "";
    const el   = document.getElementById("sMoM");
    el.textContent = `${sign}${rate}%`;
    el.className   = `sales-kpi-value ${diff >= 0 ? "" : ""}`;
    document.getElementById("sMoMSub").textContent  = `先月 ${fmtYen(lastSales)}`;
    document.getElementById("sMoMSub").className    = `sales-kpi-sub ${diff >= 0 ? "up" : "down"}`;
  } else {
    document.getElementById("sMoM").textContent    = "—";
    document.getElementById("sMoMSub").textContent = "先月データなし";
  }

  // 購入件数
  document.getElementById("sPurchaseCount").textContent = `${purchases}件`;
  document.getElementById("sPurchaseSub").textContent   =
    purchases > 0 && currentSales > 0
      ? `平均 ${fmtYen(Math.round(currentSales / purchases))}/件`
      : "";

  // 年間売上・購入件数（purchasers APIの生データから当年分を集計）
  const yearPurchases = (sales?.purchases ?? []).filter(p => {
    if (p.is_refund) return false;
    const d = new Date(p.purchased_at);
    return !isNaN(d) && d.getFullYear() === thisYear;
  });
  const yearlySales    = yearPurchases.reduce((s, p) => s + (p.price ?? 0), 0);
  const yearlyCount    = yearPurchases.length;
  document.getElementById("sYearlySales").textContent       = fmtYen(yearlySales);
  document.getElementById("sYearlySalesSub").textContent    = `${thisYear}年 累計`;
  document.getElementById("sYearlyPurchases").textContent   = `${yearlyCount}件`;
  document.getElementById("sYearlyPurchasesSub").textContent = yearlyCount > 0
    ? `平均 ${fmtYen(Math.round(yearlySales / yearlyCount))}/件` : "";

  // 目標達成率 + プログレスバー
  if (goal > 0) {
    const rate    = Math.min(currentSales / goal * 100, 150);
    const dispRate = (currentSales / goal * 100).toFixed(1);
    document.getElementById("sGoalRate").textContent    = `${dispRate}%`;
    document.getElementById("sGoalSub").textContent     = `目標 ${fmtYen(goal)}`;
    document.getElementById("sGoalSub").className       = `sales-kpi-sub ${currentSales >= goal ? "up" : "neutral"}`;
    document.getElementById("goalBarFill").style.width  = `${rate}%`;
    document.getElementById("goalBarFill").className    = `goal-bar-fill ${currentSales >= goal ? "over" : ""}`;
    document.getElementById("goalLabelLeft").textContent  = `${fmtYen(currentSales)} / ${fmtYen(goal)}`;
    document.getElementById("goalLabelRight").textContent = `${dispRate}%`;
  } else {
    document.getElementById("sGoalRate").textContent   = "未設定";
    document.getElementById("goalLabelLeft").textContent = "設定画面で月次目標を設定できます";
    document.getElementById("goalBarFill").style.width = "0%";
  }
}

// ─── ファネル レンダリング ────────────────────────────────────
async function renderFunnel(arts, sales) {
  const paidArts  = arts.filter(a => a.isPaid);
  const totalViews = arts.filter(a => a.readCount >= 0).reduce((s, a) => s + a.readCount, 0);
  const paidViews  = paidArts.filter(a => a.readCount >= 0).reduce((s, a) => s + a.readCount, 0);

  // 購入数・売上: 直近3ヶ月の累計（purchasers APIから集計済み）
  const purchases  = sales?.details?.reduce((s, d) => s + (d.count  ?? 0), 0) ?? 0;
  const totalSales = sales?.details?.reduce((s, d) => s + (d.sales  ?? 0), 0) ?? 0;

  document.getElementById("fTotalViews").textContent = fmt(totalViews);
  document.getElementById("fPaidViews").textContent  = paidViews > 0 ? fmt(paidViews) : "—";
  document.getElementById("fPaidViewsSub").textContent = `有料 ${paidArts.length}記事`;

  if (totalViews > 0 && paidViews > 0) {
    document.getElementById("fPaidViewRate").textContent = pct(paidViews / totalViews * 100);
  }

  document.getElementById("fPurchases").textContent = purchases > 0 ? `${purchases}件` : "—";
  if (paidViews > 0 && purchases > 0) {
    document.getElementById("fPurchaseRate").textContent = pct(purchases / paidViews * 100);
  }

  if (purchases > 0 && totalSales > 0) {
    document.getElementById("fAvgPrice").textContent    = fmtYen(Math.round(totalSales / purchases));
    document.getElementById("fAvgPriceSub").textContent = "平均単価";
  } else {
    document.getElementById("fAvgPrice").textContent = "—";
  }
}

// ─── 有料記事テーブル レンダリング ──────────────────────────
function renderPaidTable(arts, sales) {
  // 記事別売上詳細マップを作る
  const detailMap = {};
  for (const d of (sales?.details ?? [])) {
    if (d.key) detailMap[d.key] = d;
  }

  // 各有料記事にsales値を付与してからソート
  const paidArts = arts.filter(a => a.isPaid).map(a => {
    const detail = detailMap[a.id];
    const artSales = detail?.sales ?? detail?.amount ?? -1;
    const artPurchase = detail
      ? (detail.count ?? detail.purchase_count ?? null)
      : null;
    return {
      ...a,
      artSales,
      artPurchase,
    };
  });

  paidArts.sort((a, b) => {
    if (paidSortKey === "likeCount") return (b.likeCount  ?? 0) - (a.likeCount  ?? 0);
    if (paidSortKey === "sales")     return (b.artSales   ?? -1) - (a.artSales   ?? -1);
    return (b.readCount ?? -1) - (a.readCount ?? -1); // default: readCount
  });

  const top10 = paidArts.slice(0, 10);
  const maxViews = Math.max(...top10.map(a => a.readCount ?? 0), 1);

  const rows = top10.map((a, i) => {
    const artRate = (a.readCount > 0 && a.artPurchase != null)
      ? pct(a.artPurchase / a.readCount * 100) : "—";
    const barW = a.readCount >= 0 ? Math.max(a.readCount / maxViews * 60, 2) : 0;

    return `<tr data-artid="${a.id}" title="クリックで詳細を表示">
      <td class="col-sm col-r" style="color:#9ca3af">${i+1}</td>
      <td><span class="art-link" style="cursor:pointer">${a.title.slice(0,55)}${a.title.length>55?"…":""}</span></td>
      <td class="col-r col-sm n-view">
        <span class="purchase-bar" style="width:${barW}px"></span>${a.readCount >= 0 ? fmt(a.readCount) : "—"}
      </td>
      <td class="col-r col-sm n-like">♥ ${fmt(a.likeCount)}</td>
      <td class="col-r col-sm" style="color:#059669;font-weight:600">${a.artSales >= 0 ? fmtYen(a.artSales) : "—"}</td>
      <td class="col-r col-sm" style="color:#6366f1;font-weight:600">${a.artPurchase != null ? `${a.artPurchase}件` : "—"}</td>
      <td class="col-r col-sm" style="color:#8b5cf6">${artRate}</td>
      <td class="col-r col-sm" style="color:#f59e0b">${a.readCount > 0 ? pct((a.likeCount + a.commentCount) / a.readCount * 100) : "—"}</td>
    </tr>`;
  }).join("");

  document.getElementById("paidTableBody").innerHTML =
    rows || `<tr><td colspan="8" style="text-align:center;color:#9ca3af;padding:20px">有料記事がありません</td></tr>`;
}

// ─── Gemini プロンプト構築 ───────────────────────────────────
function buildGeminiPrompt(data) {
  const arts   = data.articles ?? [];
  const paid   = arts.filter(a => a.isPaid);
  const free   = arts.filter(a => !a.isPaid);
  const totalLikes = arts.reduce((s, a) => s + (a.likeCount ?? 0), 0);
  const withViews  = arts.filter(a => a.readCount >= 0);
  const totalViews = withViews.reduce((s, a) => s + a.readCount, 0);
  const cr     = data.creator ?? {};

  const detailMap = {};
  for (const d of (data.sales?.details ?? [])) {
    if (d.key) detailMap[d.key] = d;
  }

  // 有料記事：全件（売上順）
  const paidList = paid.map(a => {
    const det = detailMap[a.id] ?? {};
    return {
      ...a,
      artSales: det.sales ?? -1,
      artCount: det.count ?? 0,
    };
  }).sort((a, b) => (b.artSales ?? -1) - (a.artSales ?? -1));

  const paidLines = paidList.map(a => {
    const rate = (a.readCount > 0 && a.artCount > 0)
      ? (a.artCount / a.readCount * 100).toFixed(1) + "%" : "—";
    return `  ・「${[...a.title].slice(0,28).join("")}」 ¥${a.price} 閲覧${a.readCount >= 0 ? a.readCount : "不明"} いいね${a.likeCount} 購入${a.artCount}件 売上${a.artSales >= 0 ? fmtYen(a.artSales) : "—"} 転換率${rate}`;
  }).join("\n");

  // 無料記事：いいね上位10件（購読者が何に反応するか）
  const freeTop = [...free]
    .sort((a, b) => b.likeCount - a.likeCount)
    .slice(0, 10)
    .map(a => `  ・「${[...a.title].slice(0,28).join("")}」 いいね${a.likeCount} 閲覧${a.readCount >= 0 ? a.readCount : "不明"}`)
    .join("\n");

  const now = new Date();

  return `あなたはnoteクリエイターの売上改善を専門とするコンサルタントです。
以下のデータを分析し、「明日から実行できる」具体的な行動を提示してください。

【クリエイター基本情報】
・名前: ${cr.nickname ?? "不明"}
・フォロワー: ${cr.followerCount >= 0 ? cr.followerCount.toLocaleString() : "不明"}人
・記事数: ${arts.length}件（有料${paid.length}件 / 無料${free.length}件）
・総閲覧: ${totalViews > 0 ? totalViews.toLocaleString() : "不明"} / 総いいね: ${totalLikes.toLocaleString()}

【有料記事一覧（直近3ヶ月売上順・全${paid.length}件）】
${paidLines || "  データなし"}

【無料記事いいね上位10件（読者の反応が高いコンテンツ）】
${freeTop || "  データなし"}

─────────────────────────────────────
以下の4項目を分析し、必ず下記フォーマットで出力してください。
マークダウン記号（#・*・**・---など）は一切使わないこと。前置き文も不要。

総合スコア：X/10

①タイトルSEO スコア：X/10
課題：〇〇
提案：〇〇

②無料→有料導線 スコア：X/10
課題：〇〇
提案：〇〇

③価格・構成 スコア：X/10
課題：〇〇
提案：〇〇

④次に書く記事 スコア：X/10
根拠：〇〇
テーマ案：〇〇

スコアは現状の出来を1〜10で評価（1＝要改善・10＝優秀）。各項目3〜4行以内。抽象論不要。`;
}

// ─── 売上 KPI を期間粒度に合わせて更新 ────────────────────────
function renderSalesKPIsByGran(sales, gran) {
  if (!sales || sales.error) return;

  const purchases = sales.purchases ?? [];
  const now = new Date();

  const LABELS = {
    day:   { curr: "今日の売上",  comp: "前日比",  purchaseLbl: "今日の購入件数"  },
    week:  { curr: "今週の売上",  comp: "前週比",  purchaseLbl: "今週の購入件数"  },
    month: { curr: "今月の売上",  comp: "前月比",  purchaseLbl: "今月の購入件数"  },
    all:   { curr: "今月の売上",  comp: "前月比",  purchaseLbl: "今月の購入件数"  },
  };
  const lbl = LABELS[gran] ?? LABELS.month;

  const labelSales    = document.getElementById("sSalesLabel");
  const labelMoM      = document.getElementById("sMoMLabel");
  const labelPurchase = document.getElementById("sPurchaseLabel");
  if (labelSales)    labelSales.textContent    = lbl.curr;
  if (labelMoM)      labelMoM.textContent      = lbl.comp;
  if (labelPurchase) labelPurchase.textContent = lbl.purchaseLbl;

  // "all" は既存の月次表示のまま
  if (gran === "all") return;

  function pad(n) { return String(n).padStart(2, "0"); }
  function getKey(d) {
    if (gran === "day")  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    if (gran === "week") return `${d.getFullYear()}-W${pad(getISOWeek(d))}`;
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}`;
  }

  const currKey = getKey(now);
  const prevDate = new Date(now);
  if (gran === "day")   prevDate.setDate(now.getDate() - 1);
  if (gran === "week")  prevDate.setDate(now.getDate() - 7);
  if (gran === "month") prevDate.setMonth(now.getMonth() - 1);
  const prevKey = getKey(prevDate);

  const map = {};
  for (const p of purchases) {
    if (p.is_refund) continue;
    const d = new Date(p.purchased_at ?? p.created_at ?? "");
    if (isNaN(d)) continue;
    const key = getKey(d);
    if (!map[key]) map[key] = { amount: 0, count: 0 };
    map[key].amount += p.price ?? 0;
    map[key].count++;
  }

  const curr = map[currKey] ?? { amount: 0, count: 0 };
  const prev = map[prevKey] ?? { amount: 0, count: 0 };

  // 売上
  document.getElementById("sCurrentSales").textContent    = fmtYen(curr.amount);
  document.getElementById("sCurrentSalesSub").textContent =
    gran === "day" ? "本日実績" : gran === "week" ? "今週実績" : "今月実績";

  // 比較
  if (prev.amount > 0) {
    const diff = curr.amount - prev.amount;
    const rate = (diff / prev.amount * 100).toFixed(1);
    const sign = diff >= 0 ? "+" : "";
    const el   = document.getElementById("sMoM");
    el.textContent = `${sign}${rate}%`;
    el.style.color = diff >= 0 ? "#34d399" : "#f87171";
    document.getElementById("sMoMSub").textContent = `前期 ${fmtYen(prev.amount)}`;
    document.getElementById("sMoMSub").className   = `sales-kpi-sub ${diff >= 0 ? "up" : "down"}`;
  } else {
    document.getElementById("sMoM").textContent    = curr.amount > 0 ? "NEW" : "—";
    document.getElementById("sMoM").style.color    = "";
    document.getElementById("sMoMSub").textContent = "前期データなし";
    document.getElementById("sMoMSub").className   = "sales-kpi-sub neutral";
  }

  // 購入件数
  document.getElementById("sPurchaseCount").textContent = `${curr.count}件`;
  document.getElementById("sPurchaseSub").textContent   =
    curr.count > 0 && curr.amount > 0
      ? `平均 ${fmtYen(Math.round(curr.amount / curr.count))}/件` : "";
}

// ─── 売上推移チャート ─────────────────────────────────────────
function getISOWeek(d) {
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  return Math.ceil((((dt - yearStart) / 86400000) + 1) / 7);
}

function aggregatePurchases(purchases, gran) {
  const map   = {};
  const today = new Date();
  const since = gran === "day"  ? new Date(today.getFullYear(), today.getMonth() - 2,  today.getDate())
              : gran === "week" ? new Date(today.getFullYear(), today.getMonth() - 6,  today.getDate())
              :                   new Date(today.getFullYear() - 2, today.getMonth(), today.getDate());

  for (const p of (purchases ?? [])) {
    if (p.is_refund) continue;
    const d = new Date(p.purchased_at);
    if (isNaN(d) || d < since) continue;
    let key;
    if (gran === "day") {
      key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    } else if (gran === "week") {
      key = `${d.getFullYear()}-W${String(getISOWeek(d)).padStart(2,"0")}`;
    } else {
      key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    }
    if (!map[key]) map[key] = { amount: 0, count: 0 };
    map[key].amount += p.price ?? 0;
    map[key].count++;
  }

  // 2ヶ月前〜今日まで空白を0で埋める
  if (gran === "day") {
    const cur = new Date(since); cur.setHours(0,0,0,0);
    const end = new Date(today); end.setHours(0,0,0,0);
    while (cur <= end) {
      const key = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,"0")}-${String(cur.getDate()).padStart(2,"0")}`;
      if (!map[key]) map[key] = { amount: 0, count: 0 };
      cur.setDate(cur.getDate() + 1);
    }
  } else if (gran === "week") {
    const cur = new Date(since); cur.setHours(0,0,0,0);
    const end = new Date(today); end.setHours(0,0,0,0);
    while (cur <= end) {
      const key = `${cur.getFullYear()}-W${String(getISOWeek(cur)).padStart(2,"0")}`;
      if (!map[key]) map[key] = { amount: 0, count: 0 };
      cur.setDate(cur.getDate() + 7);
    }
  } else {
    const cur = new Date(since.getFullYear(), since.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth(), 1);
    while (cur <= end) {
      const key = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,"0")}`;
      if (!map[key]) map[key] = { amount: 0, count: 0 };
      cur.setMonth(cur.getMonth() + 1);
    }
  }

  const labels = Object.keys(map).sort();
  return { labels, amounts: labels.map(k => map[k].amount), counts: labels.map(k => map[k].count) };
}

function updateSalesCharts() {
  const purchases = currentData?.sales?.purchases ?? [];
  const { labels, amounts, counts } = aggregatePurchases(purchases, salesGranularity);
  let cumAmt = 0, cumCnt = 0;
  const cumAmounts = amounts.map(v => (cumAmt += v));
  const cumCounts  = counts.map(v  => (cumCnt += v));

  resetChart("salesChart", {
    data: { labels, datasets: [
      { type:"bar",  label:"期間別売上", data:amounts,
        backgroundColor:"rgba(99,102,241,.55)", borderRadius:4, yAxisID:"y", order:2 },
      { type:"line", label:"累積売上", data:cumAmounts,
        borderColor:"#6366f1", backgroundColor:"rgba(99,102,241,.06)",
        tension:.3, fill:true, pointRadius:3, borderWidth:2, yAxisID:"y2", order:1 },
    ]},
    options:{
      responsive:true, maintainAspectRatio:false,
      interaction:{ mode:"index", intersect:false },
      plugins:{ legend:{ labels:{ boxWidth:12, padding:12 }}},
      scales:{
        x:{ ticks:{ color:"#9ca3af" }, grid:{ display:false }},
        y:{ ticks:{ color:"#6366f1", callback: v => `¥${v.toLocaleString()}` },
            grid:{ color:"#f3f4f6" }, position:"left",
            title:{ display:true, text:"期間別", color:"#6366f1", font:{size:9}}},
        y2:{ ticks:{ color:"#a78bfa", callback: v => `¥${v.toLocaleString()}` },
             grid:{ display:false }, position:"right",
             title:{ display:true, text:"累積", color:"#a78bfa", font:{size:9}}},
      },
    },
  });

  resetChart("purchaseChart", {
    data: { labels, datasets: [
      { type:"bar",  label:"期間別件数", data:counts,
        backgroundColor:"rgba(16,185,129,.55)", borderRadius:4, yAxisID:"y", order:2 },
      { type:"line", label:"累積件数", data:cumCounts,
        borderColor:"#10b981", backgroundColor:"rgba(16,185,129,.06)",
        tension:.3, fill:true, pointRadius:3, borderWidth:2, yAxisID:"y2", order:1 },
    ]},
    options:{
      responsive:true, maintainAspectRatio:false,
      interaction:{ mode:"index", intersect:false },
      plugins:{ legend:{ labels:{ boxWidth:12, padding:12 }}},
      scales:{
        x:{ ticks:{ color:"#9ca3af" }, grid:{ display:false }},
        y:{ ticks:{ color:"#10b981", precision:0, stepSize:1 },
            grid:{ color:"#f3f4f6" }, position:"left",
            title:{ display:true, text:"期間別", color:"#10b981", font:{size:9}}},
        y2:{ ticks:{ color:"#34d399", precision:0 },
             grid:{ display:false }, position:"right",
             title:{ display:true, text:"累積", color:"#34d399", font:{size:9}}},
      },
    },
  });
}

// ─── チャート ────────────────────────────────────────────────
function resetChart(id, cfg) {
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(document.getElementById(id).getContext("2d"), cfg);
}

function articleKey(publishAt, gran) {
  const d = new Date(publishAt);
  if (gran === "day") {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  }
  if (gran === "week") {
    return `${d.getFullYear()}-W${String(getISOWeek(d)).padStart(2,"0")}`;
  }
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
}

function updateCharts() {
  const gran  = (chartGran === "all") ? "month" : chartGran;
  const map   = {};
  const today = new Date();
  const since = gran === "day"  ? new Date(today.getFullYear(), today.getMonth() - 2,  today.getDate())
              : gran === "week" ? new Date(today.getFullYear(), today.getMonth() - 6,  today.getDate())
              :                   new Date(today.getFullYear() - 2, today.getMonth(), today.getDate());

  for (const a of allArticles) {
    if (!a.publishAt) continue;
    if (new Date(a.publishAt) < since) continue;
    const key = articleKey(a.publishAt, gran);
    if (!map[key]) map[key] = { posts:0, likes:0, comments:0, views:0 };
    map[key].posts++;
    map[key].likes    += a.likeCount    ?? 0;
    map[key].comments += a.commentCount ?? 0;
    if (a.readCount >= 0) map[key].views += a.readCount;
  }

  // 2ヶ月前〜今日まで空白を0で埋める
  if (gran === "day") {
    const cur = new Date(since); cur.setHours(0,0,0,0);
    const end = new Date(today); end.setHours(0,0,0,0);
    while (cur <= end) {
      const key = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,"0")}-${String(cur.getDate()).padStart(2,"0")}`;
      if (!map[key]) map[key] = { posts:0, likes:0, comments:0, views:0 };
      cur.setDate(cur.getDate() + 1);
    }
  } else if (gran === "week") {
    const cur = new Date(since); cur.setHours(0,0,0,0);
    const end = new Date(today); end.setHours(0,0,0,0);
    while (cur <= end) {
      const key = `${cur.getFullYear()}-W${String(getISOWeek(cur)).padStart(2,"0")}`;
      if (!map[key]) map[key] = { posts:0, likes:0, comments:0, views:0 };
      cur.setDate(cur.getDate() + 7);
    }
  } else {
    const cur = new Date(since.getFullYear(), since.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth(), 1);
    while (cur <= end) {
      const key = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,"0")}`;
      if (!map[key]) map[key] = { posts:0, likes:0, comments:0, views:0 };
      cur.setMonth(cur.getMonth() + 1);
    }
  }

  const labels   = Object.keys(map).sort();
  const posts    = labels.map(k => map[k].posts);
  const likes    = labels.map(k => map[k].likes);
  const comments = labels.map(k => map[k].comments);
  let cum = 0;
  const cumLikes = likes.map(v => (cum += v));
  const tickLimit = labels.length <= 14 ? labels.length : 10;

  resetChart("trendChart", {
    data: { labels, datasets: [
      { type:"line", label:"いいね数", data:likes,
        borderColor:"#6366f1", backgroundColor:"rgba(99,102,241,.08)",
        tension:.3, fill:true, pointRadius:2, borderWidth:2, yAxisID:"y" },
      { type:"bar",  label:"投稿数", data:posts,
        backgroundColor:"rgba(99,102,241,.55)", borderRadius:4, yAxisID:"y2" },
    ]},
    options:{
      responsive:true, maintainAspectRatio:false,
      interaction:{ mode:"index", intersect:false },
      plugins:{ legend:{ labels:{ boxWidth:12, padding:12 }}},
      scales:{
        x:{ ticks:{ color:"#9ca3af", maxTicksLimit:tickLimit }, grid:{ display:false }},
        y:{ ticks:{ color:"#6366f1" }, grid:{ color:"#f3f4f6" }, position:"left",
            title:{ display:true, text:"いいね", color:"#6366f1", font:{size:9}}},
        y2:{ ticks:{ color:"#6366f1", stepSize:1, precision:0 }, grid:{ display:false }, position:"right",
             title:{ display:true, text:"投稿数", color:"#6366f1", font:{size:9}}},
      },
    },
  });

  // 日別PV + エンゲージメント率
  const views   = labels.map(k => map[k].views);
  const engRate = labels.map(k => {
    const v = map[k].views;
    const l = map[k].likes;
    const c = map[k].comments;
    return v > 0 ? parseFloat(((l + c) / v * 100).toFixed(2)) : null;
  });

  resetChart("engChart", {
    data: { labels, datasets: [
      { type:"bar",  label:"閲覧数(PV)", data:views,
        backgroundColor:"rgba(99,102,241,.40)", borderRadius:4, yAxisID:"y" },
      { type:"line", label:"エンゲージメント率(%)", data:engRate,
        borderColor:"#f59e0b", backgroundColor:"rgba(245,158,11,.07)",
        tension:.4, fill:true, pointRadius:2, borderWidth:2, yAxisID:"y2",
        spanGaps:true },
    ]},
    options:{
      responsive:true, maintainAspectRatio:false,
      interaction:{ mode:"index", intersect:false },
      plugins:{ legend:{ labels:{ boxWidth:12, padding:12 }},
               tooltip:{ callbacks:{ label: ctx => {
                 const v = ctx.parsed.y;
                 return ctx.dataset.yAxisID === "y2"
                   ? `ENG率: ${v != null ? v.toFixed(2) + "%" : "-"}`
                   : `閲覧数(PV): ${v != null ? Math.round(v).toLocaleString() : "-"}`;
               }}}},
      scales:{
        x:{ ticks:{ color:"#9ca3af", maxTicksLimit:tickLimit }, grid:{ display:false }},
        y:{ ticks:{ color:"#6366f1" }, grid:{ color:"#f3f4f6" }, position:"left",
            title:{ display:true, text:"閲覧数", color:"#6366f1", font:{size:9}}},
        y2:{ ticks:{ color:"#f59e0b",
               callback: v => v != null ? parseFloat(v.toFixed(2)) + "%" : "" },
             grid:{ display:false }, position:"right",
             title:{ display:true, text:"ENG率", color:"#f59e0b", font:{size:9}}},
      },
    },
  });
}

function setChartGran(gran, btn) {
  chartGran = gran;
  document.querySelectorAll(".period-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  updateCharts();
  updateKPIDeltas(gran);
}

// ─── 期間別 KPI デルタ ────────────────────────────────────────
function computePeriodDelta(gran) {
  function pad(n) { return String(n).padStart(2, "0"); }
  function getKey(d) {
    if (gran === "day")  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    if (gran === "week") return `${d.getFullYear()}-W${pad(getISOWeek(d))}`;
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}`;
  }

  const today = new Date();
  // 前期間と前々期間（現在進行中の期間は使わない）
  const prevDate = new Date(today);
  const prevPrevDate = new Date(today);
  if (gran === "day") {
    prevDate.setDate(today.getDate() - 1);
    prevPrevDate.setDate(today.getDate() - 2);
  } else if (gran === "week") {
    prevDate.setDate(today.getDate() - 7);
    prevPrevDate.setDate(today.getDate() - 14);
  } else {
    prevDate.setMonth(today.getMonth() - 1);
    prevPrevDate.setMonth(today.getMonth() - 2);
  }

  const prevKey     = getKey(prevDate);
  const prevPrevKey = getKey(prevPrevDate);

  const map = {};
  for (const a of allArticles) {
    if (!a.publishAt) continue;
    const key = getKey(new Date(a.publishAt));
    if (!map[key]) map[key] = { posts: 0, likes: 0, comments: 0, views: 0 };
    map[key].posts++;
    map[key].likes    += a.likeCount    ?? 0;
    map[key].comments += a.commentCount ?? 0;
    if (a.readCount >= 0) map[key].views += a.readCount;
  }

  const curr = map[prevKey]     || { posts: 0, likes: 0, comments: 0, views: 0 };
  const prev = map[prevPrevKey] || { posts: 0, likes: 0, comments: 0, views: 0 };

  function delta(c, p) {
    if (p === 0) return null;
    return (c - p) / p * 100;
  }

  return {
    curr, prev,
    postsDelta:    delta(curr.posts,    prev.posts),
    likesDelta:    delta(curr.likes,    prev.likes),
    commentsDelta: delta(curr.comments, prev.comments),
    viewsDelta:    delta(curr.views,    prev.views),
    label: gran === "day" ? "前日比" : gran === "week" ? "前週比" : "前月比",
  };
}

function updateKPIDeltas(gran) {
  if (!allArticles.length) return;

  if (gran === "all") {
    const total = allArticles.length;
    const tl    = allArticles.reduce((s, a) => s + (a.likeCount    ?? 0), 0);
    const tc    = allArticles.reduce((s, a) => s + (a.commentCount ?? 0), 0);
    document.getElementById("kViewsSub").textContent    = "累計（全期間）";
    document.getElementById("kLikesSub").textContent    = `平均 ${total ? (tl/total).toFixed(1) : 0} / 記事`;
    document.getElementById("kEngSub").textContent      = "(いいね+コメント)÷閲覧数";
    document.getElementById("kCommentsSub").textContent = `平均 ${total ? (tc/total).toFixed(1) : 0} / 記事`;
    return;
  }

  const d = computePeriodDelta(gran);

  function badge(v) {
    if (v === null) return "";
    const up   = v >= 0;
    const col  = up ? "#10b981" : "#ef4444";
    const sign = up ? "↑+" : "↓";
    return `<span style="color:${col};font-weight:700"> ${sign}${Math.abs(v).toFixed(1)}%</span>`
         + `<span style="color:#9ca3af;font-size:0.65rem"> ${d.label}</span>`;
  }

  function setSub(id, primary, deltaVal) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = primary + badge(deltaVal);
  }

  setSub("kViewsSub",    `直近 ${fmt(d.curr.views)}PV`,      d.viewsDelta);
  setSub("kLikesSub",    `直近 ${fmt(d.curr.likes)}件`,      d.likesDelta);
  setSub("kCommentsSub", `直近 ${fmt(d.curr.comments)}件`,   d.commentsDelta);

  const currEng = d.curr.views > 0 ? (d.curr.likes + d.curr.comments) / d.curr.views * 100 : null;
  const prevEng = d.prev.views > 0 ? (d.prev.likes + d.prev.comments) / d.prev.views * 100 : null;
  const engDelta = (currEng !== null && prevEng !== null && prevEng > 0)
    ? (currEng - prevEng) / prevEng * 100 : null;
  setSub("kEngSub", currEng !== null ? `直近 ${currEng.toFixed(2)}%` : "要ログイン", engDelta);
}

// ─── メインレンダリング ──────────────────────────────────────
async function render(data) {
  if (!data?.articles?.length) return;
  currentData = data;

  allArticles = data.articles.map(a => ({
    ...a,
    category: categorize(a.title),
    dateStr:  fmtDate(a.publishAt),
    dateObj:  new Date(a.publishAt),
  })).sort((a, b) => b.dateObj - a.dateObj);

  const arts       = allArticles;
  const total      = arts.length;
  const totalLikes = arts.reduce((s, a) => s + (a.likeCount    ?? 0), 0);
  const totalCmt   = arts.reduce((s, a) => s + (a.commentCount ?? 0), 0);
  const withViews  = arts.filter(a => a.readCount >= 0);
  const totalViews = withViews.reduce((s, a) => s + a.readCount, 0);
  const hasViews   = withViews.length > 0;
  const avgLikes   = total ? (totalLikes / total).toFixed(1) : 0;
  const engRate    = hasViews && totalViews > 0
    ? pct(((totalLikes + totalCmt) / totalViews) * 100) : "—";

  // Header
  document.getElementById("updatedAt").textContent =
    data.updatedAt ? `最終更新: ${timeAgo(data.updatedAt)}` : "";

  // ① 売上ヒーロー
  await renderSalesSection(data.sales ?? null);
  renderSalesKPIsByGran(data.sales ?? null, salesGranularity);

  // ② ファネル
  await renderFunnel(arts, data.sales ?? null);

  // ③ 有料記事テーブル
  renderPaidTable(arts, data.sales ?? null);

  // ⑤ フォロワー
  const cr = data.creator ?? {};
  document.getElementById("kFollowers").textContent    = cr.followerCount  >= 0 ? fmt(cr.followerCount)  : "—";
  document.getElementById("kFollowersSub").textContent = "現在のフォロワー数";
  document.getElementById("kFollowing").textContent    = cr.followingCount >= 0 ? fmt(cr.followingCount) : "—";
  document.getElementById("kFollowingSub").textContent = "現在のフォロー数";

  // ⑥ 統計KPI
  document.getElementById("kViews").textContent     = hasViews ? fmt(totalViews)  : "—";
  document.getElementById("kViewsSub").textContent  = hasViews ? `${withViews.length}件取得済み` : "要ログイン";
  document.getElementById("kLikes").textContent     = fmt(totalLikes);
  document.getElementById("kLikesSub").textContent  = `平均 ${avgLikes} / 記事`;
  document.getElementById("kEng").textContent       = engRate;
  document.getElementById("kEngSub").textContent    = "(いいね+コメント)÷閲覧数";
  document.getElementById("kArticles").textContent  = total;
  document.getElementById("kArticlesSub").textContent = `有料 ${arts.filter(a=>a.isPaid).length} / 無料 ${arts.filter(a=>!a.isPaid).length}`;
  document.getElementById("kComments").textContent    = fmt(totalCmt);
  document.getElementById("kCommentsSub").textContent = `平均 ${total ? (totalCmt/total).toFixed(1) : 0} / 記事`;

  if (!hasViews) {
    document.getElementById("noViewsNotice").style.display = "flex";
  }

  // カテゴリ別チャート
  const catData = {};
  for (const a of arts) {
    if (!catData[a.category]) catData[a.category] = { count:0, likes:0 };
    catData[a.category].count++;
    catData[a.category].likes += a.likeCount ?? 0;
  }
  const catLabels = Object.keys(catData);
  const catCols   = catLabels.map(k => CAT_COLORS[k] ?? "#94a3b8");

  resetChart("catChart", {
    type:"doughnut",
    data:{ labels:catLabels, datasets:[{
      data: catLabels.map(k => catData[k].count),
      backgroundColor: catCols, borderWidth:2, borderColor:"#fff",
    }]},
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ position:"right", labels:{ boxWidth:12, padding:10 }}},
    },
  });

  resetChart("catLikeChart", {
    type:"bar",
    data:{ labels:catLabels, datasets:[{
      label:"いいね数",
      data: catLabels.map(k => catData[k].likes),
      backgroundColor: catCols, borderRadius:6,
    }]},
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ display:false }},
      scales:{
        x:{ ticks:{ color:"#6b7280" }, grid:{ display:false }},
        y:{ ticks:{ color:"#6b7280" }, grid:{ color:"#f3f4f6" }},
      },
    },
  });

  updateCharts();
  updateSalesCharts();

  // バブルチャート
  renderArticleBubble(allArticles, data.sales ?? null);
  renderCategoryBubble(allArticles);

  // TOP10
  renderTop10();

  renderTable();
  updateKPIDeltas(chartGran);

  document.getElementById("footerText").textContent =
    `Maa Note Analysis — ${total}記事 · いいね ${totalLikes.toLocaleString()} · ${timeAgo(data.updatedAt)}`;
}

// ─── TOP10 レンダリング ───────────────────────────────────────
function renderTop10() {
  if (!allArticles.length) return;

  function sortVal(a) {
    if (top10SortKey === "readCount")    return a.readCount    >= 0 ? a.readCount    : -1;
    if (top10SortKey === "commentCount") return a.commentCount ?? 0;
    if (top10SortKey === "engRate")
      return (a.readCount > 0) ? (a.likeCount + a.commentCount) / a.readCount : -1;
    return a.likeCount ?? 0; // likeCount default
  }

  const sorted = [...allArticles].sort((a, b) => sortVal(b) - sortVal(a)).slice(0, 10);

  document.getElementById("top10").innerHTML = sorted.map((a, i) => {
    const engStr = a.readCount > 0
      ? `📊 ${((a.likeCount + a.commentCount) / a.readCount * 100).toFixed(1)}%` : "";
    return `
    <div class="top-item" data-artid="${a.id}">
      <div class="top-rank">${MEDALS[i] ?? `<span style="font-size:.8rem">${i+1}</span>`}</div>
      <div class="top-info">
        <span class="top-title-link">${a.title.slice(0,70)}${a.title.length>70?"…":""}</span>
        <div class="top-meta">${a.dateStr} · ${a.category}</div>
      </div>
      <div class="top-nums">
        ${a.readCount >= 0 ? `<span class="n-view">👁 ${fmt(a.readCount)}</span>` : ""}
        <span class="n-like">♥ ${fmt(a.likeCount)}</span>
        <span class="n-cmt">💬 ${a.commentCount}</span>
        ${engStr ? `<span style="color:#8b5cf6">${engStr}</span>` : ""}
      </div>
    </div>`;
  }).join("");
}

// ─── 全記事テーブル ───────────────────────────────────────────
function getSortValue(a, key) {
  if (key === "readCount")    return a.readCount    >= 0 ? a.readCount    : -1;
  if (key === "likeCount")    return a.likeCount    ?? 0;
  if (key === "commentCount") return a.commentCount ?? 0;
  if (key === "engRate")
    return (a.readCount > 0) ? (a.likeCount + a.commentCount) / a.readCount : -1;
  return a.dateObj?.getTime() ?? 0; // date (default)
}

function updateTableSortHeaders() {
  const SORT_COL = { readCount: 5, likeCount: 6, commentCount: 7, engRate: 8 };
  document.querySelectorAll("#articlesTableHead th[data-sort]").forEach(th => {
    const key = th.dataset.sort;
    const isActive = key === tableSortKey;
    const arrow = isActive ? (tableSortDir === "desc" ? " ▼" : " ▲") : " ⇅";
    th.style.cursor = "pointer";
    th.style.color  = isActive ? "#6366f1" : "";
    th.style.userSelect = "none";
    // replace any existing arrow
    th.textContent = th.dataset.label + arrow;
  });
}

function setTableSort(key) {
  if (tableSortKey === key) {
    tableSortDir = tableSortDir === "desc" ? "asc" : "desc";
  } else {
    tableSortKey = key;
    tableSortDir = "desc";
  }
  renderTable();
}

function renderTable() {
  const sorted = [...allArticles].sort((a, b) => {
    const va = getSortValue(a, tableSortKey);
    const vb = getSortValue(b, tableSortKey);
    return tableSortDir === "desc" ? vb - va : va - vb;
  });

  const rows = sorted.map((a, i) => {
    const catCls = CAT_BG[a.category] ?? "c-other";
    const paid   = a.isPaid
      ? '<span class="badge b-paid">有料</span>'
      : '<span class="badge b-free">無料</span>';
    const views  = a.readCount >= 0 ? fmt(a.readCount) : "—";
    const artEng = (a.readCount >= 0 && a.readCount > 0)
      ? pct(((a.likeCount + a.commentCount) / a.readCount) * 100) : "—";
    return `<tr data-cat="${a.category}" data-title="${a.title.toLowerCase()}" data-paid="${a.isPaid ? "paid" : "free"}" data-artid="${a.id}">
      <td class="col-sm col-r" style="color:#9ca3af">${i+1}</td>
      <td><span class="art-link" style="cursor:pointer">${a.title.slice(0,58)}${a.title.length>58?"…":""}</span></td>
      <td><span class="cat-badge ${catCls}">${a.category}</span></td>
      <td class="col-sm" style="color:#6b7280;font-size:.72rem">${a.dateStr}</td>
      <td>${paid}</td>
      <td class="col-r col-sm n-view">${views}</td>
      <td class="col-r col-sm n-like">♥ ${fmt(a.likeCount)}</td>
      <td class="col-r col-sm n-cmt">💬 ${a.commentCount}</td>
      <td class="col-r col-sm" style="color:#8b5cf6;font-size:.75rem">${artEng}</td>
    </tr>`;
  }).join("");
  document.getElementById("tableBody").innerHTML = rows;
  updateTableSortHeaders();
  applyFilter();
}

function applyFilter() {
  const q = (document.getElementById("searchInput")?.value ?? "").toLowerCase();
  let visible = 0;
  document.querySelectorAll("#tableBody tr").forEach(row => {
    const show = (!q || (row.dataset.title ?? "").includes(q))
               && (currentCat === "all" || row.dataset.cat === currentCat)
               && (currentPaidFilter === "all" || row.dataset.paid === currentPaidFilter);
    row.style.display = show ? "" : "none";
    if (show) visible++;
  });
  const info = document.getElementById("tblInfo");
  if (info) info.textContent = `表示中: ${visible} / ${allArticles.length} 件`;
}

function setCat(cat, btn) {
  currentCat = cat;
  document.querySelectorAll(".f-btn[data-cat]").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  applyFilter();
}

function setPaidFilter(val, btn) {
  currentPaidFilter = val;
  document.querySelectorAll(".f-btn[data-paid]").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  applyFilter();
}

// ─── CSV エクスポート ─────────────────────────────────────────
function exportCSV() {
  if (!allArticles.length) return;
  const header = ["#","タイトル","カテゴリ","投稿日時","種別","閲覧数","いいね","コメント","エンゲージメント率"];
  const rows = allArticles.map((a, i) => {
    const artEng = (a.readCount >= 0 && a.readCount > 0)
      ? ((a.likeCount + a.commentCount) / a.readCount * 100).toFixed(2) + "%" : "";
    return [i+1, `"${a.title.replace(/"/g,'""')}"`, a.category, a.dateStr,
      a.isPaid ? "有料" : "無料", a.readCount >= 0 ? a.readCount : "",
      a.likeCount ?? 0, a.commentCount ?? 0, artEng].join(",");
  });
  const blob = new Blob(["\uFEFF" + [header.join(","), ...rows].join("\n")], { type:"text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = "note_articles.csv"; a.click();
  URL.revokeObjectURL(url);
}

// ─── Gemini 出力レンダリング ──────────────────────────────────
function renderGeminiOutput(text) {
  function scoreColor(n) {
    if (n >= 7) return "#10b981";
    if (n >= 4) return "#f59e0b";
    return "#ef4444";
  }

  // 総合スコア抽出
  const overallMatch = text.match(/総合スコア[：:]\s*(\d+)\s*\/\s*10/);
  const overallScore = overallMatch ? parseInt(overallMatch[1]) : null;

  // ①〜④セクションのみ抽出（前置き・総合スコア行は除外）
  const sections = text.split(/(?=①|②|③|④)/).filter(s => /^[①②③④]/.test(s.trim()));
  if (!sections.length) return `<pre style="white-space:pre-wrap;font-size:0.82rem;color:#374151">${text}</pre>`;

  // 総合スコアヘッダー
  let html = "";
  if (overallScore !== null) {
    const oc = scoreColor(overallScore);
    html += `<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;padding:10px 16px;background:#f0f9ff;border-radius:10px;border:1px solid #bae6fd">
      <span style="font-size:0.85rem;font-weight:700;color:#1f2937">総合スコア</span>
      <span style="background:${oc};color:#fff;padding:3px 14px;border-radius:14px;font-size:1rem;font-weight:800">${overallScore}/10</span>
    </div>`;
  }

  const cards = sections.map(s => {
    const scoreMatch = s.match(/スコア[：:]\s*(\d+)\s*\/\s*10/);
    const score = scoreMatch ? parseInt(scoreMatch[1]) : null;
    const color = score !== null ? scoreColor(score) : "#6366f1";

    const lines = s
      .replace(/スコア[：:]\s*\d+\s*\/\s*10/, "")
      .replace(/（\s*）/g, "")
      .split("\n").map(l => l.trim()).filter(l => l);

    const heading = lines[0] ?? "";
    const body = lines.slice(1).map(l => {
      // 課題・根拠 → 薄め小さめ（背景情報）
      if (/^(課題|根拠)[：:]/.test(l)) {
        const content = l.replace(/^(課題|根拠)[：:]/, "");
        const label   = l.match(/^(課題|根拠)/)[0];
        return `<div style="margin-bottom:6px">
          <span style="color:${color};font-weight:700;font-size:0.75rem">${label}：</span>
          <span style="color:#6b7280;font-size:0.78rem">${content}</span>
        </div>`;
      }
      // 提案・テーマ案 → 太め大きめ（行動指針）
      if (/^(提案|テーマ案)[：:]/.test(l)) {
        const content = l.replace(/^(提案|テーマ案)[：:]/, "");
        const label   = l.match(/^(提案|テーマ案)/)[0];
        return `<div style="margin-top:4px">
          <span style="color:${color};font-weight:700;font-size:0.8rem">${label}：</span>
          <span style="color:#111827;font-weight:600;font-size:0.82rem">${content}</span>
        </div>`;
      }
      return `<span style="color:#374151;font-size:0.8rem">${l}</span>`;
    }).join("");

    const badge = score !== null
      ? `<span style="background:${color};color:#fff;padding:2px 8px;border-radius:12px;font-size:0.72rem;font-weight:700;margin-left:8px;vertical-align:middle">${score}/10</span>`
      : "";

    return `<div style="padding:12px 14px;background:#f9fafb;border-radius:10px;border-left:3px solid ${color}">
      <div style="font-weight:700;color:#1f2937;margin-bottom:8px;font-size:0.88rem">${heading}${badge}</div>
      <div style="line-height:1.6">${body}</div>
    </div>`;
  });

  html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">${cards.join("")}</div>`;

  return html;
}

// ─── Gemini 分析 ──────────────────────────────────────────────
async function runGeminiAnalysis() {
  if (!currentData) return;
  const btn = document.getElementById("aiAnalyzeBtn");
  const out = document.getElementById("aiOutput");
  btn.disabled = true;
  btn.textContent = "分析中...";
  out.innerHTML = `<span class="ai-loading">⏳ Geminiが分析中です...</span>`;

  const prompt = buildGeminiPrompt(currentData);

  chrome.runtime.sendMessage({ type: "GEMINI_ANALYZE", prompt }, res => {
    btn.disabled = false;
    btn.textContent = "分析する";
    if (chrome.runtime.lastError || res?.error) {
      out.innerHTML = `<span class="ai-error">⚠ ${res?.error ?? chrome.runtime.lastError?.message}</span>`;
    } else {
      out.innerHTML = renderGeminiOutput(res.text ?? "（応答なし）");
    }
  });
}

// ─── 記事パフォーマンスマップ（バブル） ──────────────────────
function renderArticleBubble(arts, sales) {
  const detailMap = {};
  for (const d of (sales?.details ?? [])) {
    if (d.key) detailMap[d.key] = d;
  }

  const artsWithPV = arts.filter(a => a.readCount >= 0);
  if (!artsWithPV.length) return;

  const maxSales = Math.max(...artsWithPV.map(a => detailMap[a.id]?.sales ?? 0), 1);

  // 中央値（4象限の境界線）
  const pvSorted   = [...artsWithPV].map(a => a.readCount).sort((a, b) => a - b);
  const likeSorted = [...artsWithPV].map(a => a.likeCount).sort((a, b) => a - b);
  const mid        = Math.floor(pvSorted.length / 2);
  const medPV      = pvSorted[mid];
  const medLikes   = likeSorted[mid];

  function toRadius(salesAmt) {
    if (!salesAmt || salesAmt <= 0) return 5;
    return Math.round(5 + Math.sqrt(salesAmt / maxSales) * 20);
  }

  const paid = artsWithPV.filter(a => a.isPaid).map(a => ({
    x: a.readCount, y: a.likeCount,
    r: toRadius(detailMap[a.id]?.sales ?? 0),
    label: a.title, url: a.url,
    sales: detailMap[a.id]?.sales ?? 0,
  }));
  const free = artsWithPV.filter(a => !a.isPaid).map(a => ({
    x: a.readCount, y: a.likeCount,
    r: 5,
    label: a.title, url: a.url, sales: 0,
  }));

  // 4象限ライン & ラベルを描くカスタムプラグイン
  const quadPlugin = {
    id: "quadrant",
    afterDraw(chart) {
      const { ctx, scales: { x: xs, y: ys }, chartArea: ca } = chart;
      const px = xs.getPixelForValue(medPV);
      const py = ys.getPixelForValue(medLikes);
      ctx.save();
      ctx.strokeStyle = "rgba(99,102,241,0.22)";
      ctx.setLineDash([5, 5]);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px, ca.top);    ctx.lineTo(px, ca.bottom); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ca.left, py);   ctx.lineTo(ca.right, py);  ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = "bold 10px 'Noto Sans JP',sans-serif";
      const labels = [
        { text: "🌟 スター",  x: ca.right - 8,  y: ca.top + 16,    align: "right" },
        { text: "📖 SEO型",   x: ca.right - 8,  y: ca.bottom - 8,  align: "right" },
        { text: "❤️ ファン型", x: ca.left + 8,  y: ca.top + 16,    align: "left"  },
        { text: "🔧 要改善",   x: ca.left + 8,  y: ca.bottom - 8,  align: "left"  },
      ];
      for (const lbl of labels) {
        ctx.fillStyle = "rgba(99,102,241,0.45)";
        ctx.textAlign = lbl.align;
        ctx.fillText(lbl.text, lbl.x, lbl.y);
      }
      ctx.restore();
    },
  };

  // ホバー時シャドウプラグイン
  const shadowPlugin = {
    id: "bubbleShadow",
    beforeDatasetsDraw(chart) {
      const active = chart.getActiveElements();
      if (!active.length) return;
      const { ctx } = chart;
      for (const el of active) {
        const { x, y } = el.element;
        const r = el.element.options.radius + (el.element.options.hoverRadius ?? 0);
        ctx.save();
        ctx.shadowColor  = "rgba(0,0,0,0.28)";
        ctx.shadowBlur   = 14;
        ctx.shadowOffsetY = 4;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = el.element.options.hoverBackgroundColor ?? el.element.options.backgroundColor;
        ctx.fill();
        ctx.restore();
      }
    },
  };

  resetChart("articleBubble", {
    type: "bubble",
    plugins: [quadPlugin, shadowPlugin],
    data: { datasets: [
      {
        label: "有料記事", data: paid,
        backgroundColor: "rgba(99,102,241,0.55)", borderColor: "rgba(99,102,241,0.8)",
        borderWidth: 1, hoverRadius: 7, hoverBorderWidth: 3, hoverBorderColor: "#fff",
        hoverBackgroundColor: "rgba(99,102,241,0.85)",
      },
      {
        label: "無料記事", data: free,
        backgroundColor: "rgba(14,165,233,0.40)", borderColor: "rgba(14,165,233,0.65)",
        borderWidth: 1, hoverRadius: 7, hoverBorderWidth: 3, hoverBorderColor: "#fff",
        hoverBackgroundColor: "rgba(14,165,233,0.70)",
      },
    ]},
    options: {
      responsive: true, maintainAspectRatio: false,
      onHover: (_, els, chart) => { chart.canvas.style.cursor = els.length ? "pointer" : "default"; },
      plugins: {
        legend: { labels: { boxWidth: 12, padding: 14 }},
        tooltip: { callbacks: { label(ctx) {
          const d = ctx.raw;
          const lines = [`📄 ${[...d.label].slice(0, 30).join("")}…`];
          lines.push(`👁 ${d.x.toLocaleString()}  ❤ ${d.y}`);
          if (d.sales > 0) lines.push(`💰 売上 ¥${d.sales.toLocaleString()}`);
          return lines;
        }}},
      },
      scales: {
        x: {
          title: { display: true, text: "閲覧数（PV）", color: "#6b7280", font: { size: 10 }},
          ticks: { color: "#9ca3af", callback: v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v },
          grid: { color: "#f3f4f6" },
        },
        y: {
          title: { display: true, text: "いいね数", color: "#6b7280", font: { size: 10 }},
          ticks: { color: "#9ca3af" }, grid: { color: "#f3f4f6" },
        },
      },
    },
  });
}

// ─── カテゴリ効率マップ（バブル） ────────────────────────────
function renderCategoryBubble(arts) {
  const catMap = {};
  for (const a of arts) {
    const cat = a.category;
    if (!catMap[cat]) catMap[cat] = { count: 0, pvSum: 0, pvN: 0, likeSum: 0, cmtSum: 0 };
    catMap[cat].count++;
    catMap[cat].likeSum += a.likeCount ?? 0;
    catMap[cat].cmtSum  += a.commentCount ?? 0;
    if (a.readCount >= 0) { catMap[cat].pvSum += a.readCount; catMap[cat].pvN++; }
  }

  const maxEng = 0.5; // 50% で最大半径

  const datasets = Object.entries(catMap).map(([cat, d]) => {
    const avgPV  = d.pvN > 0 ? Math.round(d.pvSum / d.pvN) : 0;
    const engRate = d.pvSum > 0 ? (d.likeSum + d.cmtSum) / d.pvSum : 0;
    const r = Math.max(8, Math.round(8 + Math.sqrt(engRate / maxEng) * 22));
    const col = CAT_COLORS[cat] ?? "#94a3b8";
    return {
      label: cat,
      data: [{ x: d.count, y: avgPV, r, label: cat, engRate: (engRate * 100).toFixed(1), avgPV, count: d.count }],
      backgroundColor: col + "99",
      borderColor: col,
      borderWidth: 2,
      hoverRadius: 8, hoverBorderWidth: 3, hoverBorderColor: "#fff",
      hoverBackgroundColor: col + "cc",
    };
  });

  const shadowPlugin2 = {
    id: "catBubbleShadow",
    beforeDatasetsDraw(chart) {
      const active = chart.getActiveElements();
      if (!active.length) return;
      const { ctx } = chart;
      for (const el of active) {
        const { x, y } = el.element;
        const r = el.element.options.radius + (el.element.options.hoverRadius ?? 0);
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.28)"; ctx.shadowBlur = 14; ctx.shadowOffsetY = 4;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = el.element.options.hoverBackgroundColor ?? el.element.options.backgroundColor;
        ctx.fill(); ctx.restore();
      }
    },
  };

  // カテゴリ名をバブル上に描くプラグイン
  const labelPlugin = {
    id: "catLabel",
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      ctx.save();
      ctx.font = "bold 10px 'Noto Sans JP',sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      for (const ds of chart.data.datasets) {
        const meta = chart.getDatasetMeta(chart.data.datasets.indexOf(ds));
        if (meta.hidden) continue;
        for (const pt of meta.data) {
          ctx.fillStyle = "#fff";
          ctx.fillText(ds.label, pt.x, pt.y);
        }
      }
      ctx.restore();
    },
  };

  resetChart("categoryBubble", {
    type: "bubble",
    plugins: [shadowPlugin2, labelPlugin],
    data: { datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      onHover: (_, els, chart) => { chart.canvas.style.cursor = els.length ? "pointer" : "default"; },
      plugins: {
        legend: { labels: { boxWidth: 12, padding: 12 }},
        tooltip: { callbacks: { label(ctx) {
          const d = ctx.raw;
          return [`📂 ${d.label}`, `記事数: ${d.count}件`, `平均PV: ${d.avgPV.toLocaleString()}`, `ENG率: ${d.engRate}%`];
        }}},
      },
      scales: {
        x: {
          title: { display: true, text: "記事数", color: "#6b7280", font: { size: 10 }},
          ticks: { color: "#9ca3af", stepSize: 1, precision: 0 }, grid: { color: "#f3f4f6" },
        },
        y: {
          title: { display: true, text: "平均閲覧数（PV）", color: "#6b7280", font: { size: 10 }},
          ticks: { color: "#9ca3af", callback: v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v },
          grid: { color: "#f3f4f6" },
        },
      },
    },
  });
}

// ─── タブ切り替え ─────────────────────────────────────────────
function switchTab(tabId) {
  document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  document.getElementById(`tab-${tabId}`).classList.add("active");
  document.querySelector(`.tab-btn[data-tab="${tabId}"]`).classList.add("active");
  // Chart.js は非表示時に dimensions=0 になるので resize() でリセット
  requestAnimationFrame(() => Object.values(charts).forEach(c => c?.resize()));
}

// ─── 起動 ────────────────────────────────────────────────────
const CACHE_KEY = "note_stats_v1";

function showMain() {
  document.getElementById("loadingState").style.display = "none";
  document.getElementById("mainContent").style.display  = "block";
  document.getElementById("tabNav").style.display       = "flex";
}
function showError(msg) {
  const el = document.getElementById("errBanner");
  el.style.display = "block";
  el.textContent   = msg;
  document.getElementById("loadingState").style.display = "none";
}

async function loadFromStorage() {
  const r = await chrome.storage.local.get(CACHE_KEY);
  return r[CACHE_KEY] ?? null;
}

async function pollStorage(resolve, retries, intervalMs) {
  for (let i = 0; i < retries; i++) {
    await new Promise(r => setTimeout(r, intervalMs));
    const data = await loadFromStorage();
    if (data) { resolve(data); return; }
  }
  resolve(null);
}

function requestRefresh(timeoutMs = 120000) {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    try {
      chrome.runtime.sendMessage({ type: "REFRESH" }, res => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          setTimeout(() => loadFromStorage().then(resolve), 3000);
        } else {
          resolve(res?.data ?? null);
        }
      });
    } catch {
      clearTimeout(timer);
      pollStorage(resolve, 30, 2000);
    }
  });
}

(async () => {
  let data = await loadFromStorage();
  if (data) { showMain(); await render(data); return; }

  document.getElementById("loadingState").textContent =
    "初回データ取得中... 少し時間がかかります（1〜2分）";

  data = await requestRefresh(120000);
  if (data) {
    showMain();
    await render(data);
  } else {
    showError("データ取得に失敗しました。note.com にログインしているか確認し「↻ 今すぐ更新」を押してください。");
    document.getElementById("mainContent").style.display = "block";
  }
})();

// ─── イベントリスナー ─────────────────────────────────────────
document.getElementById("refreshBtn").addEventListener("click", async () => {
  const btn = document.getElementById("refreshBtn");
  btn.disabled = true;
  btn.textContent = "更新中...";
  try {
    chrome.runtime.sendMessage({ type: "REFRESH" }, async () => {
      if (chrome.runtime.lastError) {
        await new Promise(r => setTimeout(r, 3000));
      }
      const data = await loadFromStorage();
      if (data) { showMain(); await render(data); }
      btn.disabled = false;
      btn.textContent = "↻ 今すぐ更新";
    });
  } catch {
    await new Promise(r => pollStorage(r, 30, 2000));
    const data = await loadFromStorage();
    if (data) { showMain(); await render(data); }
    btn.disabled = false;
    btn.textContent = "↻ 今すぐ更新";
  }
});

document.getElementById("csvBtn").addEventListener("click", exportCSV);

document.getElementById("loginBtn")?.addEventListener("click", () => {
  chrome.tabs.create({ url: "https://note.com/login" });
});

document.querySelectorAll(".period-btn[data-gran]").forEach(btn => {
  btn.addEventListener("click", () => setChartGran(btn.dataset.gran, btn));
});

document.querySelectorAll(".f-btn[data-cat]").forEach(btn => {
  btn.addEventListener("click", () => setCat(btn.dataset.cat, btn));
});

document.querySelectorAll(".f-btn[data-paid]").forEach(btn => {
  btn.addEventListener("click", () => setPaidFilter(btn.dataset.paid, btn));
});

document.querySelectorAll(".paid-sort-btn[data-top10sort]").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".paid-sort-btn[data-top10sort]").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    top10SortKey = btn.dataset.top10sort;
    renderTop10();
  });
});

document.getElementById("searchInput")?.addEventListener("input", applyFilter);

document.querySelectorAll("#articlesTableHead th[data-sort]").forEach(th => {
  th.addEventListener("click", () => setTableSort(th.dataset.sort));
});

document.querySelectorAll(".sgran-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".sgran-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    salesGranularity = btn.dataset.gran;
    updateSalesCharts();
    renderSalesKPIsByGran(currentData?.sales ?? null, salesGranularity);
  });
});

document.getElementById("aiAnalyzeBtn").addEventListener("click", runGeminiAnalysis);

// タブ切り替え
document.querySelectorAll(".tab-btn[data-tab]").forEach(btn => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

// 有料記事テーブル ソート
document.querySelectorAll(".paid-sort-btn[data-psort]").forEach(btn => {
  btn.addEventListener("click", () => {
    paidSortKey = btn.dataset.psort;
    document.querySelectorAll(".paid-sort-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    if (currentData) renderPaidTable(allArticles, currentData.sales ?? null);
  });
});

// ─── 記事詳細モーダル ────────────────────────────────────────
function renderArticleModal(articleId) {
  const article = allArticles.find(a => a.id === articleId);
  if (!article) return;

  // この記事の購入履歴を取得
  const artPurchases = (currentData?.sales?.purchases ?? [])
    .filter(p => !p.is_refund && p.content?.key === articleId)
    .sort((a, b) => new Date(a.purchased_at) - new Date(b.purchased_at));

  const totalCount  = artPurchases.length;
  const totalSales  = artPurchases.reduce((s, p) => s + (p.price ?? 0), 0);
  const artEng      = article.readCount > 0
    ? ((article.likeCount + article.commentCount) / article.readCount * 100).toFixed(2) + "%"
    : "—";

  // タイトル・メタ
  document.getElementById("modalTitle").textContent = article.title;
  document.getElementById("modalNoteLink").href = article.url ?? "#";
  document.getElementById("modalMeta").innerHTML = [
    `📅 ${article.dateStr}`,
    `👁 閲覧数 ${fmt(article.readCount)}`,
    `♥ いいね ${fmt(article.likeCount)}`,
    `💬 コメント ${article.commentCount}`,
    `📊 ENG率 ${artEng}`,
    article.isPaid ? `<span style="color:#059669;font-weight:700">💰 ${fmtYen(article.isPaid ? article.price || 0 : 0)} 記事</span>` : `<span style="color:#10b981">🆓 無料記事</span>`,
  ].map(s => `<span>${s}</span>`).join("");

  // KPIカード
  const daysOnSale = article.isPaid && totalCount > 0
    ? Math.max(1, Math.round((Date.now() - new Date(artPurchases[0].purchased_at)) / 86400000))
    : null;
  document.getElementById("modalKpiRow").innerHTML = article.isPaid ? `
    <div class="art-modal-kpi">
      <div class="art-modal-kpi-label">累計売上</div>
      <div class="art-modal-kpi-val">${fmtYen(totalSales)}</div>
      <div class="art-modal-kpi-sub">${totalCount}件購入</div>
    </div>
    <div class="art-modal-kpi">
      <div class="art-modal-kpi-label">購入率</div>
      <div class="art-modal-kpi-val">${article.readCount > 0 && totalCount > 0 ? (totalCount / article.readCount * 100).toFixed(2) + "%" : "—"}</div>
      <div class="art-modal-kpi-sub">閲覧→購入</div>
    </div>
    <div class="art-modal-kpi">
      <div class="art-modal-kpi-label">週平均販売</div>
      <div class="art-modal-kpi-val">${daysOnSale ? (totalCount / daysOnSale * 7).toFixed(1) : "—"}</div>
      <div class="art-modal-kpi-sub">件/週</div>
    </div>` : `<div style="grid-column:1/-1;text-align:center;color:#9ca3af;font-size:.8rem;padding:8px">無料記事のため販売データなし</div>`;

  // チャートデータ作成（投稿日〜今日）
  if (totalCount === 0) {
    document.getElementById("modalChartWrap").style.display = "none";
    document.getElementById("modalChartLabel").style.display = "none";
    document.getElementById("modalNoData").style.display = "block";
  } else {
    document.getElementById("modalChartWrap").style.display = "block";
    document.getElementById("modalChartLabel").style.display = "block";
    document.getElementById("modalNoData").style.display = "none";

    const map = {};
    const startDate = new Date(article.publishAt); startDate.setHours(0,0,0,0);
    const endDate   = new Date(); endDate.setHours(0,0,0,0);
    const cur = new Date(startDate);
    while (cur <= endDate) {
      const k = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,"0")}-${String(cur.getDate()).padStart(2,"0")}`;
      map[k] = { count: 0, amount: 0 };
      cur.setDate(cur.getDate() + 1);
    }
    for (const p of artPurchases) {
      const d = new Date(p.purchased_at);
      const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
      if (map[k]) { map[k].count++; map[k].amount += p.price ?? 0; }
    }

    const labels  = Object.keys(map).sort();
    const counts  = labels.map(k => map[k].count);
    const amounts = labels.map(k => map[k].amount);
    let cC = 0, cA = 0;
    const cumCounts  = counts.map(v  => (cC += v));
    const cumAmounts = amounts.map(v => (cA += v));

    if (charts["modalChart"]) charts["modalChart"].destroy();
    charts["modalChart"] = new Chart(
      document.getElementById("modalChart").getContext("2d"), {
      data: { labels, datasets: [
        { type:"bar",  label:"期間別購入数", data:counts,
          backgroundColor:"rgba(99,102,241,.50)", borderRadius:4, yAxisID:"y",  order:2 },
        { type:"line", label:"累積購入数",   data:cumCounts,
          borderColor:"#6366f1", backgroundColor:"rgba(99,102,241,.06)",
          tension:.3, fill:true, pointRadius:2, borderWidth:2, yAxisID:"y2", order:1 },
        { type:"line", label:"累積売上(¥)", data:cumAmounts,
          borderColor:"#10b981", backgroundColor:"transparent",
          tension:.3, fill:false, pointRadius:2, borderWidth:2, yAxisID:"y3", order:1 },
      ]},
      options: {
        responsive:true, maintainAspectRatio:false,
        interaction:{ mode:"index", intersect:false },
        plugins:{ legend:{ labels:{ boxWidth:12, padding:12 }},
          tooltip:{ callbacks:{ label(ctx) {
            if (ctx.dataset.yAxisID === "y3") return `累積売上: ¥${ctx.parsed.y.toLocaleString()}`;
            if (ctx.dataset.yAxisID === "y2") return `累積件数: ${ctx.parsed.y}件`;
            return `期間購入: ${ctx.parsed.y}件`;
          }}}},
        scales:{
          x:{ ticks:{ color:"#9ca3af", maxTicksLimit:12 }, grid:{ display:false }},
          y:{ position:"left",  ticks:{ color:"#6366f1", precision:0, stepSize:1 },
              grid:{ color:"#f3f4f6" },
              title:{ display:true, text:"期間別", color:"#6366f1", font:{size:9}}},
          y2:{ position:"right", ticks:{ color:"#8b5cf6", precision:0 }, grid:{ display:false },
               title:{ display:true, text:"累積件数", color:"#8b5cf6", font:{size:9}}},
          y3:{ position:"right", display:false,
               ticks:{ color:"#10b981", callback: v => `¥${v.toLocaleString()}` }},
        },
      },
    });
  }

  document.getElementById("articleModal").classList.add("open");
}

// 記事詳細モーダル：有料記事テーブル行クリック（イベント委譲）
const paidTableBodyEl = document.getElementById("paidTableBody");
if (paidTableBodyEl) {
  paidTableBodyEl.addEventListener("click", e => {
    const row = e.target.closest("tr[data-artid]");
    if (row) renderArticleModal(row.dataset.artid);
  });
}

// 記事詳細モーダル：テーブル行クリック（イベント委譲）
const tableBodyEl = document.getElementById("tableBody");
if (tableBodyEl) {
  tableBodyEl.addEventListener("click", e => {
    const row = e.target.closest("tr[data-artid]");
    if (row) renderArticleModal(row.dataset.artid);
  });
}

// 記事詳細モーダル：TOP10クリック（イベント委譲）
document.getElementById("top10")?.addEventListener("click", e => {
  const item = e.target.closest("[data-artid]");
  if (item) renderArticleModal(item.dataset.artid);
});

// モーダルを閉じる
document.getElementById("modalClose")?.addEventListener("click", () => {
  document.getElementById("articleModal").classList.remove("open");
});
document.getElementById("articleModal")?.addEventListener("click", e => {
  if (e.target === e.currentTarget) e.currentTarget.classList.remove("open");
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") document.getElementById("articleModal")?.classList.remove("open");
});
