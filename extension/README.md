# FutureX Lab — Trust Lens (Chrome extension, Manifest V3)

Analyze the current page, selected text, or any URL for scams, misleading claims, and AI-generated content. All analysis runs on the existing FutureX Lab backend (`POST /api/analyze`) — the extension never holds API keys.

## Load the extension (Developer Mode)

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. Select this `extension/` folder (the one containing `manifest.json`).
5. Pin the extension: puzzle-piece icon → pin **FutureX Lab — Trust Lens**.

The extension ID is fixed by the `key` field in `manifest.json`:
`epebmappddkmmlbieakhafhopbjibbnh` — this exact origin is allowlisted in the backend CORS config.

## How to use it

- **Toolbar popup**
  - **This page** — extracts the visible text of the current tab and analyzes it.
  - **Selection** — analyzes the text you have selected on the page.
  - **URL** — analyzes a URL string (paste any URL, or uses the current page URL). The backend fetches the page's text when it can reach it; if it can't, only the URL string is analyzed and the result says so.
  - Pick an analysis type: scam & misleading claims (default), AI text detection, privacy policy, terms, app/platform, or contract review.
- **Right-click menu**
  - *Analyze selection with FutureX Lab* — on any selected text.
  - *Analyze this page with FutureX Lab* — on the page background.
  - *Analyze link with FutureX Lab* — on any link (analyzes the link URL plus the page it was found on).
  - Each opens a full-size results tab.
- **History tab** — the last 50 analyses, stored locally in `chrome.storage`. Nothing is synced anywhere.
- **Settings tab** — switch the API target between production and a local dev server (`localhost:3000`).

## Honest limitations (shown with every result)

- Analysis is an automated AI assessment for guidance, not legal, security, or financial advice.
- URL analysis: the backend fetches the page text (public http/https pages only — localhost and private-network addresses are refused). When a fetch fails, only the URL string itself is analyzed, and the Limitations block states this.
- Page analysis reads the visible text at click time; dynamically loaded content may be missing.
- No links are opened and no independent sources are verified.
- The model can add its own limitation notes; they are rendered under **Limitations**.

## API and limits

- Endpoint: `POST /api/analyze` with `{ type, content, url? }` (15,000 character limit; the extension truncates politely). `url` triggers the server-side page fetch.
- Rate limit: **15 analyses per minute per IP**, shared with the website. The popup shows a clear message when you hit it.
- No account or key required (the endpoint uses optional auth).

## Files

| File | Purpose |
|---|---|
| `manifest.json` | MV3 manifest, pinned `key`, permissions, host permissions |
| `background.js` | Context menus; queues page/selection/link analyses into a results tab |
| `common.js` | Shared API client, result renderer, history, limitations builder |
| `popup.html/css/js` | Toolbar popup (Analyze / History / Settings) |
| `results.html/css/js` | Full-size results tab (context-menu flow, history view) |
| `icons/` | 16/48/128 icons |

## Troubleshooting

- **“Could not reach the FutureX Lab API”** — check the API target in Settings; for local dev the backend must be running (`npm start` in `backend/`) and the extension origin must be in the server CORS list (it is, by default).
- **429 messages** — wait for the stated time; the limit is per IP and shared with the website.
- **“Browser pages cannot be analyzed”** — Chrome internal pages (`chrome://…`, the Chrome Web Store) block script injection; this is expected.
- After pulling updates, press the reload (↻) button on `chrome://extensions`.
