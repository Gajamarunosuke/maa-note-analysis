// options.js
const DEFAULT_ID = "brainy_quince872";

// PRO解除キーのSHA-256ハッシュ（平文キーはここに置かない）
const PAID_HASH = "ba4ba2d8e388c4247a7ff7bcd4d86bc729f9312426008561cb08645cb8796e7d";

async function hashKey(raw) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// 現在の設定を読み込み
chrome.storage.local.get(["creatorId", "monthlyGoal", "geminiApiKey", "paidKeyHash"], r => {
  document.getElementById("creatorId").value   = r.creatorId   || DEFAULT_ID;
  document.getElementById("monthlyGoal").value = r.monthlyGoal || "";
  document.getElementById("geminiApiKey").value = r.geminiApiKey ? "●".repeat(12) : "";
  document.getElementById("paidKey").value      = r.paidKeyHash ? "●".repeat(12) : "";
});

// ── クリエイター + 目標 保存 ────────────────────────────────
document.getElementById("saveBtn").addEventListener("click", async () => {
  const id     = document.getElementById("creatorId").value.trim();
  const goal   = parseInt(document.getElementById("monthlyGoal").value, 10) || 0;
  const status = document.getElementById("status");

  if (!id) {
    status.className = "status err";
    status.style.display = "block";
    status.textContent = "クリエイター ID を入力してください";
    return;
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    status.className = "status err";
    status.style.display = "block";
    status.textContent = "ID に使えない文字が含まれています";
    return;
  }

  await chrome.storage.local.set({ creatorId: id, monthlyGoal: goal, note_stats_v1: null });

  status.className = "status ok";
  status.style.display = "block";
  status.textContent = `保存しました (${id} / 目標¥${goal.toLocaleString()})。データを取得中...`;

  chrome.runtime.sendMessage({ type: "REFRESH" }, () => {
    status.textContent = `完了！ (${id})`;
  });
});

document.getElementById("clearBtn").addEventListener("click", () => {
  document.getElementById("creatorId").value = "";
  document.getElementById("monthlyGoal").value = "";
  document.getElementById("status").style.display = "none";
});

// ── Gemini APIキー 保存 ─────────────────────────────────────
document.getElementById("saveApiBtn").addEventListener("click", async () => {
  const raw    = document.getElementById("geminiApiKey").value.trim();
  const status = document.getElementById("apiStatus");

  if (!raw || raw === "●".repeat(12)) {
    status.className = "status err";
    status.style.display = "block";
    status.textContent = "APIキーを入力してください";
    return;
  }

  await chrome.storage.local.set({ geminiApiKey: raw });
  status.className = "status ok";
  status.style.display = "block";
  status.textContent = "APIキーを保存しました";
  document.getElementById("geminiApiKey").value = "●".repeat(12);
});

document.getElementById("clearApiBtn").addEventListener("click", async () => {
  await chrome.storage.local.remove("geminiApiKey");
  document.getElementById("geminiApiKey").value = "";
  document.getElementById("apiStatus").style.display = "none";
});

// ── PAID 合言葉 保存 ─────────────────────────────────────────
document.getElementById("savePaidBtn").addEventListener("click", async () => {
  const raw    = document.getElementById("paidKey").value.trim();
  const status = document.getElementById("paidStatus");

  if (!raw || raw === "●".repeat(12)) {
    status.className = "status err";
    status.style.display = "block";
    status.textContent = "合言葉を入力してください";
    return;
  }

  const h = await hashKey(raw);
  if (h !== PAID_HASH) {
    status.className = "status err";
    status.style.display = "block";
    status.textContent = "合言葉が正しくありません";
    return;
  }

  // 生キーは保存せずハッシュのみ保存
  await chrome.storage.local.set({ paidKeyHash: PAID_HASH });
  status.className = "status ok";
  status.style.display = "block";
  status.textContent = "✅ PRO機能が有効になりました";
  document.getElementById("paidKey").value = "●".repeat(12);
});

document.getElementById("clearPaidBtn").addEventListener("click", async () => {
  await chrome.storage.local.remove("paidKeyHash");
  document.getElementById("paidKey").value = "";
  document.getElementById("paidStatus").style.display = "none";
});
