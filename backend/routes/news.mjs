import express from 'express';
import { getNews } from '../config/news.mjs';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const news = await getNews();
    res.json(news);
  } catch (error) {
    console.error('News route error:', error.message);
    res.status(500).json({ error: 'News feed unavailable.' });
  }
});

export default router;
