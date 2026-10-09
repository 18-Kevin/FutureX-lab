import express from 'express';
import dns from 'node:dns';
import { optionalAuth } from '../middleware/auth.mjs';
import { analysisLimiter } from '../middleware/rateLimiter.mjs';
import { aiEnabled, groqChat } from '../config/ai.mjs';

const router = express.Router();

const VISION_MODEL = (process.env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct').trim();

/* ---------- safe page fetch for URL-based analysis (SSRF-guarded) ---------- */

const FETCH_TIMEOUT_MS = 8000;
const FETCH_MAX_BYTES = 1500000;
const FETCH_MAX_HOPS = 3;
const FETCH_USER_AGENT = 'FutureXLabBot/1.0 (+https://futurexlab.vercel.app)';

function parseHttpUrl(raw) {
  try {
    const url = new URL(String(raw).trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url;
  } catch {
    return null;
  }
}

function ipv4Blocked(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function ipv6Blocked(host) {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === '::' || h === '::1') return true;
  if (h.startsWith('fe80')) return true;
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // unique local
  if (h.startsWith('::ffff:')) {
    const mapped = h.slice(7);
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(mapped)) return ipv4Blocked(mapped);
  }
  return false;
}

function hostnameBlocked(hostname) {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan') || h.endsWith('.home')) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return ipv4Blocked(h);
  if (h.includes(':')) return ipv6Blocked(h);
  return false;
}

async function hostBlocked(url) {
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':')) return true; // no direct IP targets
  if (hostnameBlocked(hostname)) return true;
  try {
    const records = await dns.promises.lookup(hostname, { all: true, verbatim: true });
    if (!records.length) return true;
    return records.some((record) => hostnameBlocked(record.address));
  } catch {
    return false; // unresolvable — let the fetch itself report the failure honestly
  }
}

function decodeEntities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => { try { return String.fromCodePoint(parseInt(hex, 16)); } catch { return ' '; } })
    .replace(/&#(\d+);/g, (_, num) => { try { return String.fromCodePoint(Number(num)); } catch { return ' '; } })
    .replace(/&([a-z]+);/gi, (m, name) => named[name.toLowerCase()] ?? m);
}

function htmlToText(html) {
  const text = html
    .replace(/<(script|style|noscript|svg|canvas|template|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|main|header|footer|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(text)
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function readCapped(response) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      chunks.push(value);
      if (total >= FETCH_MAX_BYTES) {
        try { await reader.cancel(); } catch { /* already closed */ }
        break;
      }
    }
  } catch { /* interrupted read — use what we have */ }
  const merged = new Uint8Array(Math.min(total, FETCH_MAX_BYTES));
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= merged.byteLength) break;
    const slice = chunk.subarray(0, merged.byteLength - offset);
    merged.set(slice, offset);
    offset += slice.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged);
}

async function fetchPageText(rawUrl) {
  const start = parseHttpUrl(rawUrl);
  if (!start) return { ok: false, note: 'the URL is not a valid http(s) address' };

  let current = start;
  for (let hop = 0; hop <= FETCH_MAX_HOPS; hop += 1) {
    if (await hostBlocked(current)) {
      return { ok: false, note: 'the URL points to a blocked or internal address' };
    }

    let response;
    try {
      response = await fetch(current.href, {
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          'user-agent': FETCH_USER_AGENT,
          accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5'
        }
      });
    } catch (error) {
      return { ok: false, note: error.name === 'TimeoutError' ? 'the page timed out' : 'the page could not be reached' };
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return { ok: false, note: 'the server sent a broken redirect' };
      try {
        current = new URL(location, current);
      } catch {
        return { ok: false, note: 'the server sent an invalid redirect' };
      }
      if (current.protocol !== 'http:' && current.protocol !== 'https:') {
        return { ok: false, note: 'the redirect left http(s)' };
      }
      continue;
    }

    if (!response.ok) return { ok: false, note: `the page returned HTTP ${response.status}` };

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (!/text\/html|application\/xhtml\+xml|text\/plain/.test(contentType)) {
      return { ok: false, note: 'the URL is not an HTML or text page' };
    }
    const length = Number(response.headers.get('content-length') || 0);
    if (length > FETCH_MAX_BYTES) return { ok: false, note: 'the page is too large to fetch' };

    const html = await readCapped(response);
    const text = htmlToText(html);
    if (!text) return { ok: false, note: 'no readable text was found on the page' };
    return { ok: true, text, finalUrl: current.href };
  }

  return { ok: false, note: 'too many redirects' };
}

