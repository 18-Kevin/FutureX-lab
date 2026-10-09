'use strict';

(() => {
  const $ = (sel) => document.querySelector(sel);

  let currentMode = 'page';
  let activeTab = null;
  let lastTarget = null;

  const typeOrder = ['scam', 'text', 'privacy', 'terms', 'platform', 'contract'];

  function showView(name) {
    $('#analyzeView').hidden = name !== 'analyze';
    $('#historyView').hidden = name !== 'history';
    $('#settingsView').hidden = name !== 'settings';
    $('#tabAnalyze').classList.toggle('active', name === 'analyze');
    $('#tabHistory').classList.toggle('active', name === 'history');
    $('#tabSettings').classList.toggle('active', name === 'settings');
  }

  function setMode(mode) {
    currentMode = mode;
    document.querySelectorAll('.mode-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    $('#urlRow').hidden = mode !== 'url';
    if (mode === 'url') $('#urlInput').focus();
  }

  function showError(message) {
    const box = $('#errorBox');
    box.hidden = !message;
    box.textContent = message || '';
  }

  function setLoading(on) {
    $('#loading').hidden = !on;
    $('#runBtn').disabled = on;
    $('#runBtn').textContent = on ? 'Analyzing…' : 'Run analysis';
  }

  async function getActiveTab() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      return tabs && tabs[0] ? tabs[0] : null;
    } catch {
      return null;
    }
  }

  function renderPageContext() {
    const title = (activeTab && activeTab.title) || 'Current page';
    let url = (activeTab && activeTab.url) || '';
    if (!url || url.startsWith('chrome://') || url.startsWith('edge://')) {
      url = url || 'Browser pages cannot be analyzed';
    }
    $('#ctxTitle').textContent = title.slice(0, 90);
    $('#ctxUrl').textContent = url;
    $('#ctxUrl').title = url;
  }

  async function inject(func) {
    const tabId = activeTab && activeTab.id;
    if (tabId == null) throw new Error('No active tab.');
    const results = await chrome.scripting.executeScript({ target: { tabId }, func });
    return results && results[0] ? results[0].result : null;
  }

  async function buildRequest() {
    const type = $('#typeSelect').value;

    if (currentMode === 'selection') {
      let text = '';
      try {
        text = await inject(() => (window.getSelection ? String(window.getSelection()) : ''));
      } catch {
        throw new Error('This page does not allow reading the selection (browser pages are restricted).');
      }
      text = String(text || '').trim();
      if (!text) throw new Error('Select some text on the page first, then press Run analysis.');
      const url = (activeTab && activeTab.url) || '';
      const content = url && /^https?:/i.test(url) ? `Selected from: ${url}\n\n${text}` : text;
      return {
        type,
        mode: 'selection',
        content,
        target: { url, title: (activeTab && activeTab.title) || '', snippet: text.slice(0, 80) }
      };
    }

    if (currentMode === 'url') {
      let url = $('#urlInput').value.trim();
      if (!url) url = (activeTab && activeTab.url) || '';
      if (!url) throw new Error('Enter a URL to analyze.');
      if (!/^https?:\/\//i.test(url) && !/^[\w-]+(\.[\w-]+)+/.test(url)) {
        throw new Error('That does not look like a valid URL.');
      }
      if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
      return {
        type,
        mode: 'url',
        content: `URL: ${url}`,
        url,
        target: { url, title: '', snippet: url.slice(0, 80) }
      };
    }

    let page = null;
    try {
      page = await inject(() => ({
        title: document.title || '',
        url: location.href,
        text: (document.body && document.body.innerText ? document.body.innerText : '').slice(0, 14000)
      }));
    } catch {
      throw new Error('This page cannot be analyzed (browser and extension pages are restricted).');
    }
    if (!page || !page.text || !page.text.trim()) {
      throw new Error('No readable text was found on this page.');
    }
    const content = `URL: ${page.url}\nTitle: ${page.title}\n--- VISIBLE PAGE TEXT ---\n${page.text}`;
    return {
      type,
      mode: 'page',
      content,
      target: { url: page.url, title: page.title, snippet: page.text.trim().slice(0, 80) }
    };
  }

  function showResult(data, target, ts) {
    FX.renderResult($('#resultBody'), data);
    $('#resultTarget').textContent = (target && (target.title || target.url)) || '';
    $('#resultTarget').title = (target && target.url) || '';
    $('#resultTime').textContent = ts ? FX.formatTime(ts) : FX.formatTime(Date.now());
    $('#result').hidden = false;
  }

  async function runAnalysis() {
    showError('');
    $('#result').hidden = true;

    let request;
    try {
      request = await buildRequest();
    } catch (err) {
      showError(err.message || String(err));
      return;
    }

    lastTarget = request.target;
    setLoading(true);
    const started = Date.now();
    const outcome = await FX.analyze(request);
    setLoading(false);

    if (!outcome.ok) {
      showError(outcome.error);
      return;
    }

    showResult(outcome.data, request.target, started);
    await FX.saveHistory({
      id: FX.newId(),
      ts: started,
      mode: request.mode,
      type: request.type,
      target: request.target,
      data: outcome.data
    });
  }

  async function renderHistory() {
    const items = await FX.loadHistory();
    $('#historyCount').textContent = `${items.length} saved scan${items.length === 1 ? '' : 's'}`;
    $('#historyEmpty').hidden = items.length > 0;
    const list = $('#historyList');
    list.innerHTML = items.map((item) => {
      const level = FX.verdictLevel(item.data && item.data.verdict);
      const label = (item.target && (item.target.title || item.target.url)) || 'Analysis';
      const meta = `${FX.TYPE_LABELS[item.type] || item.type} · ${FX.formatTime(item.ts)}`;
      return `<button class="history-item" type="button" data-id="${FX.escapeHtml(item.id)}">
        <span class="h-dot ${level}"></span>
        <span class="h-main">
          <span class="h-title">${FX.escapeHtml(label)}</span>
          <span class="h-meta">${FX.escapeHtml(meta)}${item.data && item.data.verdict ? ' · ' + FX.escapeHtml(item.data.verdict) : ''}</span>
        </span>
        <span class="h-score">${item.data ? Number(item.data.score) || 0 : 0}</span>
      </button>`;
    }).join('');
  }

  async function openHistoryItem(id) {
    const items = await FX.loadHistory();
    const item = items.find((entry) => entry.id === id);
    if (!item) return;
    showView('analyze');
    showError('');
    showResult(item.data, item.target, item.ts);
    $('#result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function init() {
    const select = $('#typeSelect');
    select.innerHTML = typeOrder
      .map((type) => `<option value="${type}">${FX.TYPE_LABELS[type]}</option>`)
      .join('');
    select.value = 'scam';

    activeTab = await getActiveTab();
    renderPageContext();

    document.querySelectorAll('.mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => setMode(btn.dataset.mode));
    });

    $('#tabAnalyze').addEventListener('click', () => showView('analyze'));
    $('#tabHistory').addEventListener('click', async () => { showView('history'); await renderHistory(); });
    $('#tabSettings').addEventListener('click', async () => {
      showView('settings');
      const base = await FX.getApiBase();
      $('#apiSelect').value = base === 'http://localhost:3000' ? 'local' : 'prod';
    });

    $('#runBtn').addEventListener('click', runAnalysis);
    $('#clearHistory').addEventListener('click', async () => {
      await FX.clearHistory();
      await renderHistory();
    });
    $('#historyList').addEventListener('click', (event) => {
      const item = event.target.closest('.history-item');
      if (item) openHistoryItem(item.dataset.id);
    });
    $('#apiSelect').addEventListener('change', (event) => FX.setApiBase(event.target.value));
    $('#urlInput').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') runAnalysis();
    });
  }

  init();
})();
