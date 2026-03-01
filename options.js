// options.js
const DEFAULT_ID = "brainy_quince872";

// 現在の設定を読み込み
chrome.storage.local.get(["creatorId", "monthlyGoal", "geminiApiKey"], r => {
  document.getElementById("creatorId").value   = r.creatorId   || DEFAULT_ID;
  document.getElementById("monthlyGoal").value = r.monthlyGoal || "";
  document.getElementById("geminiApiKey").value = r.geminiApiKey ? "●".repeat(12) : "";
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