const REPORT_SHAPE = `Return ONLY valid JSON with this exact shape:
{
 "score": <0-100 number>,
 "verdict": "<one of the allowed verdicts>",
 "confidence": "<High|Moderate|Low> (about NN%)",
 "title": "<short overall title>",
 "description": "<2-3 sentence plain-English overall assessment>",
 "signals": [["good"|"warn"|"bad", "<short title>", "<one specific observation citing the content>"]],
 "evidence": ["<specific concrete indicator you observed in this content>"],
 "findings": [
   {
     "severity": "critical"|"high"|"medium"|"low",
     "title": "<name of the issue>",
     "clause": "<short exact quote from the content (max 200 chars), or clear paraphrase>",
     "why": "<why this is risky, unsafe or fraudulent, in plain English>",
     "impact": "<what can realistically happen to the user because of this>",
     "action": "<what the user should do about it>"
   }
 ],
 "recommendations": ["<practical step the user should take>"]
}
Rules:
- Examine EVERY section of the content.
- Produce 8-14 signals, 5-10 findings, and 3-6 recommendations.
- confidence = how confident you are in this score and verdict given the content provided (say Low when the content is thin, ambiguous or truncated). Never present guesses as certainty.
- evidence: 3-6 concrete, observable indicators you actually found in this content (quote or precise reference) — never invented, never vague.
- Every finding must be specific to THIS content. Quote the real clause where possible. Never invent clauses that are not present.
- Findings must cover every risky, unsafe, deceptive, or fraudulent practice you can identify — one finding per issue, never merge issues together.
- Plain English, no legalese, no hedging filler. JSON only — no markdown, no commentary outside the JSON.`;

const DETECTION_SHAPE = `Return ONLY valid JSON with this exact shape:
{
 "score": <0-100 number = likelihood the content is AI-generated>,
 "verdict": "<one of the allowed verdicts>",
 "confidence": "<High|Moderate|Low> (about NN%)",
 "title": "<short result title>",
 "description": "<2-3 sentence assessment: AI or human, with the main reason>",
 "watermark": {
   "status": "DETECTED"|"POSSIBLE"|"NONE",
   "details": ["<specific watermark or provenance marker found, or why none applies>"]
 },
 "provenance": "<likely origin/source of the content and how you concluded it>",
 "evidence": ["<specific concrete indicator you observed>", "<another indicator>"]
}
Rules:
- score = likelihood AI-generated (0 = clearly human, 100 = clearly AI).
- verdict must be based on the evidence; use INCONCLUSIVE when evidence genuinely conflicts.
- evidence: 4-8 concrete, observable indicators — never vague statements like "it sounds robotic".
- watermark: check for embedded markers, tool signatures, platform AI labels, and stylistic fingerprint tells; say DETECTED only with a stated reason, POSSIBLE for weak hints, NONE otherwise.
- provenance: identify the likely source type (e.g. news article, academic paper, official page, forum post, marketing copy, book excerpt, AI assistant output, AI image/video tool) and name the signals that led you there.
- JSON only — no markdown, no commentary outside the JSON.`;

