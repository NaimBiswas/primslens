import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import reviewRoutes from './routes/review.js';
import morgan  from 'morgan';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ─────────────────────────────────────────────────────────────

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '5mb' }));
app.use(morgan('dev'));

// ─── API Routes ────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.use('/api', reviewRoutes);

// ─── Serve Client Static Files ─────────────────────────────────────────────

const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));

// Fallback to index.html for SPA routing (non-API paths)
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(clientDist, 'index.html'));
});

// ─── HTTP Server ────────────────────────────────────────────────────────────

const server = http.createServer(app);

// ─── Start ─────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log('');
  console.log('╔═════════════════════════════════════════════════════════╗');
  console.log('║   🚀 PRISMLENS — Code Review Server                     ║');
  console.log('╠═════════════════════════════════════════════════════════╣');
  console.log(`║   🌐 http://localhost:${PORT}                             ║`);
  console.log(`║   📡 API  http://localhost:${PORT}/api                    ║`);
  console.log(`║   ❤️  Health  http://localhost:${PORT}/api/health         ║`);
  console.log('╚═════════════════════════════════════════════════════════╝');
  console.log('');
});
