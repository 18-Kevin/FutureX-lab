'use strict';

(() => {
  const $ = (sel) => document.querySelector(sel);

  function showError(message) {
    $('#errorBox').hidden = false;
    $('#errorBox').textContent = message;
    $('#loading').hidden = true;
  }

  function showResult(data, target, ts) {
    if (target && (target.url || target.title)) {
      $('#pageCtx').hidden = false;
      $('#ctxTitle').textContent = target.title || 'Analyzed content';
      $('#ctxUrl').textContent = target.url || '';
      $('#ctxUrl').title = target.url || '';
    }
    FX.renderResult($('#resultBody'), data);
    $('#resultTarget').textContent = (target && (target.title || target.url)) || 'Analysis';
    $('#resultTime').textContent = FX.formatTime(ts || Date.now());
    $('#result').hidden = false;
    $('#loading').hidden = true;
  }

  async function runPending(id) {
    const key = `req:${id}`;
    const stored = await chrome.storage.local.get(key);
    const request = stored[key];
    if (!request) {
      showError('This analysis request has expired. Right-click the page or selection again to start a new one.');
      return;
    }
    await chrome.storage.local.remove(key);

    if (request.blocked) {
      showError(request.blocked);
      return;
    }

    if (request.target && (request.target.url || request.target.title)) {
      $('#pageCtx').hidden = false;
      $('#ctxTitle').textContent = request.target.title || request.target.url;
      $('#ctxUrl').textContent = request.target.url || '';
    }

    const started = Date.now();
    const outcome = await FX.analyze(request);
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

  async function showHistoryItem(id) {
    const items = await FX.loadHistory();
    const item = items.find((entry) => entry.id === id);
    if (!item) {
      showError('This saved analysis is no longer available.');
      return;
    }
    $('#loading').hidden = true;
    showResult(item.data, item.target, item.ts);
  }

  async function main() {
    const params = new URLSearchParams(location.search);
    const reqId = params.get('req');
    const histId = params.get('hist');

    if (reqId) {
      $('#loading').hidden = false;
      await runPending(reqId);
      return;
    }
    if (histId) {
      await showHistoryItem(histId);
      return;
    }
    showError('Nothing to analyze. Right-click a page, selection or link and choose “Analyze with FutureX Lab”.');
  }

  main();
})();