const prompts = {
  privacy: (content) => `Analyze this privacy policy in full detail.
Allowed verdicts: "SAFE" | "MOSTLY SAFE" | "RISKY" | "HIGH RISK".
score: higher = safer for the user.
Focus on: data collected, purpose of collection, third-party sharing and sale of data, retention and deletion, international transfers, user control (access/rectify/erase), opt-out mechanisms, consent dark patterns, children's data, tracking/profiling, and any deceptive or hidden clauses.

${REPORT_SHAPE}

Content:
${content}`,

  terms: (content) => `Analyze these terms and conditions in full detail.
Allowed verdicts: "SAFE" | "MOSTLY SAFE" | "RISKY" | "HIGH RISK".
score: higher = safer for the user.
Focus on: liability limits, arbitration and class-action waivers, automatic renewal, refunds, unilateral changes, termination rights, content/IP licensing, data usage, price changes without notice, sole-discretion clauses, and any unfair or deceptive practices.

${REPORT_SHAPE}

Content:
${content}`,

  platform: (content) => `Analyze this app or platform policy in full detail.
Allowed verdicts: "SAFE" | "MOSTLY SAFE" | "RISKY" | "HIGH RISK".
score: higher = safer for the user.
Focus on: permissions (location, contacts, camera, microphone), background tracking, advertising and profiling, security practices, data sharing with partners, account deletion, notification and consent dark patterns, and any unsafe or deceptive data practices.

${REPORT_SHAPE}

Content:
${content}`,

  scam: (content) => `Analyze this message or document for scams and fraud in full detail.
Allowed verdicts: "SAFE" | "LOW RISK" | "SUSPICIOUS" | "DANGEROUS" | "LIKELY MALICIOUS".
score: higher = more likely a scam.
Classify the fraud pattern(s) found: phishing, prize/lottery bait, romance scam, government/bank impersonation, crypto investment fraud, tech-support scam, delivery scam, rental scam, job/employment scam, charity scam, invoice/payment fraud, sextortion, or impersonation of a real brand.
Also flag: urgency and fear tactics, suspicious links/domains, requests for money or credentials, too-good-to-be-true offers, payment via gift cards/crypto, and emotional manipulation.

${REPORT_SHAPE}

Content:
${content}`,

  contract: (content) => `Analyze this contract, lease, or terms of service for unfair and predatory clauses in full detail.
Allowed verdicts: "FAIR" | "CAUTION" | "UNFAVORABLE" | "PREDATORY".
score: higher = more predatory.
Flag: deposit forfeiture, unilateral price/rent changes, automatic renewal, rights waivers, binding arbitration, one-sided liability or indemnification, sole-discretion clauses, broad data collection, penalty fees, and any clause that is unenforceable or illegal in consumer protection norms.

${REPORT_SHAPE}

Content:
${content}`,

  text: (content) => `Assess whether this text was written by a human or generated by AI.
Allowed verdicts: "AI-GENERATED" | "HUMAN-WRITTEN" | "INCONCLUSIVE".
Watermark checks for text: embedded markers or disclaimers (for example "generated by", "as an AI"), AI-assistant boilerplate phrases, LLM stylistic fingerprints (uniform sentence length, hedge phrases such as "it's important to note", overused words like "delve/crucial/leverage", mechanical list-heavy structure, unnaturally consistent tone, zero typos or colloquialisms).
Provenance: identify where this text most likely came from — news article, academic paper, official/company page, forum or social post, marketing copy, book excerpt, chatbot output, or a human writer imitating formal style — and name the signals.

${DETECTION_SHAPE}

Text:
${content}`,

  image: (content) => `Assess whether this image was created by a human (camera/artist) or generated/manipulated by AI. Analyze any attached frames in detail.
Allowed verdicts: "AI-GENERATED" | "HUMAN-MADE" | "INCONCLUSIVE".
Watermark checks: visible AI labels or tool signatures, "Content Credentials"/C2PA hints, generator fingerprints, tell-tale artifacts.
Provenance: name the likely origin (Midjourney, DALL-E, Stable Diffusion, Flux, Firefly, phone camera, professional camera, screenshot, edited composite) and why.
Evidence must cover: hands/fingers/anatomy, garbled or invented text, lighting and shadow consistency, reflections, skin and texture realism, jewelry/teeth symmetry, logo warping, depth-of-field plausibility, noise/grain versus diffusion smoothness, and file metadata noted in the content string.

${DETECTION_SHAPE}

File metadata / description:
${content}`,

  video: (content) => `Assess whether this video was created by a human (camera footage) or fully generated/manipulated by AI. Analyze any attached frames in detail.
Allowed verdicts: "AI-GENERATED" | "HUMAN-MADE" | "INCONCLUSIVE".
Watermark checks: visible AI labels or tool signatures, platform "AI-generated" markers, tool fingerprints in the frames.
Provenance: name the likely origin (Sora, Runway, Kling, Pika, Veo, Luma, deepfake edit, phone camera, professional camera, screen recording) and why.
Evidence must cover: cross-frame consistency (lighting, anatomy, object permanence), physics plausibility, morphing/warping between frames, temporal flicker, text stability in frame, facial and hand realism, audio/visual plausibility from metadata, compression and sensor noise versus diffusion smoothness, and file metadata noted in the content string.

${DETECTION_SHAPE}

File metadata / description:
${content}`
};

