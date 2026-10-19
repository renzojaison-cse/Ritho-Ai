import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateCoachResponse } from './src/server/geminiService.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());

app.post('/api/coach/chat', async (req, res) => {
  try {
    const { message, history, context } = req.body;
    const reply = await generateCoachResponse(message || '', history || [], context);
    res.json({ reply });
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Serve frontend build in production
app.use(express.static(path.join(__dirname, 'dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Ritho AI production server listening on port ${PORT}`);
});
