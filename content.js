// content.js — note.com ページ内で動作（Cookie が同一サイトとして送信される）
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "PING") {
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === "FETCH_STATS") {
    fetchStats(msg.articleIds).then(sendResponse);
    return true; // 非同期レスポンスを維持
  }
});

async function fetchStats(articleIds) {
  const results = {};
  for (const id of articleIds) {
    try {
      const r = await fetch(`/api/v3/notes/${id}/stats`, {
        credentials: "include",
        headers: { "Accept": "application/json" },
      });
      if (r.ok) {
        const d = (await r.json())?.data ?? {};
        results[id] = d.readCount ?? d.read_count ?? d.viewCount ?? d.view_count ?? -1;
      } else {
        results[id] = -1;
      }
    } catch {
      results[id] = -1;
    }
    await new Promise(r => setTimeout(r, 120));
  }
  return results;
}