const systemInstructions = {
  privacy: 'You are a senior privacy analyst who reviews policies clause by clause. Be exhaustive and specific. Always respond with valid JSON only, no markdown.',
  terms: 'You are a senior consumer-law terms analyst who reviews agreements clause by clause. Be exhaustive and specific. Always respond with valid JSON only, no markdown.',
  platform: 'You are a senior platform-policy analyst who reviews app policies clause by clause. Be exhaustive and specific. Always respond with valid JSON only, no markdown.',
  scam: 'You are a fraud examiner. Classify fraud patterns precisely and be exhaustive. Always respond with valid JSON only, no markdown.',
  contract: 'You are a contract fairness analyst who reviews documents clause by clause. Be exhaustive and specific. Always respond with valid JSON only, no markdown.',
  text: 'You are an AI-content detection expert. Judge only from observable textual evidence. Always respond with valid JSON only, no markdown.',
  image: 'You are an AI-image detection expert. Judge only from observable visual evidence and metadata. Always respond with valid JSON only, no markdown.',
  video: 'You are an AI-video detection expert. Judge only from observable visual evidence across frames and metadata. Always respond with valid JSON only, no markdown.'
};

function normalizeVerdictKind(value) {
  const severity = String(value || '').toLowerCase();
  if (severity === 'critical' || severity === 'high' || severity === 'bad') return severity === 'bad' ? 'high' : severity;
  if (severity === 'medium' || severity === 'low') return severity;
  if (severity === 'good' || severity === 'safe') return 'low';
  if (severity === 'warn' || severity === 'warning') return 'medium';
  return 'medium';
}

function normalizeSignalKind(value) {
  const kind = String(value || '').toLowerCase();
  if (['good', 'warn', 'bad'].includes(kind)) return kind;
  if (['critical', 'high', 'risk', 'unsafe', 'danger'].some((word) => kind.includes(word))) return 'bad';
  if (['medium', 'low', 'caution', 'warning', 'info'].some((word) => kind.includes(word))) return 'warn';
  return 'warn';
}

function cleanString(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function cleanList(value, max) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        return cleanString(item.text || item.title || item.description || item.detail);
      }
      return '';
    })
    .filter(Boolean)
    .slice(0, max);
}

function normalizeSignals(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (Array.isArray(item)) {
        return [normalizeSignalKind(item[0]), cleanString(item[1], 'Finding'), cleanString(item[2])];
      }
      if (item && typeof item === 'object') {
        return [
          normalizeSignalKind(item.kind || item.severity || item.type),
          cleanString(item.title, 'Finding'),
          cleanString(item.description || item.why || item.detail)
        ];
      }
      if (typeof item === 'string') return ['warn', item.trim(), ''];
      return null;
    })
    .filter((item) => item && item[1])
    .slice(0, 14);
}

function normalizeFindings(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') {
        return { severity: 'medium', title: item.trim(), clause: '', why: '', impact: '', action: '' };
      }
      if (item && typeof item === 'object') {
        return {
          severity: normalizeVerdictKind(item.severity || item.level),
          title: cleanString(item.title || item.issue, 'Finding'),
          clause: cleanString(item.clause || item.quote || item.text),
          why: cleanString(item.why || item.reason || item.description),
          impact: cleanString(item.impact || item.consequence || item.risk),
          action: cleanString(item.action || item.recommendation || item.fix)
        };
      }
      return null;
    })
    .filter((item) => item && item.title)
    .slice(0, 12);
}

function normalizeWatermark(value) {
  if (typeof value === 'string') {
    const status = value.toUpperCase().includes('DETECT') ? 'DETECTED' : value.toUpperCase().includes('POSS') ? 'POSSIBLE' : 'NONE';
    return { status, details: value.trim() ? [value.trim()] : [] };
  }
  if (value && typeof value === 'object') {
    const raw = cleanString(value.status).toUpperCase();
    const status = ['DETECTED', 'POSSIBLE', 'NONE'].includes(raw) ? raw : 'NONE';
    return { status, details: cleanList(value.details || value.signals || value.markers, 6) };
  }
  return { status: 'NONE', details: [] };
}

