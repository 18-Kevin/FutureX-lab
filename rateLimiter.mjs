import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

dotenv.config();

const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000;
const maxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100;

export const generalLimiter = rateLimit({
  windowMs, max: maxRequests,
  message: 'Too many requests, try again later.',
  standardHeaders: true, legacyHeaders: false
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 5,
  message: 'Too many attempts, try again later.',
  skipSuccessfulRequests: true
});

export const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 3,
  message: 'Too many reset attempts, try again later.'
});