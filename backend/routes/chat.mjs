import express from 'express';
import { authenticateToken } from '../middleware/auth.mjs';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();

router.post('/chat', authenticateToken, async (req, res) => {
  try {
    const userMessage = req.body.message;

    if (!userMessage) {
      return res.status(400).json({ error: 'Message is required' });
    }

    let geminiResponse;

    for (let attempt = 1; attempt <= 3; attempt++) {
      geminiResponse = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': process.env.GEMINI_API_KEY
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{
                text: 'You are the helpful FutureX Lab AI assistant. Help visitors understand AI and technology, privacy and trust, FutureX Lab research, and digital innovation. Use simple language and be friendly.'
              }]
            },
            contents: [
              {
                role: 'user',
                parts: [{ text: userMessage }]
              }
            ]
          })
        }
      );

      if (geminiResponse.status !== 503) {
        break;
      }

      console.log(`Gemini busy. Retry ${attempt}/3...`);

      await new Promise(resolve =>
        setTimeout(resolve, attempt * 2000)
      );
    }

    const data = await geminiResponse.json();

    if (!geminiResponse.ok) {
      console.error('Gemini error:', data);
      return res.status(500).json({
        reply: 'The AI is temporarily busy. Please try again.'
      });
    }

    const reply =
      data?.candidates?.[0]?.content?.parts
        ?.map(part => part.text || '')
        .join('') ||
      'Sorry, I could not generate a response.';

    res.json({ reply });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({
      reply: 'Sorry, the AI assistant is temporarily unavailable.'
    });
  }
});

export default router;
