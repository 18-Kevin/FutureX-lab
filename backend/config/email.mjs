import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

let transporter = null;

export function emailConfigured() {
  const brevoKey = (process.env.BREVO_API_KEY || '').trim();
  if (brevoKey && !brevoKey.includes('PASTE_') && !brevoKey.includes('your_brevo')) return true;
  const user = (process.env.EMAIL_USER || '').trim();
  const pass = (process.env.EMAIL_PASSWORD || '').trim();
  return Boolean(
    user && pass &&
    !user.includes('PASTE_') && !user.includes('your_gmail') &&
    !pass.includes('PASTE_') && !pass.includes('your_app_password')
  );
}

function brevoKey() {
  const key = (process.env.BREVO_API_KEY || '').trim();
  if (key && !key.includes('PASTE_') && !key.includes('your_brevo')) return key;
  return null;
}

function frontendUrl() {
  return (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

export function initEmailService() {
  if (brevoKey()) return;
  transporter = nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD
    },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 12000
  });
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    if (timer.unref) timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function sendViaBrevo(key, { to, subject, html, label }) {
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: {
          name: 'FutureX Lab',
          email: (process.env.EMAIL_FROM || process.env.EMAIL_USER || '').trim()
        },
        to: [{ email: to }],
        subject,
        htmlContent: html
      }),
      signal: AbortSignal.timeout(15000)
    });
    if (res.ok) {
      console.log(`✓ ${label} sent to ${to} (Brevo)`);
      return true;
    }
    const body = await res.text();
    let msg = body;
    try { msg = JSON.parse(body).message || body; } catch { /* keep raw */ }
    console.error(`✗ Brevo ${label} failed: HTTP ${res.status} — ${String(msg).slice(0, 300)}`);
    return false;
  } catch (error) {
    console.error(`✗ Brevo ${label} failed:`, error.code || '', error.message);
    return false;
  }
}

async function sendViaSmtp({ to, subject, html, label }) {
  if (!transporter) initEmailService();
  const mailOptions = {
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to,
    subject,
    html
  };
  try {
    await withTimeout(transporter.sendMail(mailOptions), 20000, label);
    console.log(`✓ ${label} sent to ${to}`);
    return true;
  } catch (error) {
    console.error(`✗ Failed to send ${label}:`, error.code || '', error.message);
    return false;
  }
}

async function deliver({ to, subject, html, label }) {
  const key = brevoKey();
  if (key) return sendViaBrevo(key, { to, subject, html, label });
  return sendViaSmtp({ to, subject, html, label });
}

export async function sendVerificationEmail(email, token, userName) {
  if (!emailConfigured()) {
    console.log('⚠ Email not configured — skipping verification email to', email);
    return false;
  }

  const verificationLink = `${frontendUrl()}/?verify=${token}`;
  const html = `
      <h2>Welcome to FutureX Lab, ${userName}!</h2>
      <p>Please verify your email address by clicking the button below:</p>
      <a href="${verificationLink}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
        Verify Email
      </a>
      <p>Or copy this link: ${verificationLink}</p>
      <p>This link will expire in 24 hours.</p>
      <p>If you didn't create this account, please ignore this email.</p>
    `;

  return deliver({ to: email, subject: 'Verify your FutureX Lab email', html, label: 'verification email' });
}

export async function sendPasswordResetEmail(email, token, userName) {
  if (!emailConfigured()) {
    console.log('⚠ Email not configured — skipping password reset email to', email);
    return false;
  }

  const resetLink = `${frontendUrl()}/?reset=${token}`;
  const html = `
      <h2>Password Reset Request</h2>
      <p>Hi ${userName},</p>
      <p>Click the button below to reset your password:</p>
      <a href="${resetLink}" style="background-color: #28a745; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
        Reset Password
      </a>
      <p>Or copy this link: ${resetLink}</p>
      <p>This link will expire in 1 hour.</p>
      <p>If you didn't request a password reset, please ignore this email.</p>
    `;

  return deliver({ to: email, subject: 'Reset your FutureX Lab password', html, label: 'password reset email' });
}
