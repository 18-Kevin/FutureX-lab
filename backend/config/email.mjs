import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

let transporter = null;

export function emailConfigured() {
  const user = (process.env.EMAIL_USER || '').trim();
  const pass = (process.env.EMAIL_PASSWORD || '').trim();
  return Boolean(
    user && pass &&
    !user.includes('PASTE_') && !user.includes('your_gmail') &&
    !pass.includes('PASTE_') && !pass.includes('your_app_password')
  );
}

function frontendUrl() {
  return (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

export function initEmailService() {
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

export async function sendVerificationEmail(email, token, userName) {
  if (!emailConfigured()) {
    console.log('⚠ Email not configured — skipping verification email to', email);
    return false;
  }
  if (!transporter) initEmailService();

  const verificationLink = `${frontendUrl()}/?verify=${token}`;

  const mailOptions = {
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to: email,
    subject: 'Verify your FutureX Lab email',
    html: `
      <h2>Welcome to FutureX Lab, ${userName}!</h2>
      <p>Please verify your email address by clicking the button below:</p>
      <a href="${verificationLink}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
        Verify Email
      </a>
      <p>Or copy this link: ${verificationLink}</p>
      <p>This link will expire in 24 hours.</p>
      <p>If you didn't create this account, please ignore this email.</p>
    `
  };

  try {
    await withTimeout(transporter.sendMail(mailOptions), 20000, 'Verification email');
    console.log(`✓ Verification email sent to ${email}`);
    return true;
  } catch (error) {
    console.error('✗ Failed to send verification email:', error.code || '', error.message);
    return false;
  }
}

export async function sendPasswordResetEmail(email, token, userName) {
  if (!emailConfigured()) {
    console.log('⚠ Email not configured — skipping password reset email to', email);
    return false;
  }
  if (!transporter) initEmailService();

  const resetLink = `${frontendUrl()}/?reset=${token}`;

  const mailOptions = {
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to: email,
    subject: 'Reset your FutureX Lab password',
    html: `
      <h2>Password Reset Request</h2>
      <p>Hi ${userName},</p>
      <p>Click the button below to reset your password:</p>
      <a href="${resetLink}" style="background-color: #28a745; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
        Reset Password
      </a>
      <p>Or copy this link: ${resetLink}</p>
      <p>This link will expire in 1 hour.</p>
      <p>If you didn't request a password reset, please ignore this email.</p>
    `
  };

  try {
    await withTimeout(transporter.sendMail(mailOptions), 20000, 'Password reset email');
    console.log(`✓ Password reset email sent to ${email}`);
    return true;
  } catch (error) {
    console.error('✗ Failed to send password reset email:', error.code || '', error.message);
    return false;
  }
}
