# FutureX Lab — How the analysis works

This document explains what the FutureX Lab tools do, what they can and cannot know, and how your data is handled. It applies to the website trust tools, the AI detection tools, and the Chrome extension (Trust Lens).

## What happens when you run an analysis

1. **You submit content** — pasted text, a page/selection/URL (extension), a file (detection), or a URL to a policy page.
2. **The request goes to the backend** (`POST /api/analyze`) with your analysis type and content (15,000 character limit).
3. **If you submitted a URL**, the backend fetches the page text itself (public `http`/`https` pages only — localhost and private-network addresses are refused, redirects are re-checked, size and time capped). Whether the fetch succeeded is recorded and shown in the result.
4. **A large language model** reviews the content against a strict, type-specific output shape: score, verdict, confidence, signals, evidence, findings (with the exact clause, why it matters, real-world impact, and what to do), and recommendations.
5. **The result is returned** with explicit limitations, and rendered with score, verdict, explanations, evidence, and the model's stated confidence.

## What each result contains

| Field | Meaning |
|---|---|
| **Score / verdict** | The model's assessment for the chosen analysis type (trust tools: risk of the content; detection tools: likelihood AI-generated). |
| **Confidence** | The model's own uncertainty statement (e.g. `Moderate (about 65%)`). Shown only when the model provides it; hidden for offline results. |
| **Signals** | Short, specific observations quoting your content. |
| **Evidence** | Concrete indicators the model says it actually observed. Never invented; hidden if none. |
| **Findings** | The detailed explanations: severity, the exact clause (or a clear paraphrase), why it matters, impact on you, and what to do. |
| **Limitations** | What was *not* analyzed: whether a URL fetch succeeded, whether an offline keyword fallback ran, that no external links or sources were verified, and the model's own added caveats. |

## Honest limits (please read)

- **This is automated AI pattern analysis — not legal, security, or financial advice, and not proof.** Stylometric "AI vs human" detection is probabilistic, not proof of authorship.
- **Only what you submit is analyzed.** Pages are fetched only when you provide a URL; dynamic content, linked pages, and external sources are not visited or verified.
- **The model can be wrong**, especially on thin, ambiguous, or truncated content — which is exactly why confidence and limitations are displayed instead of false certainty.
- **Offline fallback:** if the AI API is unreachable, the website's scam/contract tools may run a local keyword-pattern check. Offline results are labelled as such (they never claim an AI model reviewed them) and are excluded from confidence display.
- **Rate limit:** 15 analyses per minute per IP (shared between website and extension).

## Privacy

- **No API keys exist in the website or the extension.** All model calls happen server-side; the extension never holds secrets.
- **History is local only:** website recent scans use `localStorage`; extension history uses `chrome.storage.local` (last 50). Nothing is synced or sent anywhere for history.
- **Authentication is optional** for analysis: you can use the tools without an account.
- **No content is stored** by the analysis endpoint beyond what is needed to produce the response.

## Security

- **CORS** allowlists only the production site, local dev origins, and the pinned extension ID (`epebmappddkmmlbieakhafhopbjibbnh`, fixed via the manifest `key`) — other origins are refused.
- **URL fetching is SSRF-guarded:** `http`/`https` only, direct-IP and private/loopback/link-local targets refused, DNS resolved and re-checked, redirects limited to 3 hops and re-validated per hop, 8 s timeout, 1.5 MB cap.
- **Rate limiting** on all API routes; body size limits; strict output validation and normalization on every model response.
- **Extension permissions** are minimal: active tab, storage, context menus, and host access to the backend.

## Files

- Website: `website/index.html` (trust + detection tools, history, news/signals)
- Backend: `backend/routes/analysis.mjs` (prompts, URL fetching, validation)
- Extension: `extension/` (see `extension/README.md` for loading and usage)
