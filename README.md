# WordStar ✦ 韓語星光單字遊戲

> 收集偶像小卡，背英文單字！

WordStar 是一款以**偶像小卡收集**包裝的英文單字學習 PWA。答對題目賺星星、抽卡收集角色，用遊戲的節奏把 **6,574 個單字**背起來。單一 HTML 檔、免安裝、可離線遊玩。

- 詞彙來源：**大考中心高中英文參考詞彙表**（六級完整收錄，共 6,574 字）
- 技術：純前端 vanilla JS，單檔 `word-star.html`，無建置流程，PWA + Service Worker 離線可用

---

## ✨ 主要功能

### 學習模式（舞台模式）
| 模式 | 玩法 |
|------|------|
| 🎤 打歌舞台 | 英文選中文 |
| ⭐ 星光大道 | 拼出單字 |
| 📢 宣傳通告 | 中文選英文 |
| 🎬 NG 重拍 | 針對錯題的針對性複習 |
| 📻 電台放送 | 聽力模式（TTS 發音） |
| 👑 年末大賞 | 複習錯題・高獎勵 |

- **TTS 單字發音**（Web Speech API），可選語音
- **例句提示**：全 6,574 個單字皆有「簡單／進階」兩句挖空例句，題目下方輪流出現（`sentences.json`）
- **每日任務**與星星經濟、連擊 Combo、等級成長

### 抽卡 / 小卡收集
- 稀有度 **N / R / SR / SSR**，可升星（★→★★★★★）
- 樣式變體：**✦ 閃卡 / ⚡ 動態 / 🎶 演出 / 🎪 限定（節慶）**
- 🎨 **繪卡（SP）**：稀有插畫版小卡，詳情頁滿版大圖、可點擊全螢幕欣賞；可與其他樣式疊加，並能切換「繪圖 / Q 版」
- 收藏圖鑑：依團體 / 稀有度 / 星等檢視
- 頭像可選任一張收藏卡（含繪卡）

### 對戰模式
- 格鬥風 PK / 演出對戰，含 BGM / 音效

### 登場團體
- **K-pop（虛構）**：BT7、4PINK、THRICE、LOST KIDZ、NuDenim、AESTHE、18-1、WE6、SERAPH1M、G-IDLE
- **動漫**：鬼滅隊、咒術高專、佛喬家族、烏野排球、雄英 A 班、湘北籃球、獵人協會
- **名人堂**：NBA 傳奇（籃球）、世界盃（2026 足球）、港星殿堂（港片黃金年代）

> 團體與角色皆為致敬性質的原創呈現。

---

## 🚀 執行方式

因為是 PWA（含 Service Worker 與相對路徑資源），建議用本地伺服器開啟：

```bash
python -m http.server 8080
```

然後瀏覽 <http://localhost:8080/word-star.html>。

> 亦可直接以 `file://` 開啟 `word-star.html` 測試畫面，但 Service Worker 不會註冊、部分行為不完整。
> 更新後看不到變化時，請 **Ctrl+Shift+R** 強制重整以避開 Service Worker 舊快取。

---

## 📁 專案結構

```
word-star.html   # 整個遊戲（HTML + CSS + JS 單檔）
sentences.json   # 全單字例句庫（word → {e:簡單, h:進階} 挖空例句）
manifest.json    # PWA manifest
sw.js            # Service Worker（離線快取）
icon-192.png     # App icon
icon-512.png     # App icon
art/             # 各團體繪卡插圖（art/<團體>/<index>.png）
audio/           # BGM 與音效（audio/、audio/sfx/）
```

---

## 🛠️ 開發備註

- 全部程式集中在 `word-star.html`，直接編輯即可，無需 build。
- 進度儲存在瀏覽器 `localStorage`（`wordstar_save`）。
- 繪卡插圖已去背處理（移除死切白邊 / 白暈 / 內凹白），透明底可直接疊在卡片背景上。
