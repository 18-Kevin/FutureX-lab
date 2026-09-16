import express from "express";
import dotenv from "dotenv";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

dotenv.config();

const app = express();
const scrypt = promisify(crypto.scrypt);
const dataDirectory = path.join(process.cwd(), "data");
const usersFile = path.join(dataDirectory, "users.json");
const sessions = new Map();

fs.mkdirSync(dataDirectory, { recursive: true });
if (!fs.existsSync(usersFile)) {
  fs.writeFileSync(usersFile, "[]\n", "utf8");
}

app.use(express.json());
app.use(express.static("public"));

function readUsers() {
  return JSON.parse(fs.readFileSync(usersFile, "utf8"));
}

function writeUsers(users) {
  const temporaryFile = `${usersFile}.tmp`;
  fs.writeFileSync(temporaryFile, `${JSON.stringify(users, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryFile, usersFile);
}

function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function parseCookies(request) {
  return Object.fromEntries(
    (request.headers.cookie || "")
      .split(";")
      .filter(Boolean)
      .map(cookie => {
        const separator = cookie.indexOf("=");
        return [
          cookie.slice(0, separator).trim(),
          decodeURIComponent(cookie.slice(separator + 1).trim())
        ];
      })
  );
}

async function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = await scrypt(password, salt, 64);
  return { salt, hash: hash.toString("hex") };
}

async function verifyPassword(password, salt, storedHash) {
  const { hash } = await hashPassword(password, salt);
  const expected = Buffer.from(storedHash, "hex");
  const actual = Buffer.from(hash, "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function createSession(user) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { userId: user.id, expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 7 });
  return token;
}

function getAuthenticatedUser(request) {
  const token = parseCookies(request).futurex_session;
  const session = token && sessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    if (token) sessions.delete(token);
    return null;
  }

  return readUsers().find(user => user.id === session.userId) || null;
}

function publicUser(user) {
  return user ? { id: user.id, name: user.name, email: user.email } : null;
}

function setSessionCookie(response, token) {
  response.setHeader(
    "Set-Cookie",
    `futurex_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
  );
}

app.get("/api/auth/me", (request, response) => {
  response.json({ user: publicUser(getAuthenticatedUser(request)) });
});

app.post("/api/auth/register", async (request, response) => {
  const body = request.body || {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";

  if (name.length < 2 || name.length > 80) {
    return response.status(400).json({ error: "Please enter a name between 2 and 80 characters." });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return response.status(400).json({ error: "Please enter a valid email address." });
  }
  if (password.length < 8) {
    return response.status(400).json({ error: "Password must be at least 8 characters." });
  }

  const users = readUsers();
  if (users.some(user => user.email === email)) {
    return response.status(409).json({ error: "An account with that email already exists." });
  }

  const { salt, hash } = await hashPassword(password);
  const user = { id: crypto.randomUUID(), name, email, salt, passwordHash: hash, createdAt: new Date().toISOString() };
  users.push(user);
  writeUsers(users);
  setSessionCookie(response, createSession(user));
  response.status(201).json({ user: publicUser(user) });
});

app.post("/api/auth/login", async (request, response) => {
  const body = request.body || {};
  const email = normalizeEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  const user = readUsers().find(candidate => candidate.email === email);

  if (!user || !(await verifyPassword(password, user.salt, user.passwordHash))) {
    return response.status(401).json({ error: "Email or password is incorrect." });
  }

  setSessionCookie(response, createSession(user));
  response.json({ user: publicUser(user) });
});

app.post("/api/auth/logout", (request, response) => {
  const token = parseCookies(request).futurex_session;
  if (token) sessions.delete(token);
  response.setHeader("Set-Cookie", "futurex_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  response.status(204).end();
});

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