function parseModelJson(text) {
  const cleaned = String(text || '').replace(/```(?:json)?/gi, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch { /* fall through */ }
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function normalizeResult(raw) {
  const result = raw && typeof raw === 'object' ? raw : {};
  const resultOut = {
    score: typeof result.score === 'number' ? Math.max(0, Math.min(100, Math.round(result.score))) : 50,
    verdict: cleanString(result.verdict).toUpperCase(),
    title: cleanString(result.title, 'Analysis complete'),
    description: cleanString(result.description, 'The analysis completed successfully.'),
    signals: normalizeSignals(result.signals),
    findings: normalizeFindings(result.findings),
    recommendations: cleanList(result.recommendations, 6)
  };

  if (result.confidence) resultOut.confidence = cleanString(result.confidence, 'Model confidence');
  if (result.provenance) resultOut.provenance = cleanString(result.provenance);
  if (result.evidence || result.watermark || result.verdict) {
    resultOut.evidence = cleanList(result.evidence, 8);
    resultOut.watermark = normalizeWatermark(result.watermark);
  }

  return resultOut;
}

function sanitizeImages(images) {
  if (!Array.isArray(images)) return [];
  return images
    .filter((item) => typeof item === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(item) && item.length <= 2500000)
    .slice(0, 3);
}

router.post('/analyze', analysisLimiter, optionalAuth, async (req, res) => {
  try {
    const { type, content } = req.body || {};
    const images = type === 'image' || type === 'video' ? sanitizeImages(req.body?.images) : [];
    const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim().slice(0, 2048) : '';

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

    const system = { role: 'system', content: systemInstructions[type] };

    let modelContent = content;
    let source = null;
    if (rawUrl) {
      const page = await fetchPageText(rawUrl);
      source = { url: rawUrl, fetched: page.ok, note: page.note || '' };
      if (page.ok) {
        const room = Math.max(0, 15000 - content.length - 220);
        const pageText = page.text.slice(0, room);
        if (pageText) {
          modelContent = `${content}\n\n--- PAGE TEXT FETCHED FROM ${page.finalUrl} AT ${new Date().toISOString()} ---\n${pageText}`;
        } else {
          source.note = 'the submitted text already fills the limit; the fetched page text was not needed';
        }
      } else {
        modelContent = `${content}\n\nNote: the page at ${rawUrl} could not be fetched (${page.note}). Judge only from the text above and state this limitation clearly in your assessment.`;
      }
    }

    const userText = prompts[type](modelContent);

    let text = '';

    if (images.length) {
      const messages = [
        system,
        {
          role: 'user',
          content: [
            { type: 'text', text: userText },
            ...images.map((url) => ({ type: 'image_url', image_url: { url } }))
          ]
        }
      ];
      try {
        text = await groqChat(messages, { temperature: 0.2, model: VISION_MODEL });
      } catch (visionError) {
        console.error('Vision analysis failed, retrying text-only:', visionError.message, visionError.detail || '');
        text = await groqChat([
          system,
          { role: 'user', content: `${userText}\nNote: the attached media frames could not be processed in this fallback pass — judge from the metadata only and lower your confidence accordingly.` }
        ], { temperature: 0.2 });
      }
    } else {
      try {
        text = await groqChat([system, { role: 'user', content: userText }], { temperature: 0.2 });
      } catch (error) {
        console.error('Analysis AI failed:', type, error.message, error.detail || '');
        return res.status(503).json({ error: 'Analysis service temporarily unavailable.' });
      }
    }

    let parsed = parseModelJson(text);

    if (!parsed) {
      try {
        text = await groqChat([
          system,
          { role: 'user', content: `${userText}\n\nCRITICAL: Respond with ONLY the raw JSON object. No markdown fences, no explanations, no text before or after the JSON.` }
        ], { temperature: 0.1 });
        parsed = parseModelJson(text);
      } catch (retryError) {
        console.error('Analysis JSON retry failed:', type, retryError.message);
      }
    }

    if (!parsed) {
      console.error('Analysis unstructured response:', type, String(text || '').slice(0, 200));
      const fallback = {
        score: 50,
        verdict: '',
        title: 'Analysis incomplete',
        description: 'The model returned an unstructured response. Try again with clearer or longer content.',
        signals: [['warn', 'Inconclusive', 'A structured result could not be produced for this input.']],
        findings: [],
        recommendations: []
      };
      if (source) fallback.source = source;
      return res.json(fallback);
    }

    const output = normalizeResult(parsed);
    if (source) output.source = source;
    res.json(output);
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ error: 'Server error during analysis.' });
  }
});

export default router;
