const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.OPENROUTER_MODEL || 'openrouter/free';
const UPSTREAM = process.env.OPENROUTER_URL || 'https://openrouter.ai/api/v1/chat/completions';
const APP_TOKEN = process.env.FHINIX_APP_TOKEN || '';

const allowedOrigins = new Set([
  'https://localhost', 'http://localhost', 'capacitor://localhost',
  ...(process.env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean)
]);
app.disable('x-powered-by');
app.use(cors({ origin(origin, callback) {
  if (!origin || allowedOrigins.has(origin)) return callback(null, true);
  return callback(new Error('Origem não permitida pelo CORS.'));
}}));
app.use(express.json({ limit: '64kb' }));
app.use('/chat', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Muitas mensagens em pouco tempo. Tente novamente mais tarde.' } }));

app.get('/health', (_req, res) => res.json({ ok: true, modelConfigured: Boolean(API_KEY), service: 'FHINIX AI', version: '1.2.0' }));

app.post('/chat', async (req, res) => {
  try {
    if (!API_KEY) return res.status(503).json({ error: 'O servidor ainda não tem OPENROUTER_API_KEY configurada.' });
    if (APP_TOKEN && req.get('x-fhinix-token') !== APP_TOKEN) return res.status(401).json({ error: 'Aplicativo não autorizado.' });
    const body = req.body || {};
    if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 30) {
      return res.status(400).json({ error: 'Envie uma lista válida de mensagens (máximo 30).' });
    }
    const messages = body.messages.map(m => {
      if (!m || !['system', 'user', 'assistant'].includes(m.role) || typeof m.content !== 'string') throw new Error('Formato de mensagem inválido.');
      return { role: m.role, content: m.content.slice(0, 16000) };
    });
    const maxTokens = Math.max(100, Math.min(Number(body.max_tokens) || 1200, 2000));
    const upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': process.env.SITE_URL || 'https://fhinix-ai.onrender.com', 'X-Title': 'FHINIX AI - DVL Labs' },
      body: JSON.stringify({ model: MODEL, messages, temperature: 0.4, max_tokens: maxTokens, reasoning: { exclude: true } }),
      signal: AbortSignal.timeout(60000)
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const message = data?.error?.message || `O provedor respondeu HTTP ${upstream.status}.`;
      return res.status(upstream.status >= 500 ? 502 : upstream.status).json({ error: message });
    }
    return res.json(data);
  } catch (err) {
    const message = String(err?.message || err);
    const status = message.includes('Formato de mensagem') ? 400 : 502;
    return res.status(status).json({ error: message.slice(0, 300) });
  }
});

app.use(express.static('www', { extensions: ['html'] }));
app.listen(PORT, '0.0.0.0', () => console.log(`FHINIX AI server listening on ${PORT}`));
