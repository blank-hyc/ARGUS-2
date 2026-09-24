# ARGUS VisionEcho — 前後端版本

這個資料夾是獨立的新專案，沒有修改上層原本的檔案。

## 啟動

1. 在此資料夾建立 `.env`，內容可由 `.env.example` 複製而來。
2. 填入 `GEMINI_API_KEY`。沒有金鑰時，相機與導航介面仍可使用，但 AI 影像分析會顯示設定提示。
3. 執行：

```powershell
npm start
```

4. 開啟 `http://localhost:3000`。手機測試相機、麥克風與定位時，請以 HTTPS 網址部署，或使用同一台裝置的 localhost。

## 架構

- `public/`：瀏覽器前端（相機、TTS、語音辨識、定位、手勢）。
- `server.js`：Node.js 後端。Gemini 金鑰只存在伺服器環境變數；提供 `/api/analyze`、`/api/places` 與 `/api/health`。

不需要安裝第三方套件，Node.js 20+ 可直接執行。
