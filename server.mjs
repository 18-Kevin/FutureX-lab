
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { connectDB, disconnectDB } from './config/database.mjs';
import { initEmailService } from './config/email.mjs';
import { generalLimiter } from './middleware/rateLimiter.mjs';
import authRoutes from './routes/auth.mjs';
import chatRoutes from './routes/chat.mjs';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cookieParser());
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(generalLimiter);
app.use(express.static('public'));

app.use('/api/auth', authRoutes);
app.use('/api', chatRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

async function start() {
  try {
    await connectDB();
    initEmailService();
    app.listen(PORT, () => {
      console.log('FutureX Server running at http://localhost:' + PORT);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

process.on('SIGINT', async () => {
  await disconnectDB();
  process.exit(0);
});

start();