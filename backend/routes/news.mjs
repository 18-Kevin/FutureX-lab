import express from 'express';
import { aiEnabled, groqChat } from '../config/ai.mjs';
import { analysisLimiter } from '../middleware/rateLimiter.mjs';
import { getNews, getSignals } from '../config/news.mjs';

const router = express.Router();

function decodeEntities(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, '')
    .trim();
}

async function fetchArticleText(url) {
  if (!/^https:\/\//i.test(url)) return '';
  if (/news\.google\.com/i.test(url)) return '';

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) FutureXLab/1.0' },
      signal: AbortSignal.timeout(8000),
      redirect: 'follow'
    });
    if (!response.ok) return '';
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('html')) return '';

    const html = (await response.text()).slice(0, 400000);
    const metaMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
    const meta = metaMatch ? decodeEntities(metaMatch[1]) : '';

    const paragraphs = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
      .map((match) => decodeEntities(match[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim())
      .filter((text) => text.length > 70)
      .join(' ')
      .slice(0, 3500);

    return [meta, paragraphs].filter(Boolean).join('\n');
  } catch {
    return '';
  }
}

router.get('/', async (req, res) => {
  try {
    const news = await getNews();
    res.json(news);
  } catch (error) {
    console.error('News route error:', error.message);
    res.status(500).json({ error: 'News feed unavailable.' });
  }
});

router.get('/signals', async (req, res) => {
  try {
    const signals = await getSignals();
    res.json(signals);
  } catch (error) {
    console.error('Signals route error:', error.message);
    res.status(500).json({ error: 'Signals unavailable.' });
  }
});

router.post('/explain', analysisLimiter, async (req, res) => {
  try {
    const { title, source, date, summary, url } = req.body || {};

    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'A news title is required.' });
    }
    if (!aiEnabled()) {
      return res.status(503).json({ error: 'AI briefing is offline. Add a GROQ_API_KEY to the server .env file.' });
    }

    const articleText = await fetchArticleText(typeof url === 'string' ? url : '');

    const prompt = `Write a detailed, plain-English briefing about this news story for a general reader.

Structure the briefing in flowing paragraphs covering:
- What happened (the key confirmed facts)
- Why it matters
- Background and context the reader needs
- What could happen next

Rules:
- 300 to 450 words.
- Base it ONLY on the material provided below. Never invent names, numbers, quotes or events.
- If the material is thin, explain the confirmed facts plus their real-world significance, and note where details are still limited.
- Plain text paragraphs only. No markdown headings, no bullet lists, no JSON.

Headline: ${title}
Source: ${source || 'Unknown'}${date ? ` (published ${date})` : ''}
Feed summary: ${summary || 'Not provided'}
Article excerpt: ${articleText || 'Not available (the article page could not be read).'}`;

    let explanation = '';
    try {
      explanation = await groqChat([
        { role: 'system', content: 'You are a careful news analyst. You explain real news stories accurately and in depth, strictly from the material given. Plain text only.' },
        { role: 'user', content: prompt }
      ], { temperature: 0.4 });
    } catch (error) {
      console.error('News explain failed:', error.message, error.detail || '');
      return res.status(503).json({ error: 'The briefing service is temporarily unavailable.' });
    }

    res.json({ explanation: explanation.trim() });
  } catch (error) {
    console.error('News explain error:', error);
    res.status(500).json({ error: 'Server error while writing the briefing.' });
  }
});

export default router;
