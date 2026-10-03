import express from 'express';
import { optionalAuth } from '../middleware/auth.mjs';
import { analysisLimiter } from '../middleware/rateLimiter.mjs';
import { aiEnabled, groqChat } from '../config/ai.mjs';

const router = express.Router();

const prompts = {
  privacy: (content) => `Analyze this privacy policy text or URL. Return a JSON object with: score (0-100 where higher is better for the user), title (string), description (string), signals (array of [kind, title, description] where kind is "good", "warn", or "bad"). Focus on: data collection, third-party sharing, user control, retention, and opt-out mechanisms.\n\nContent: ${content}`,
  terms: (content) => `Analyze these terms and conditions. Return a JSON object with: score (0-100 where higher is better for the user), title (string), description (string), signals (array of [kind, title, description] where kind is "good", "warn", or "bad"). Focus on: liability, arbitration, auto-renewal, content ownership, and user obligations.\n\nContent: ${content}`,
  platform: (content) => `Analyze this app or platform policy. Return a JSON object with: score (0-100 where higher is better for the user), title (string), description (string), signals (array of [kind, title, description] where kind is "good", "warn", or "bad"). Focus on: security, location access, tracking, user controls, and data practices.\n\nContent: ${content}`,
  text: (content) => `Analyze this text for signs of AI generation. Return a JSON object with: score (0-100 representing likelihood of AI-generated text), confidence (string), title (string), description (string). Consider: writing patterns, vocabulary, sentence structure, and common AI tells.\n\nText: ${content}`,
  image: (content) => `Analyze this image description for signs of AI generation or manipulation. Return a JSON object with: score (0-100 representing likelihood of AI-generated content), confidence (string), title (string), description (string). Consider: artifacts, inconsistencies, metadata signals.\n\nDescription: ${content}`,
  video: (content) => `Analyze this video description for signs of AI generation or manipulation. Return a JSON object with: score (0-100 representing likelihood of AI-generated content), confidence (string), title (string), description (string). Consider: frame consistency, audio-visual sync, temporal artifacts.\n\nDescription: ${content}`,
  scam: (content) => `Analyze this message for scam and phishing risk. Return a JSON object with: score (0-100 where higher means more likely a scam), verdict (one of "SAFE", "LOW RISK", "SUSPICIOUS", "DANGEROUS", "LIKELY MALICIOUS"), title (string), description (string), signals (array of [kind, title, description] where kind is "good", "warn", or "bad"). Identify scam patterns such as phishing, prize/lottery bait, romance scams, government impersonation, crypto investment fraud, tech support scams, delivery scams, rental scams, charity scams, and job scams. Also flag urgency tactics, suspicious links, and requests for money or credentials.\n\nContent: ${content}`,
  contract: (content) => `Analyze this contract, lease, or terms of service for unfair or predatory clauses. Return a JSON object with: score (0-100 where higher means more predatory), verdict (one of "FAIR", "CAUTION", "UNFAVORABLE", "PREDATORY"), title (string), description (string), signals (array of [kind, title, description] where kind is "good", "warn", or "bad"). Flag: deposit forfeiture, unilateral price or rent changes, automatic renewal, rights waivers, mandatory binding arbitration, one-sided liability or indemnification, sole-discretion clauses, and broad data collection or sharing. Keep descriptions short and plain.\n\nContent: ${content}`
};

const systemInstructions = {
  privacy: 'You are a privacy policy analyst. Always respond with valid JSON only, no markdown.',
  terms: 'You are a legal terms analyst. Always respond with valid JSON only, no markdown.',
  platform: 'You are a platform policy analyst. Always respond with valid JSON only, no markdown.',
  text: 'You are an AI text detection expert. Always respond with valid JSON only, no markdown.',
  image: 'You are an AI image detection expert. Always respond with valid JSON only, no markdown.',
  video: 'You are an AI video detection expert. Always respond with valid JSON only, no markdown.',
  scam: 'You are a scam detection analyst. Always respond with valid JSON only, no markdown.',
  contract: 'You are a contract fairness analyst. Always respond with valid JSON only, no markdown.'
};

router.post('/analyze', analysisLimiter, optionalAuth, async (req, res) => {
  try {
    const { type, content } = req.body || {};

    if (!type || !content || typeof content !== 'string') {
      return res.status(400).json({ error: 'Type and content are required.' });
    }
    if (!prompts[type]) {
      return res.status(400).json({ error: 'Invalid analysis type.' });
    }
    if (content.length > 15000) {
      return res.status(400).json({ error: 'Content exceeds the 15,000 character limit.' });
    }

    if (!aiEnabled()) {
      return res.status(503).json({ error: 'AI analysis is offline. Add a GROQ_API_KEY to the server .env file.' });
    }

    let text = '';
    try {
      text = await groqChat([
        { role: 'system', content: systemInstructions[type] },
        { role: 'user', content: prompts[type](content) }
      ], { temperature: 0.2 });
    } catch (error) {
      console.error('Analysis AI failed:', type, error.message, error.detail || '');
      return res.status(503).json({ error: 'Analysis service temporarily unavailable.' });
    }

    let result;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      result = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    } catch {
      result = {
        score: 50,
        title: 'Analysis complete',
        description: 'The analysis returned an unstructured response. Showing default results.',
        signals: [['warn', 'Inconclusive', 'The analysis could not produce a structured result.']]
      };
    }

    if (typeof result.score !== 'number') result.score = 50;
    result.score = Math.max(0, Math.min(100, Math.round(result.score)));
    if (!Array.isArray(result.signals)) result.signals = [];
    if (typeof result.title !== 'string' || !result.title) result.title = 'Analysis complete';
    if (typeof result.description !== 'string' || !result.description) {
      result.description = 'The analysis completed successfully.';
    }
    if (!result.confidence) result.confidence = 'Model confidence';

    res.json(result);
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ error: 'Server error during analysis.' });
  }
});

export default router;
