'use strict';

const FX = (() => {
  const PROD_API = 'https://futurex-lab-api.onrender.com';
  const MAX_CONTENT = 15000;
  const HISTORY_LIMIT = 50;
  const ALLOWED_TYPES = ['privacy', 'terms', 'platform', 'scam', 'contract', 'text'];
  const TYPE_LABELS = {
    scam: 'Scam & misleading claims',
    text: 'AI text detection',
    privacy: 'Privacy policy',
    terms: 'Terms & conditions',
    platform: 'App / platform policy',
    contract: 'Contract review'
  };
  const SCORE_MEANING = {
    scam: 'Higher = more likely a scam',
    contract: 'Higher = more predatory',
    privacy: 'Higher = safer for you',
    terms: 'Higher = safer for you',
    platform: 'Higher = safer for you',
    text: 'Higher = more likely AI-generated'
  };
  const RISK_HIGH = ['scam', 'contract'];
  const SAFETY_HIGH = ['privacy', 'terms', 'platform'];

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }

  function verdictLevel(value) {
    const v = String(value || '').toUpperCase();
    if (/INCONCLUSIVE|SUSPICIOUS|CAUTION/.test(v)) return 'warn';
    if (/SAFE|LOW RISK|FAIR|HUMAN/.test(v)) return 'safe';
    if (!v) return 'warn';
    return 'danger';
  }

  function scoreColor(type, verdict, score) {
    const level = verdictLevel(verdict);
    if (verdict) return level === 'safe' ? '#0e9f7a' : level === 'warn' ? '#d99032' : '#e05a6a';
    if (RISK_HIGH.includes(type)) return score >= 70 ? '#e05a6a' : score >= 40 ? '#d99032' : '#0e9f7a';
    if (SAFETY_HIGH.includes(type)) return score >= 75 ? '#0e9f7a' : score >= 55 ? '#d99032' : '#e05a6a';
    return '#8a86c8';
  }

  async function getApiBase() {
    try {
      const stored = await chrome.storage.local.get('apiBase');
      if (stored.apiBase === 'local') return 'http://localhost:3000';
    } catch { /* storage unavailable */ }
    return PROD_API;
  }

  async function setApiBase(value) {
    try {
      if (value === 'local') await chrome.storage.local.set({ apiBase: 'local' });
      else await chrome.storage.local.remove('apiBase');
    } catch { /* storage unavailable */ }
  }

  function truncate(text) {
    const str = String(text || '');
    if (str.length <= MAX_CONTENT) return str;
    const head = str.slice(0, MAX_CONTENT - 400);
    const tail = str.slice(-380);
    return `${head}\n\n[... content truncated at ${MAX_CONTENT} characters ...]\n\n${tail}`;
  }

  async function analyze({ type, content, mode, url }) {
    if (!ALLOWED_TYPES.includes(type)) {
      return { ok: false, error: 'Choose a supported analysis type.', status: 0 };
    }
    const text = String(content || '').trim();
    if (!text) {
      return { ok: false, error: 'There is no content to analyze.', status: 0 };
    }

    const base = await getApiBase();
    const body = { type, content: truncate(text) };
    if (url && /^https?:\/\//i.test(url)) body.url = url.slice(0, 2048);

    let response;
    try {
      response = await fetch(`${base}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch {
      return {
        ok: false,
        error: `Could not reach the FutureX Lab API at ${base}. Check your connection, or switch the API target in Settings.`,
        status: 0
      };
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch { /* non-JSON response handled below */ }

    if (response.status === 429) {
      let waitText = ' Try again in under a minute.';
      const retry = response.headers.get('Retry-After');
      const reset = Number(response.headers.get('RateLimit-Reset') || 0);
      if (retry) waitText = ` Try again in ${retry}s.`;
      else if (reset > 0) {
        const secs = reset > 1e9 ? Math.max(1, Math.ceil(reset - Date.now() / 1000)) : Math.ceil(reset);
        waitText = ` Try again in ~${secs}s.`;
      }
      return {
        ok: false,
        error: `Rate limit reached (15 analyses per minute, shared with the website).${waitText}`,
        status: 429
      };
    }
    if (response.status === 400) {
      return { ok: false, error: (payload && payload.error) || 'The request was rejected by the API.', status: 400 };
    }
    if (response.status === 503) {
      return { ok: false, error: (payload && payload.error) || 'The AI analysis service is temporarily offline.', status: 503 };
    }
    if (!response.ok || !payload || typeof payload.score !== 'number') {
      return { ok: false, error: (payload && payload.error) || `Analysis failed (HTTP ${response.status}).`, status: response.status };
    }

    payload.__mode = mode || '';
    payload.__type = type;
    return { ok: true, data: payload };
  }

  function limitationsFor(data) {
    const mode = String(data.__mode || '');
    const src = data.source && data.source.url ? data.source : null;
    let scope;
    if (src && src.fetched) {
      scope = `Scope: the page at ${src.url} was fetched by the backend and analyzed as a live snapshot at analysis time.`;
    } else if (src) {
      scope = `Scope: the URL ${src.url} could not be fetched (${src.note || 'no reason given'}) — only the text you submitted was analyzed.`;
    } else if (mode === 'page') {
      scope = 'Scope: the visible text extracted from this page at analysis time — dynamic content loaded later was not included.';
    } else if (mode === 'selection') {
      scope = 'Scope: only the text you selected was analyzed, not the full page.';
    } else if (mode === 'url') {
      scope = 'Scope: the URL text you submitted — the page itself was not fetched.';
    } else {
      scope = 'Scope: only the content you submitted was analyzed.';
    }
    const list = [
      scope,
      'This is an automated AI assessment provided for guidance — not legal, security or financial advice.',
      'No external links were opened and no independent sources were verified.'
    ];
    if (Array.isArray(data.limitations)) {
      data.limitations
        .filter((item) => typeof item === 'string' && item.trim())
        .slice(0, 4)
        .forEach((item) => list.push(item.trim()));
    }
    return list;
  }

  function renderResult(container, data) {
    const type = String(data.__type || 'scam');
    const score = Math.max(0, Math.min(100, Math.round(Number(data.score) || 0)));
    const verdict = String(data.verdict || '').toUpperCase();
    const level = verdictLevel(verdict);
    const color = scoreColor(type, verdict, score);
    const signals = Array.isArray(data.signals) ? data.signals : [];
    const findings = Array.isArray(data.findings) ? data.findings : [];
    const recs = (Array.isArray(data.recommendations) ? data.recommendations : [])
      .filter((item) => typeof item === 'string' && item.trim()).slice(0, 6);
    const evidence = (Array.isArray(data.evidence) ? data.evidence : [])
      .filter((item) => typeof item === 'string' && item.trim()).slice(0, 8);

    const parts = [];

    parts.push(`
      <div class="fx-score-head">
        <div class="fx-score-num" style="color:${color}">${score}<span>/100</span></div>
        <div class="fx-score-side">
          ${verdict ? `<span class="fx-verdict ${level}">${escapeHtml(verdict)}</span>` : ''}
          <span class="fx-meaning">${escapeHtml(SCORE_MEANING[type] || '')}</span>
        </div>
      </div>
      <div class="fx-bar"><i style="width:${score}%;background:${color}"></i></div>`);

    if (data.confidence) {
      parts.push(`<p class="fx-confidence"><b>Model confidence:</b> ${escapeHtml(data.confidence)}</p>`);
    }
    parts.push(`<h3 class="fx-title">${escapeHtml(data.title || 'Analysis complete')}</h3>`);
    if (data.description) parts.push(`<p class="fx-desc">${escapeHtml(data.description)}</p>`);

    if (data.watermark && typeof data.watermark === 'object') {
      const wmStatus = ['DETECTED', 'POSSIBLE', 'NONE'].includes(String(data.watermark.status).toUpperCase())
        ? String(data.watermark.status).toUpperCase() : 'NONE';
      const wmDetails = (Array.isArray(data.watermark.details) ? data.watermark.details : [])
        .filter((item) => typeof item === 'string' && item.trim()).join(' ');
      parts.push(`<div class="fx-row"><b>Watermark:</b> <span class="fx-wm ${wmStatus.toLowerCase()}">${wmStatus}</span> ${escapeHtml(wmDetails || 'No watermark indicators found.')}</div>`);
    }
    if (data.provenance) {
      parts.push(`<div class="fx-row"><b>Provenance (model assessment):</b> ${escapeHtml(data.provenance)}</div>`);
    }
    if (evidence.length) {
      parts.push(`<div class="fx-block"><p class="fx-label">Evidence observed</p><ul class="fx-list">${evidence.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>`);
    }

    if (signals.length) {
      parts.push(`<div class="fx-block"><p class="fx-label">Signals</p><div class="fx-signals">${signals.map((signal) => {
        const kind = ['good', 'warn', 'bad'].includes(signal[0]) ? signal[0] : 'warn';
        const icon = kind === 'good' ? '✓' : kind === 'warn' ? '!' : '×';
        return `<div class="fx-signal ${kind}"><span class="fx-signal-icon">${icon}</span><div><b>${escapeHtml(signal[1] || '')}</b><p>${escapeHtml(signal[2] || '')}</p></div></div>`;
      }).join('')}</div></div>`);
    }

    if (findings.length) {
      parts.push(`<div class="fx-block"><p class="fx-label">Detailed findings (${findings.length})</p><div class="fx-findings">${findings.map((finding) => {
        const sev = ['critical', 'high', 'medium', 'low'].includes(finding.severity) ? finding.severity : 'medium';
        const meta = [];
        if (finding.why) meta.push(`<p><b>Why it matters:</b> ${escapeHtml(finding.why)}</p>`);
        if (finding.impact) meta.push(`<p><b>Impact on you:</b> ${escapeHtml(finding.impact)}</p>`);
        if (finding.action) meta.push(`<p><b>What to do:</b> ${escapeHtml(finding.action)}</p>`);
        return `<details class="fx-finding"><summary><span class="fx-sev ${sev}">${sev}</span>${escapeHtml(finding.title || 'Finding')}</summary>
          <div class="fx-finding-body">${finding.clause ? `<p class="fx-clause">“${escapeHtml(finding.clause)}”</p>` : ''}${meta.join('')}</div></details>`;
      }).join('')}</div></div>`);
    }

    if (recs.length) {
      parts.push(`<div class="fx-block"><p class="fx-label">What you should do</p><ul class="fx-recs">${recs.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>`);
    }

    parts.push(`<div class="fx-limits"><p class="fx-label">Limitations</p><ul>${limitationsFor(data).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>`);

    container.innerHTML = parts.join('');
  }

  async function loadHistory() {
    try {
      const stored = await chrome.storage.local.get('history');
      return Array.isArray(stored.history) ? stored.history : [];
    } catch {
      return [];
    }
  }

  async function saveHistory(entry) {
    try {
      const items = await loadHistory();
      items.unshift(entry);
      await chrome.storage.local.set({ history: items.slice(0, HISTORY_LIMIT) });
    } catch { /* storage unavailable */ }
  }

  async function clearHistory() {
    try {
      await chrome.storage.local.remove('history');
    } catch { /* storage unavailable */ }
  }

  function formatTime(ts) {
    try {
      return new Date(ts).toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
      });
    } catch {
      return '';
    }
  }

  function newId() {
    return `fx${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  return {
    PROD_API,
    ALLOWED_TYPES,
    TYPE_LABELS,
    escapeHtml,
    verdictLevel,
    getApiBase,
    setApiBase,
    analyze,
    renderResult,
    loadHistory,
    saveHistory,
    clearHistory,
    formatTime,
    newId
  };
})();
