import express from 'express';
import { optionalAuth } from '../middleware/auth.mjs';
import { chatLimiter } from '../middleware/rateLimiter.mjs';
import { aiEnabled, groqChat } from '../config/ai.mjs';

const router = express.Router();

const SYSTEM_PROMPT =
  'You are the helpful FutureX Lab AI assistant known as the Lab Guide. ' +
  'Help visitors understand AI and technology, privacy and trust, FutureX Lab research, and digital innovation. ' +
  'Keep replies short (2-4 sentences), simple, and friendly. ' +
  'FutureX Lab is a trust-and-safety research site with free tools: a scam message checker, a contract reviewer, ' +
  'a privacy policy scanner, an AI-content detector, and a Chrome extension. ' +
  'Never invent prices, dates, or claims. If you do not know something, say so plainly.';

function offlineReply(message = '') {
  const m = message.toLowerCase();
  if (/\b(hello|hi|hey|good (morning|afternoon|evening))\b/.test(m)) {
    return 'Hello! I am the Lab Guide. My AI brain is offline right now, but every scanner still works — try the Scam Shield, Contract Reviewer, or Privacy Inspector tabs.';
  }
  if (/(scam|phish|spam|fraud|suspicious)/.test(m)) {
    return 'My AI brain is offline right now, but the Scam Shield works without me: paste the suspicious message into the Scam Shield tab and press Analyze. It checks urgency tricks, fake links, money requests, and known scam patterns.';
  }
  if (/(contract|lease|rent|clause|terms)/.test(m)) {
    return 'The Contract Reviewer is still online: paste the document text into that tab and press Analyze. It flags deposit forfeiture, auto-renewal, arbitration, waivers, and one-sided clauses.';
  }
  if (/(privacy|policy|data collection|gdpr)/.test(m)) {
    return 'The Privacy Inspector is still online: paste a privacy policy or its URL into that tab and press Analyze. It scores data collection, third-party sharing, retention, and opt-out controls.';
  }
  if (/(detect|ai[- ]written|chatgpt|written by ai|humaniz)/.test(m)) {
    return 'My AI brain is offline, but the Text Inspector runs anyway — paste text into the Detection Lab tab and press Inspect text for an AI-generation signal read.';
  }
  if (/(extension|chrome|browser)/.test(m)) {
    return 'The FutureX Chrome extension brings the same checks into your browser so you can scan messages and pages without leaving them. Check the Extension section of this site for details.';
  }
  if (/(free|price|cost|pay|subscription)/.test(m)) {
    return 'All FutureX Lab tools are free to use — no card required. Your scans run right here on the site.';
  }
  if (/(who|what).*(futurex|lab)|about you/.test(m)) {
    return 'FutureX Lab is a trust-and-safety research project building free tools that show how safe messages, documents, policies, and media are — explained in plain language.';
  }
  return 'I could not reach the AI service right now, but every scanner still works. Try the Scam Shield, Contract Reviewer, Privacy Inspector, or Text Inspector tabs — they run locally and do not need me.';
}

router.post('/chat', chatLimiter, optionalAuth, async (req, res) => {
  try {
    const userMessage = typeof req.body?.message === 'string' ? req.body.message.trim() : '';

    if (!userMessage) {
      return res.status(400).json({ reply: 'Please type a message first.' });
    }
    if (userMessage.length > 4000) {
      return res.status(400).json({ reply: 'That message is too long — please keep it under 4,000 characters.' });
    }

    if (!aiEnabled()) {
      return res.json({ reply: offlineReply(userMessage), offline: true });
    }

    const clientSystem = typeof req.body?.system === 'string' && req.body.system.trim()
      ? req.body.system.trim()
      : '';

    let reply = '';
    try {
      reply = await groqChat([
        { role: 'system', content: clientSystem ? `${SYSTEM_PROMPT} ${clientSystem}` : SYSTEM_PROMPT },
        { role: 'user', content: userMessage }
      ], { temperature: 0.7 });
    } catch (error) {
      console.error('Chat AI failed:', error.message, error.detail || '');
    }

    if (!reply) {
      return res.json({ reply: offlineReply(userMessage), offline: true });
    }

    res.json({ reply });
  } catch (error) {
    console.error('Chat error:', error);
    res.json({ reply: offlineReply(typeof req.body?.message === 'string' ? req.body.message : ''), offline: true });
  }
});

export default router;
