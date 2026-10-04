const GOOGLE_NEWS_URL = 'https://news.google.com/rss/search';
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_AGE_MS = 3 * DAY_MS;
const STALE_AFTER_MS = 20 * 60 * 60 * 1000;

const CATEGORIES = [
  { category: 'ai', query: 'artificial intelligence when:1d' },
  { category: 'business', query: 'business economy markets when:1d' },
  { category: 'ecommerce', query: 'e-commerce OR ecommerce when:1d' },
  { category: 'internet', query: 'social media internet platforms when:1d' }
];

const PER_CATEGORY_LIMIT = 5;
const TOTAL_LIMIT = 16;

let cache = { updated: null, items: [] };
let refreshing = null;

function decodeEntities(text) {
  return String(text || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, '')
    .replace(/&hellip;/g, '...')
    .trim();
}

function xmlTag(block, name) {
  const match = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`));
  return match ? match[1].trim() : '';
}

function parseItems(xml, category) {
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  const items = [];

  for (const block of blocks) {
    let title = decodeEntities(xmlTag(block, 'title'));
    const url = decodeEntities(xmlTag(block, 'link'));
    const pubDate = xmlTag(block, 'pubDate');
    const descriptionHtml = decodeEntities(xmlTag(block, 'description'));
    const sourceMatch = block.match(/<source[^>]*url="([^"]*)"[^>]*>([\s\S]*?)<\/source>/);
    let source = sourceMatch ? decodeEntities(sourceMatch[2]) : '';

    if (source && title.endsWith(` - ${source}`)) {
      title = title.slice(0, -(source.length + 3)).trim();
    }
    if (!source) source = 'Google News';

    const published = new Date(pubDate);
    if (!title || !url || Number.isNaN(published.getTime())) continue;
    if (Date.now() - published.getTime() > MAX_AGE_MS) continue;

    let image = '';
    const imgMatch = descriptionHtml.match(/<img[^>]+src=["']([^"']+)["']/i)
      || descriptionHtml.match(/url=(https?:[^&\s"']+)/i);
    if (imgMatch) image = imgMatch[1];
    if (!image) {
      const mediaMatch = block.match(/<media:content[^>]+url=["']([^"']+)["']/i);
      if (mediaMatch) image = mediaMatch[1];
    }

    const summaryMatch = descriptionHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const summary = summaryMatch
      ? decodeEntities(summaryMatch[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ')
      : '';

    items.push({
      category,
      title,
      url,
      source,
      published: published.toISOString(),
      image: /^https?:\/\//i.test(image) ? image : '',
      summary: summary.slice(0, 240)
    });
  }

  return items;
}

export async function refreshNews() {
  if (refreshing) return refreshing;

  refreshing = (async () => {
    try {
      const results = [];

      for (const feed of CATEGORIES) {
        try {
          const url = `${GOOGLE_NEWS_URL}?q=${encodeURIComponent(feed.query)}&hl=en-IN&gl=IN&ceid=IN:en`;
          const response = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) FutureXLab/1.0' },
            signal: AbortSignal.timeout(15000)
          });
          if (!response.ok) throw new Error(`status ${response.status}`);
          const xml = await response.text();
          const categoryItems = parseItems(xml, feed.category)
            .sort((a, b) => Date.parse(b.published) - Date.parse(a.published))
            .slice(0, PER_CATEGORY_LIMIT);
          results.push(...categoryItems);
        } catch (error) {
          console.error('News feed failed:', feed.category, error.message);
        }
      }

      const seen = new Set();
      const items = results
        .sort((a, b) => Date.parse(b.published) - Date.parse(a.published))
        .filter((item) => {
          const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, TOTAL_LIMIT);

      if (items.length) {
        cache = { updated: new Date().toISOString(), items };
      }
      return cache;
    } finally {
      refreshing = null;
    }
  })();

  return refreshing;
}

export async function getNews() {
  const age = cache.updated ? Date.now() - Date.parse(cache.updated) : Infinity;

  if (!cache.items.length && !refreshing) {
    await refreshNews().catch(() => cache);
  } else if (age > STALE_AFTER_MS && !refreshing) {
    refreshNews().catch(() => {});
  }

  return cache;
}

function scheduleISTMidnightRefresh() {
  const now = Date.now();
  let next = Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
    18, 30, 0, 0
  );
  if (next <= now) next += DAY_MS;

  setTimeout(async () => {
    await refreshNews().catch(() => {});
    setInterval(() => refreshNews().catch(() => {}), DAY_MS);
  }, next - now);
}

export function startNewsScheduler() {
  refreshNews().catch((error) => console.error('Initial news refresh failed:', error.message));
  scheduleISTMidnightRefresh();
}
