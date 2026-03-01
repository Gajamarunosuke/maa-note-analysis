// Maa Note Analysis - Service Worker
// 毎日午前6時に記事統計を自動取得・キャッシュ

const DEFAULT_CREATOR = "brainy_quince872";
const CACHE_KEY = "note_stats_v1";
const GEMINI_MODEL = "gemini-2.5-flash";

async function getCreatorId() {
  const r = await chrome.storage.local.get("creatorId");
  return r.creatorId || DEFAULT_CREATOR;
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

    // 直近3ヶ月分の購入者データを取得
    const now = new Date();
    const datespans = [];
    for (let i = 0; i < 3; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      datespans.push(toDatespan(d.getFullYear(), d.getMonth() + 1));
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

    const totalLikes = articles.reduce((s, a) => s + a.likeCount, 0);
    const hasViews   = articles.some(a => a.readCount >= 0);

    const cache = { articles, creator, sales, updatedAt: Date.now(), hasViews };
    await chrome.storage.local.set({ [CACHE_KEY]: cache });

    // バッジ表示（累計いいね数）
    const badge = totalLikes >= 1000
      ? `${(totalLikes / 1000).toFixed(1)}k`
      : String(totalLikes);
    chrome.action.setBadgeText({ text: badge });
    chrome.action.setBadgeBackgroundColor({ color: "#6366f1" });

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
