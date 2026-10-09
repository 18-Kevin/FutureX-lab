'use strict';

const MENU_SELECTION = 'fx-select';
const MENU_PAGE = 'fx-page';
const MENU_LINK = 'fx-link';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_SELECTION, title: 'Analyze selection with FutureX Lab', contexts: ['selection'] });
    chrome.contextMenus.create({ id: MENU_PAGE, title: 'Analyze this page with FutureX Lab', contexts: ['page'] });
    chrome.contextMenus.create({ id: MENU_LINK, title: 'Analyze link with FutureX Lab', contexts: ['link'] });
  });
});

function extractPage() {
  return {
    title: document.title || '',
    url: location.href,
    text: (document.body && document.body.innerText ? document.body.innerText : '').slice(0, 14000)
  };
}

async function queueRequest(request) {
  const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const key = `req:${id}`;
  await chrome.storage.local.set({ [key]: request });
  await chrome.tabs.create({ url: chrome.runtime.getURL(`results.html?req=${id}`) });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === MENU_SELECTION) {
      const text = String(info.selectionText || '').trim();
      if (!text) return;
      const url = info.pageUrl || '';
      await queueRequest({
        type: 'scam',
        mode: 'selection',
        content: url && /^https?:/i.test(url) ? `Selected from: ${url}\n\n${text}` : text,
        target: { url, title: (tab && tab.title) || '', snippet: text.slice(0, 80) }
      });
      return;
    }

    if (info.menuItemId === MENU_LINK) {
      const link = String(info.linkUrl || '').trim();
      if (!link) return;
      const source = info.pageUrl || '';
      await queueRequest({
        type: 'scam',
        mode: 'url',
        content: `URL: ${link}${source ? `\nFound on: ${source}` : ''}`,
        target: { url: link, title: '', snippet: link.slice(0, 80) }
      });
      return;
    }

    if (info.menuItemId === MENU_PAGE) {
      const tabId = tab && tab.id;
      if (tabId == null) return;
      let page = null;
      try {
        const results = await chrome.scripting.executeScript({ target: { tabId }, func: extractPage });
        page = results && results[0] ? results[0].result : null;
      } catch {
        page = null;
      }
      if (!page || !page.text || !page.text.trim()) {
        await queueRequest({
          blocked: 'This page cannot be analyzed (browser and extension pages are restricted, or the page blocked script injection).',
          mode: 'page',
          type: 'scam',
          content: '',
          target: { url: (tab && tab.url) || '', title: (tab && tab.title) || '' }
        });
        return;
      }
      await queueRequest({
        type: 'scam',
        mode: 'page',
        content: `URL: ${page.url}\nTitle: ${page.title}\n--- VISIBLE PAGE TEXT ---\n${page.text}`,
        target: { url: page.url, title: page.title, snippet: page.text.trim().slice(0, 80) }
      });
    }
  } catch (err) {
    console.error('FutureX Lab context action failed:', err);
  }
});
