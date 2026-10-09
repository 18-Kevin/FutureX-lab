import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { connectDB, disconnectDB, usingMongo } from './config/database.mjs';
import { initEmailService, emailConfigured } from './config/email.mjs';
import { aiEnabled } from './config/ai.mjs';
import { generalLimiter } from './middleware/rateLimiter.mjs';
import authRoutes from './routes/auth.mjs';
import chatRoutes from './routes/chat.mjs';
import analysisRoutes from './routes/analysis.mjs';
import diagnosticsRoutes from './routes/diagnostics.mjs';
import newsRoutes from './routes/news.mjs';
import { startNewsScheduler } from './config/news.mjs';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());

// Approved origins: the production site, local dev, and the pinned FutureX Lab
// extension (extension ID is fixed via the manifest "key" field).
const approvedOrigins = new Set([
  process.env.FRONTEND_URL || 'http://localhost:3000',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://futurexlab.vercel.app',
  'chrome-extension://epebmappddkmmlbieakhafhopbjibbnh'
]);
if (process.env.EXTENSION_ORIGIN) approvedOrigins.add(process.env.EXTENSION_ORIGIN);

app.use(cors({
  origin: (origin, callback) => {
    callback(null, !origin || approvedOrigins.has(origin));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body parser middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Rate limiting
app.use(generalLimiter);

// Static files
app.use(express.static('public'));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api', chatRoutes);
app.use('/api', analysisRoutes);
app.use('/api/diag', diagnosticsRoutes);
app.use('/api/news', newsRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

// Start server
async function start() {
  try {
    // Connect to database
    await connectDB();
    
    // Initialize email service
    initEmailService();
    
    // Start listening
    app.listen(PORT, () => {
      console.log(`\n🚀 FutureX Server running at http://localhost:${PORT}`);
      console.log(`🗄  Database: ${usingMongo() ? 'MongoDB Atlas' : 'JSON file (local)'}`);
      console.log(`🤖 AI: ${aiEnabled() ? `Groq (${process.env.GROQ_MODEL || 'default model'})` : 'offline — add GROQ_API_KEY to .env'}`);
      console.log(`📧 Email: ${emailConfigured() ? 'configured' : 'not configured — add EMAIL_USER and EMAIL_PASSWORD to .env'}`);
      console.log(`📰 News: refreshing daily at 12:00 AM IST`);
      console.log(`🔐 Security middleware enabled\n`);

      startNewsScheduler();
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('\n⚠️ SIGTERM signal received: closing HTTP server');
  await disconnectDB();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('\n⚠️ SIGINT signal received: closing HTTP server');
  await disconnectDB();
  process.exit(0);
});

start();
