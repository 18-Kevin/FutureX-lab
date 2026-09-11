import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(express.json());
app.use(cors());
app.use(express.static("public"));

app.post("/api/chat", async (request, response) => {
  try {
    const userMessage = request.body.message;

    let geminiResponse;

    for (let attempt = 1; attempt <= 3; attempt++) {
      geminiResponse = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": process.env.GEMINI_API_KEY
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{
                text: "You are the helpful FutureX Lab AI assistant. Help visitors understand AI and technology, privacy and trust, FutureX Lab research, and digital innovation. Use simple language. Be useful and concise."
              }]
            },
            contents: [
              {
                role: "user",
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
      console.error("Gemini error:", data);

      return response.status(500).json({
        reply: "The AI is temporarily busy. Please try again."
      });
    }

    const reply =
      data?.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("") ||
      "Sorry, I could not generate a response.";

    response.json({ reply });

  } catch (error) {
    console.error("Server error:", error);

    response.status(500).json({
      reply: "Sorry, the AI assistant is temporarily unavailable."
    });
  }
});

app.post("/api/analyze-privacy", async (request, response) => {
  try {
    const { input } = request.body;

    if (!input || !input.trim()) {
      return response.status(400).json({
        error: "Please provide a privacy policy URL or text."
      });
    }

    let policyText = input.trim();

    // If the user entered a URL, fetch the policy
    if (/^https?:\/\//i.test(policyText)) {
      const url = new URL(policyText);

      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return response.status(400).json({
          error: "Only HTTP and HTTPS URLs are supported."
        });
      }

      const pageResponse = await fetch(url, {
        headers: {
          "User-Agent": "FutureX-Lab-Privacy-Checker/1.0"
        },
        signal: AbortSignal.timeout(15000)
      });

      if (!pageResponse.ok) {
        return response.status(400).json({
          error: `Could not access the policy page. HTTP ${pageResponse.status}.`
        });
      }

      const html = await pageResponse.text();

      policyText = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    if (policyText.length < 100) {
      return response.status(400).json({
        error: "The privacy policy contains too little text to analyze."
      });
    }

    policyText = policyText.slice(0, 30000);

    const geminiResponse = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text: `You are FutureX Lab's Privacy Policy Intelligence engine.

Analyze the provided privacy policy carefully.

Return ONLY valid JSON in this exact structure:
{
  "score": 0,
  "title": "Short assessment title",
  "description": "Simple overall explanation",
  "signals": [
    {
      "kind": "good",
      "title": "Signal title",
      "description": "Simple explanation"
    },
    {
      "kind": "warn",
      "title": "Signal title",
      "description": "Simple explanation"
    },
    {
      "kind": "bad",
      "title": "Signal title",
      "description": "Simple explanation"
    }
  ]
}

Rules:
- score must be an integer from 0 to 100.
- Use good, warn, or bad for kind.
- Identify actual issues from the policy. Do not invent facts.
- Look for data collection, third-party sharing, advertising/tracking, retention, deletion rights, user controls, security, and unclear language.
- Use simple language.
- Give 3 to 6 important signals.
- This is an informational privacy analysis, not legal advice.`
            }]
          },
          contents: [{
            role: "user",
            parts: [{
              text: `Analyze this privacy policy:\n\n${policyText}`
            }]
          }]
        })
      }
    );

    const data = await geminiResponse.json();

    if (!geminiResponse.ok) {
      console.error("Privacy analysis error:", data);

      return response.status(500).json({
        error: "Privacy analysis failed."
      });
    }

    const rawText =
      data?.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("")
        .trim();

    const cleaned = rawText
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const analysis = JSON.parse(cleaned);

    response.json(analysis);

  } catch (error) {
    console.error("Privacy checker error:", error);

    response.status(500).json({
      error: "Unable to analyze this privacy policy."
    });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("FutureX is running at http://localhost:3000");
});
