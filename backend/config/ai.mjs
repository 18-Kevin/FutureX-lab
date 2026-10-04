import dotenv from 'dotenv';

dotenv.config();

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'openai/gpt-oss-120b';

export function aiEnabled() {
  const key = (process.env.GROQ_API_KEY || '').trim();
  return Boolean(key) && !key.includes('PASTE_') && !key.includes('your_groq');
}

export function aiModel() {
  return (process.env.GROQ_MODEL || '').trim() || DEFAULT_MODEL;
}

export async function groqChat(messages, { temperature = 0.6, model = '' } = {}) {
  if (!aiEnabled()) throw new Error('AI_DISABLED');

  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.GROQ_API_KEY.trim()}`
        },
        body: JSON.stringify({
          model: (model || aiModel()).trim(),
          messages,
          temperature
        })
      });

      if (response.ok) {
        const data = await response.json();
        const text = data?.choices?.[0]?.message?.content || '';
        if (text) return text;
        lastError = new Error('The AI provider returned an empty response.');
        continue;
      }

      const detail = (await response.text().catch(() => '')).slice(0, 300);
      lastError = Object.assign(new Error(`Groq error ${response.status}`), {
        status: response.status,
        detail
      });

      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable) throw lastError;
    } catch (error) {
      if (error?.status && error.status !== 429 && error.status < 500) throw error;
      lastError = error;
    }

    if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 1200));
  }

  throw lastError || new Error('The AI provider is unreachable.');
}
