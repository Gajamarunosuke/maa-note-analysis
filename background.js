// Maa Note Analysis - Service Worker
// 毎日午前6時に記事統計を自動取得・キャッシュ

const DEFAULT_CREATOR = "brainy_quince872";
const CACHE_KEY = "note_stats_v1";
const GEMINI_MODEL = "gemini-2.5-flash";

async function getCreatorId() {
  const r = await chrome.storage.local.get("creatorId");
  return r.creatorId || DEFAULT_CREATOR;
}

function getISOWeekKey(d) {
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const isoYear = dt.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil((((dt - yearStart) / 86400000) + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}
const REFRESH_INTERVAL = 24 * 60; // 1日1回（分単位）

// ─── note.com API フェッチ（ブラウザのCookieを自動使用）───────
async function fetchJSON(url) {
  const r = await fetch(url, {
    credentials: "include",
    headers: { "Accept": "application/json" },
  });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  const text = await r.text();
  if (!text || !text.trim()) throw new Error(`EMPTY_RESPONSE:${url}`);
  return JSON.parse(text);
}

// ─── クリエイター情報（フォロワー数 / フォロー数）────────────
async function fetchCreatorInfo() {
  const creatorId = await getCreatorId();
  try {
    const data = await fetchJSON(
      `https://note.com/api/v2/creators/${creatorId}`
    );
    const c = data?.data ?? {};
    return {
      followerCount: c.followerCount  ?? c.followersCount ?? -1,
      followingCount: c.followingCount ?? c.followeeCount  ?? -1,
      nickname: c.nickname ?? creatorId,
    };
  } catch {
    return { followerCount: -1, followingCount: -1, nickname: creatorId };
  }
}

// ─── 全記事一覧を取得（公開API・likeCount / commentCount）─────
async function fetchAllArticles() {
  const creatorId = await getCreatorId();
  const articles = [];
  let page = 1;

  while (true) {
    const data = await fetchJSON(
      `https://note.com/api/v2/creators/${creatorId}/contents?kind=note&page=${page}`
    );
    const contents = data?.data?.contents ?? [];
    if (!contents.length) break;

    for (const item of contents) {
      articles.push({
        id:           item.key ?? "",
        title:        item.name ?? "",
        url:          `https://note.com/${creatorId}/n/${item.key}`,
        likeCount:    item.likeCount    ?? 0,
        commentCount: item.commentCount ?? 0,
        publishAt:    item.publishAt    ?? "",
        price:        item.price ?? 0,
        isPaid:       (item.price ?? 0) > 0,
        readCount:    -1,
      });
    }

    if (data?.data?.isLastPage) break;
    page++;
    await sleep(400);
  }
  return articles;
}

// ─── 閲覧数を /api/v1/stats/pv から直接取得 ──────────────────
// /api/v3/notes/{id}/stats は廃止済み(404)。
// /api/v1/stats/pv?filter=all&page=N&sort=pv が正しいエンドポイント。
// Service Worker から credentials:include で直接呼び出せるため content.js 不要。
async function fetchReadCounts(articles) {
  const pvMap = {};
  let page = 1;

  while (true) {
    try {
      const data = await fetchJSON(
        `https://note.com/api/v1/stats/pv?filter=all&page=${page}&sort=pv`
      );
      const noteStats = data?.data?.note_stats ?? [];
      if (!noteStats.length) break;

      for (const item of noteStats) {
        if (item.key) pvMap[item.key] = item.read_count ?? -1;
      }

      if (data?.data?.last_page) break;
      page++;
      await sleep(400);
    } catch (e) {
      console.error("[note-dash] PV取得エラー:", e);
      break;
    }
  }

  for (const article of articles) {
    if (article.id in pvMap) {
      article.readCount = pvMap[article.id];
    }
  }

  const got = Object.values(pvMap).filter(v => v >= 0).length;
  console.log(`[note-dash] PV取得完了: ${got}件`);
  return articles;
}

// ─── datespan文字列生成（YYYYMM） ────────────────────────────
function toDatespan(year, month) {
  return `${year}${String(month).padStart(2, "0")}`;
}

// ─── 売上統計を取得（purchasers API ベース） ─────────────────
async function fetchSalesStats() {
  try {
    const summary = await fetchJSON("https://note.com/api/v1/stats/sales");

    // 前年1月〜現在まで取得（前年分も含める）
    const now = new Date();
    const datespans = [];
    let y = now.getFullYear() - 1, m = 1;
    while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
      datespans.push(toDatespan(y, m));
      if (++m > 12) { m = 1; y++; }
    }

    const allPurchases = [];
    for (const datespan of datespans) {
      let page = 1;
      while (true) {
        const data = await fetchJSON(
          `https://note.com/api/v1/stats/purchasers?datespan=${datespan}&sort=date_desc&page=${page}`
        );
        // 配列フィールドを自動検出
        const rawData = data?.data ?? {};
        const items = rawData.purchasers ?? rawData.purchase_histories
          ?? rawData.note_stats ?? rawData.histories ?? [];

        if (!items.length) break;
        allPurchases.push(...items.map(p => ({ ...p, _datespan: datespan })));
        if (rawData.last_page || rawData.isLastPage) break;
        page++;
        await sleep(400);
      }
    }

    // 記事キー別に集計（details 互換形式）
    const detailMap = {};
    for (const p of allPurchases) {
      if (p.is_refund) continue;                          // 返金除外
      const key = p.content?.key ?? p.purchase_content_key ?? "";
      if (!key) continue;
      if (!detailMap[key]) detailMap[key] = { key, count: 0, sales: 0 };
      detailMap[key].count++;
      detailMap[key].sales += p.price ?? 0;
    }
    const details = Object.values(detailMap);

    console.log(`[note-dash] purchasers取得: ${allPurchases.length}件 / 記事${details.length}種`);
    return { summary: summary?.data ?? null, details, purchases: allPurchases };
  } catch (e) {
    console.error("[note-dash] 売上取得エラー:", e.message);
    const needsLogin = /4\d\d/.test(e.message) || e.message.includes("verification")
      || e.message.includes("EMPTY_RESPONSE") || e.message.includes("JSON");
    return { error: e.message, needsLogin };
  }
}

// ─── 週次 PV 取得（filter=weekly）────────────────────────────
// endDate: "YYYY-MM-DD" を指定すると過去週を取得。省略で当週。
async function fetchWeeklyPVStats(articles, endDate = null) {
  const pvMap = {};
  let totalPV = 0;
  let startDate = null;
  let page = 1;

  const endParam = endDate ? `&end_date=${endDate}` : "";

  while (true) {
    try {
      const data = await fetchJSON(
        `https://note.com/api/v1/stats/pv?filter=weekly${endParam}&page=${page}&sort=pv`
      );
      const d = data?.data ?? {};
      if (page === 1) {
        startDate = d.start_date ?? d.start_date_str ?? null;
        totalPV   = d.total_pv ?? 0;
      }
      const noteStats = d.note_stats ?? [];
      if (!noteStats.length) break;
      for (const item of noteStats) {
        if (item.key) pvMap[item.key] = item.read_count ?? 0;
      }
      if (d.last_page) break;
      page++;
      await sleep(400);
    } catch (e) {
      console.error("[note-dash] 週次PV取得エラー:", e);
      break;
    }
  }

  let weekKey = null;
  if (startDate) {
    const d = new Date(String(startDate).replace(/\//g, "-"));
    if (!isNaN(d)) weekKey = getISOWeekKey(d);
  }

  const paidKeys = new Set(articles.filter(a => a.isPaid).map(a => a.id));
  const paidViews = Object.entries(pvMap)
    .filter(([k]) => paidKeys.has(k))
    .reduce((s, [, v]) => s + v, 0);

  return { weekKey, totalPV, paidViews, artPVMap: pvMap };
}

// 指定オフセット週の土曜日（end_date）を "YYYY-MM-DD" で返す
// weekOffset=0: 今週, 1: 先週, 2: 2週前, ...
function getWeekEndDate(weekOffset = 0) {
  const today = new Date();
  const day = today.getDay(); // 0=Sun … 6=Sat
  const sat = new Date(today);
  sat.setDate(today.getDate() + (6 - day) - weekOffset * 7);
  return sat.toISOString().split("T")[0];
}

// 指定オフセット月の末日を "YYYY-MM-DD" で返す
// monthOffset=0: 今月末, 1: 先月末, 2: 2ヶ月前末, ...
function getMonthEndDate(monthOffset = 0) {
  const now = new Date();
  // day=0 of next month = last day of target month
  const d = new Date(now.getFullYear(), now.getMonth() - monthOffset + 1, 0);
  return d.toISOString().split("T")[0];
}

// ─── 月次 PV 取得（filter=monthly）───────────────────────────
async function fetchMonthlyPVStats(articles, endDate = null) {
  const pvMap = {};
  let totalPV = 0;
  let page = 1;

  const endParam = endDate ? `&end_date=${endDate}` : "";

  while (true) {
    try {
      const data = await fetchJSON(
        `https://note.com/api/v1/stats/pv?filter=monthly${endParam}&page=${page}&sort=pv`
      );
      const d = data?.data ?? {};
      if (page === 1) totalPV = d.total_pv ?? 0;
      const noteStats = d.note_stats ?? [];
      if (!noteStats.length) break;
      for (const item of noteStats) {
        if (item.key) pvMap[item.key] = item.read_count ?? 0;
      }
      if (d.last_page) break;
      page++;
      await sleep(400);
    } catch (e) {
      console.error("[note-dash] 月次PV取得エラー:", e);
      break;
    }
  }

  // monthKey: endDate の月（未指定=今月）
  let monthKey;
  if (endDate) {
    monthKey = endDate.slice(0, 7); // "YYYY-MM"
  } else {
    const now = new Date();
    monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }

  const paidKeys = new Set(articles.filter(a => a.isPaid).map(a => a.id));
  const paidViews = Object.entries(pvMap)
    .filter(([k]) => paidKeys.has(k))
    .reduce((s, [, v]) => s + v, 0);

  return { monthKey, totalPV, paidViews, artPVMap: pvMap };
}

// ─── Gemini API 呼び出し ─────────────────────────────────────
async function callGeminiAPI(prompt, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 1200,
        temperature: 0.8,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `Gemini ${r.status}`);
  }
  const data = await r.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

// ─── メイン更新処理 ──────────────────────────────────────────
async function refreshStats() {
  console.log("[note-dash] 統計データを更新中...");
  try {
    const [articles, creator, sales] = await Promise.all([
      fetchAllArticles(),
      fetchCreatorInfo(),
      fetchSalesStats(),
    ]);
    await fetchReadCounts(articles);

    // 週次PV履歴を蓄積（初回は過去12週をバックフィル）
    const WEEKLY_HIST_KEY = "note_weekly_pv_v1";
    let weeklyPVHistory = [];
    try {
      const histR = await chrome.storage.local.get(WEEKLY_HIST_KEY);
      weeklyPVHistory = histR[WEEKLY_HIST_KEY] ?? [];

      // 取得する週のリスト（初回=12週、以降=当週のみ）
      const weeksToFetch = weeklyPVHistory.length === 0
        ? Array.from({ length: 12 }, (_, i) => i)   // 0〜11（0=今週）
        : [0];                                        // 当週のみ更新

      for (const offset of weeksToFetch) {
        const endDate = getWeekEndDate(offset);
        const result  = await fetchWeeklyPVStats(articles, offset === 0 ? null : endDate);
        if (!result.weekKey) { await sleep(300); continue; }

        const entry = { weekKey: result.weekKey, totalPV: result.totalPV, paidViews: result.paidViews, artPVMap: result.artPVMap ?? {} };
        const idx = weeklyPVHistory.findIndex(h => h.weekKey === entry.weekKey);
        if (idx >= 0) weeklyPVHistory[idx] = entry;
        else          weeklyPVHistory.push(entry);
        console.log(`[note-dash] 週次PV: ${entry.weekKey} 有料PV=${entry.paidViews}`);
        await sleep(400);
      }

      weeklyPVHistory.sort((a, b) => a.weekKey.localeCompare(b.weekKey));
      if (weeklyPVHistory.length > 12) weeklyPVHistory.splice(0, weeklyPVHistory.length - 12);
      await chrome.storage.local.set({ [WEEKLY_HIST_KEY]: weeklyPVHistory });
    } catch (e) {
      console.error("[note-dash] 週次PV履歴エラー:", e);
    }

    // 月次PV履歴を蓄積（初回は過去12ヶ月をバックフィル）
    const MONTHLY_HIST_KEY = "note_monthly_pv_v1";
    let monthlyPVHistory = [];
    try {
      const mHistR = await chrome.storage.local.get(MONTHLY_HIST_KEY);
      monthlyPVHistory = mHistR[MONTHLY_HIST_KEY] ?? [];

      const monthsToFetch = monthlyPVHistory.length === 0
        ? Array.from({ length: 12 }, (_, i) => i)   // 0〜11（0=今月）
        : [0];                                        // 今月のみ更新

      for (const offset of monthsToFetch) {
        const endDate = offset === 0 ? null : getMonthEndDate(offset);
        const result  = await fetchMonthlyPVStats(articles, endDate);
        if (!result.monthKey) { await sleep(300); continue; }

        const entry = { monthKey: result.monthKey, totalPV: result.totalPV, paidViews: result.paidViews, artPVMap: result.artPVMap ?? {} };
        const idx = monthlyPVHistory.findIndex(h => h.monthKey === entry.monthKey);
        if (idx >= 0) monthlyPVHistory[idx] = entry;
        else          monthlyPVHistory.push(entry);
        console.log(`[note-dash] 月次PV: ${entry.monthKey} 有料PV=${entry.paidViews}`);
        await sleep(400);
      }

      monthlyPVHistory.sort((a, b) => a.monthKey.localeCompare(b.monthKey));
      if (monthlyPVHistory.length > 12) monthlyPVHistory.splice(0, monthlyPVHistory.length - 12);
      await chrome.storage.local.set({ [MONTHLY_HIST_KEY]: monthlyPVHistory });
    } catch (e) {
      console.error("[note-dash] 月次PV履歴エラー:", e);
    }

    const totalLikes = articles.reduce((s, a) => s + a.likeCount, 0);
    const hasViews   = articles.some(a => a.readCount >= 0);

    const cache = { articles, creator, sales, updatedAt: Date.now(), hasViews, weeklyPVHistory, monthlyPVHistory };
    await chrome.storage.local.set({ [CACHE_KEY]: cache });

    chrome.action.setBadgeText({ text: "" });

    console.log(`[note-dash] 完了: ${articles.length}件, ❤${totalLikes}`);
  } catch (e) {
    console.error("[note-dash] 更新エラー:", e);
  }
}

// ─── ライフサイクル ──────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  refreshStats();
  // 毎日午前6時に更新
  chrome.alarms.create("auto-refresh", {
    when: nextAlarmTime(6, 0),
    periodInMinutes: REFRESH_INTERVAL,
  });
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === "auto-refresh") refreshStats();
});

// ─── popup / dashboard からのメッセージ ──────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "GET_CACHE") {
    chrome.storage.local.get(CACHE_KEY).then(r =>
      sendResponse({ data: r[CACHE_KEY] ?? null })
    );
    return true;
  }
  if (msg.type === "REFRESH") {
    refreshStats().then(() =>
      chrome.storage.local.get(CACHE_KEY).then(r =>
        sendResponse({ data: r[CACHE_KEY] ?? null })
      )
    );
    return true;
  }
  if (msg.type === "GEMINI_ANALYZE") {
    chrome.storage.local.get("geminiApiKey").then(async r => {
      const apiKey = r.geminiApiKey ?? "";
      if (!apiKey) {
        sendResponse({ error: "Gemini APIキーが設定されていません（設定画面で登録してください）" });
        return;
      }
      try {
        const text = await callGeminiAPI(msg.prompt, apiKey);
        sendResponse({ text });
      } catch (e) {
        sendResponse({ error: e.message });
      }
    });
    return true;
  }
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function nextAlarmTime(hour, minute) {
  const now = new Date();
  const next = new Date();
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime();
}
