# Maa Note Analysis Ver.0

**note.com クリエイター向け 売上・コンテンツ分析ダッシュボード（Chrome拡張機能）**

[![Demo](https://img.shields.io/badge/🎯_デモを見る-GitHub_Pages-6366f1?style=for-the-badge)](https://gajamarunosuke.github.io/maa-note-analysis/dashboard_demo.html)

---

## 📊 こんな画面が使えます

> デモページ（架空データ）を[こちら](https://gajamarunosuke.github.io/maa-note-analysis/dashboard_demo.html)で確認できます。インストール不要でブラウザから見られます。

**💰 収益・売上タブ**
- 今月の売上・購入件数・先月比・目標達成率
- 年間累計売上・購入件数
- 売上/購入件数の推移グラフ（月別/週別/日別）
- 記事パフォーマンスマップ（PV × いいね × 売上のバブルチャート）
- 有料記事別パフォーマンス一覧（閲覧数・購入率・ENG率）
- Gemini AIによる改善アドバイス（要APIキー）

**📊 コンテンツ分析タブ**
- フォロワー数・総閲覧数・いいね・エンゲージメント率
- 投稿数・いいね推移グラフ
- カテゴリ別記事数・いいね数
- カテゴリ効率マップ（記事数 × 平均PV × ENG率）
- いいね TOP 10

**📋 記事一覧タブ**
- 全記事一覧（カテゴリフィルター・キーワード検索）
- CSV エクスポート

---

## 🔧 動作環境

- **Chrome**（または Chromium 系ブラウザ）
- **note.com アカウント**
- 売上・閲覧数の取得には **note.com にログイン済み** であること

---

## 📦 インストール方法

### 1. ダウンロード

このページ右上の **Code → Download ZIP** からダウンロードして解凍します。

```
maa-note-analysis/
├── manifest.json
├── background.js
├── popup.html / popup.js
├── dashboard.html / dashboard.js
├── options.html / options.js
└── libs/chart.min.js
```

### 2. Chrome に読み込む

1. Chrome のアドレスバーに `chrome://extensions` と入力して開く
2. 右上の **「デベロッパーモード」をON** にする
3. **「パッケージ化されていない拡張機能を読み込む」** をクリック
4. 解凍したフォルダ（`maa-note-analysis`）を選択

ツールバーに **M** のアイコンが表示されれば完了です。

---

## ⚙️ 初期設定

### クリエイター ID の設定（必須）

1. ツールバーのアイコンを **右クリック → 「オプション」**
2. 「クリエイター ID」欄に自分の **note.com のユーザーID** を入力

   > note のプロフィールURL `https://note.com/〇〇〇` の `〇〇〇` 部分

3. 月次目標（任意）を入力して **「保存」** をクリック

### Gemini AI コメント機能（任意）

1. [Google AI Studio](https://aistudio.google.com/apikey) で Gemini API キーを取得（無料）
2. オプション画面の「Gemini API キー」欄に入力して保存

---

## 🚀 使い方

1. note.com にログインした状態で Chrome を開く
2. ツールバーのアイコンをクリック → ポップアップが表示される
3. **「↻ 更新」** を押すとデータ取得開始（初回は1〜2分かかります）
4. **「📊 ダッシュボード」** で詳細画面を開く

---

## ❓ よくある質問

**Q. 売上が「—」と表示される**
A. note.com の「売上管理ページ」でパスワード再確認が必要な場合があります。ダッシュボード内の案内ボタンから認証してください。

**Q. 閲覧数が取得できない**
A. note.com にログインしてから「↻ 更新」を押してください。

**Q. 更新の頻度は？**
A. 毎日午前6時に自動更新されます。手動更新はいつでも可能です。

---

## ⚠️ 注意事項

- **個人利用を想定しています**（自分のアカウントのデータのみ取得）
- note.com の非公式APIを使用しているため、仕様変更により動作しなくなる場合があります
- ブラウザのCookieを使用してデータを取得します（パスワード等は保存しません）
- Gemini APIキーはブラウザのローカルストレージに保存されます

---

## 📝 作者

[@Gajamarunosuke](https://x.com/Gajamarunosuke) / [note](https://note.com/brainy_quince872)

このツールの詳しい使い方・導入サポートは [有料note](https://note.com/brainy_quince872) で解説しています。

---

## 📄 ライセンス

MIT License — 個人・商用問わず自由に使用・改変・再配布できます。
