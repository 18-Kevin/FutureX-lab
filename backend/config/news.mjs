const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_AGE_MS = 7 * DAY_MS;
const STALE_AFTER_MS = 20 * 60 * 60 * 1000;

const FEEDS = [
  { source: 'BBC News', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', fallbackCategory: 'internet' },
  { source: 'BBC Business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml', fallbackCategory: 'business' },
  { source: 'BBC Technology', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', fallbackCategory: 'ai' },
  { source: 'The New York Times', url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', fallbackCategory: 'internet' },
  { source: 'The New York Times', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml', fallbackCategory: 'business' },
  { source: 'The New York Times', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml', fallbackCategory: 'ai' },
  { source: 'The Guardian', url: 'https://www.theguardian.com/world/rss', fallbackCategory: 'internet' },
  { source: 'The Guardian', url: 'https://www.theguardian.com/business/rss', fallbackCategory: 'business' },
  { source: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml', fallbackCategory: 'internet' },
  { source: 'TechCrunch', url: 'https://techcrunch.com/category/artificial-intelligence/feed/', fallbackCategory: 'ai' }
];

const CATEGORY_RULES = [
  { category: 'ecommerce', pattern: /e-?commerce|retail|\bamazon\b|walmart|shopify|flipkart|online shopping|marketplace|checkout|payment|paytm|zomato|airbnb|uber/i },
  { category: 'ai', pattern: /\bAI\b|artificial intelligence|openai|chatgpt|anthropic|deepmind|\bLLM\b|chatbot|machine learning|generative|neural|robot|grok|claude|gemini/i },
  { category: 'internet', pattern: /social media|tiktok|instagram|facebook|youtube|twitter|\bweb\b|internet|cyber|privacy|online|streaming|broadband|5G|browser|spam|scam/i },
  { category: 'business', pattern: /market|econom|company|stock|bank|trade|inflation|startup|invest|earnings|merger|acquisition|\bCEO\b|revenue|jobs|global south/i }
];

const PER_CATEGORY_LIMIT = 5;
const TOTAL_LIMIT = 16;

const TOPIC_RULES = [
  { id: 'privacy', label: 'Privacy & data', pattern: /privacy|data protection|GDPR|consent|surveillance|cookies?|tracking/i },
  { id: 'security', label: 'Cybersecurity', pattern: /cyber|hack|breach|malware|ransomware|scam|phishing|vulnerab|security/i },
  { id: 'ai', label: 'AI & models', pattern: /\bAI\b|artificial intelligence|openai|chatgpt|anthropic|deepmind|\bLLM\b|chatbot|machine learning|generative|neural|gemini|claude|grok|copilot/i },
  { id: 'regulation', label: 'Regulation & policy', pattern: /regulat|\blaws?\b|antitrust|complian|govern|senate|parliament|commission|\bact\b|court|ruling|sanction/i },
  { id: 'markets', label: 'Markets & business', pattern: /market|stock|earnings|revenue|econom|inflation|\bbank\b|trade\b|invest|startup|IPO|merger|acquisition/i },
  { id: 'social', label: 'Social platforms', pattern: /tiktok|instagram|facebook|youtube|twitter|social media|influencer|creator/i },
  { id: 'ecommerce', label: 'E-commerce', pattern: /e-?commerce|retail|amazon|walmart|shopify|flipkart|online shopping|checkout/i },
  { id: 'chips', label: 'Chips & hardware', pattern: /semiconductor|nvidia|tsmc|\bGPU\b|\bchips?\b|processor/i },
  { id: 'world', label: 'World & geopolitics', pattern: /war\b|israel|gaza|ukraine|russia|china|election|protest|migrat|government|military|diplomat|border|trump|netanyahu|ceasefire/i },
  { id: 'tech', label: 'Tech & internet', pattern: /\bapp\b|platform|software|digital|online|internet|google|microsoft|apple|browser|streaming|smartphone/i }
];

let cache = { updated: null, items: [] };
let previousItems = [];
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

function extractImage(block, descriptionHtml) {
  const patterns = [
    /<media:thumbnail[^>]+url=["']([^"']+)["']/i,
    /<media:content[^>]+url=["']([^"']+)["']/i,
    /<enclosure[^>]+url=["']([^"']+)["']/i,
    /<img[^>]+src=["']([^"']+)["']/i
  ];
  for (const pattern of patterns) {
    const match = descriptionHtml.match(pattern) || block.match(pattern);
    if (match && /^https?:\/\//i.test(match[1])) return match[1];
  }
  return '';
}

function classify(text, fallbackCategory) {
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(text)) return rule.category;
  }
  return fallbackCategory;
}

function parseFeed(xml, feed) {
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  const items = [];

  for (const block of blocks) {
    let title = decodeEntities(xmlTag(block, 'title'));
    const url = decodeEntities(xmlTag(block, 'link'));
    const pubDate = xmlTag(block, 'pubDate');
    const descriptionHtml = decodeEntities(xmlTag(block, 'description'));
    const sourceMatch = block.match(/<source[^>]*url="([^"]*)"[^>]*>([\s\S]*?)<\/source>/);

    if (sourceMatch) {
      const taggedSource = decodeEntities(sourceMatch[2]);
      if (taggedSource && title.endsWith(` - ${taggedSource}`)) {
        title = title.slice(0, -(taggedSource.length + 3)).trim();
      }
    }

    const published = new Date(pubDate);
    if (!title || !url || Number.isNaN(published.getTime())) continue;
    if (Date.now() - published.getTime() > MAX_AGE_MS) continue;

    const summaryMatch = descriptionHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const summary = summaryMatch
      ? decodeEntities(summaryMatch[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ')
      : '';

    const plainText = `${title} ${summary}`;
    items.push({
      category: classify(plainText, feed.fallbackCategory),
      title,
      url,
      source: feed.source,
      published: published.toISOString(),
      image: extractImage(block, descriptionHtml),
      summary: summary.slice(0, 260)
    });
  }

  return items;
}

async function fetchFeed(feed) {
  const response = await fetch(feed.url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) FutureXLab/1.0' },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`status ${response.status}`);
  const xml = await response.text();
  return parseFeed(xml, feed);
}

export async function refreshNews() {
  if (refreshing) return refreshing;

  refreshing = (async () => {
    try {
      const results = await Promise.all(
        FEEDS.map((feed) => fetchFeed(feed).catch((error) => {
          console.error('News feed failed:', feed.source, error.message);
          return [];
        }))
      );

      const all = results.flat();
      const categories = ['ai', 'business', 'ecommerce', 'internet'];
      const selected = [];

      for (const category of categories) {
        const categoryItems = all
          .filter((item) => item.category === category)
          .sort((a, b) => Date.parse(b.published) - Date.parse(a.published));

        const sourceFirst = new Map();
        for (const item of categoryItems) {
          if (!sourceFirst.has(item.source)) sourceFirst.set(item.source, item);
        }

        const picked = [...sourceFirst.values()];
        const localCount = {};
        picked.forEach((item) => {
          localCount[item.source] = 1;
        });

        if (picked.length < PER_CATEGORY_LIMIT) {
          for (const item of categoryItems) {
            if (picked.length >= PER_CATEGORY_LIMIT) break;
            if (picked.includes(item)) continue;
            if ((localCount[item.source] || 0) >= 2) continue;
            picked.push(item);
            localCount[item.source] = (localCount[item.source] || 0) + 1;
          }
        }

        picked.sort((a, b) => Date.parse(b.published) - Date.parse(a.published));
        selected.push(...picked.slice(0, PER_CATEGORY_LIMIT));
      }

      const seen = new Set();
      const sourceCount = {};
      const items = selected
        .sort((a, b) => Date.parse(b.published) - Date.parse(a.published))
        .filter((item) => {
          const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
          if (!key || seen.has(key)) return false;
          if ((sourceCount[item.source] || 0) >= 4) return false;
          seen.add(key);
          sourceCount[item.source] = (sourceCount[item.source] || 0) + 1;
          return true;
        })
        .slice(0, TOTAL_LIMIT);

      if (items.length) {
        previousItems = cache.items;
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

export async function getSignals() {
  await getNews();

  const current = cache.items || [];
  const previous = previousItems || [];
  const byNewest = (a, b) => Date.parse(b.published) - Date.parse(a.published);

  const topics = TOPIC_RULES.map((rule) => {
    const match = (item) => rule.pattern.test(`${item.title} ${item.summary}`);
    const matched = current.filter(match).sort(byNewest);
    const prevCount = previous.filter(match).length;
    const top = matched[0];

    return {
      id: rule.id,
      label: rule.label,
      count: matched.length,
      delta: previous.length ? matched.length - prevCount : null,
      headline: top ? top.title : '',
      source: top ? top.source : '',
      url: top ? top.url : '',
      published: top ? top.published : '',
      summary: top ? top.summary : ''
    };
  })
    .filter((topic) => topic.count > 0)
    .sort((a, b) => b.count - a.count || Date.parse(b.published || 0) - Date.parse(a.published || 0));

  return { updated: cache.updated, total: current.length, topics };
}

function scheduleISTMidnightRefresh() {
  const now = Date.now();
  const utcNow = new Date();
  let next = Date.UTC(utcNow.getUTCFullYear(), utcNow.getUTCMonth(), utcNow.getUTCDate(), 18, 30, 0, 0);
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
