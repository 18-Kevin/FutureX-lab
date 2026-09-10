import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(express.json());
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

app.listen(3000, () => {
  console.log("FutureX is running at http://localhost:3000");
});