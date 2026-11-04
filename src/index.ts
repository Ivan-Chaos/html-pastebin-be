import express from 'express';
import cors from 'cors';

const PORT = Number(process.env.PORT ?? 4000);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:3000';

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: '200kb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`API listening on :${PORT}`));
