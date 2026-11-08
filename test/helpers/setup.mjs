/**
 * Utilidades comunes de las pruebas. IMPORTANTE: llama a setupEnv() ANTES de importar nada de src/,
 * porque src/config/env.js valida las variables al cargarse.
 *
 * Redis: las pruebas necesitan un Redis real (BullMQ usa scripts Lua). Usan TEST_REDIS_URL o, por defecto,
 * redis://127.0.0.1:6379/15 (base de datos 15, para no tocar la de desarrollo) y la vacían en cada fichero.
 */
import http from 'node:http';

export const REDIS_URL = process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379/15';
export const CENTER_SECRET = 'secreto-de-agents-para-pruebas';

export function setupEnv(port, extra = {}) {
  Object.assign(process.env, {
    // Las pruebas NUNCA leen el .env de quien las ejecuta: su configuración es solo la de aquí
    DOTENV_CONFIG_PATH: 'test/.env.no-existe',
    NODE_ENV: 'test', LOG_LEVEL: 'silent', PORT: String(port),
    PUBLIC_API_URL: `http://127.0.0.1:${port}`, WEB_URL: 'http://panel.test', CORS_ORIGINS: 'http://panel.test',
    MONGO_URI: 'mongodb://simulada', REDIS_URL,
    ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'), JWT_ACCESS_SECRET: 'a'.repeat(40), JWT_REFRESH_SECRET: 'b'.repeat(40),
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${port + 1}`, TELEGRAM_API_BASE: `http://127.0.0.1:${port + 2}`,
    CENTER_URL: `http://127.0.0.1:${port + 3}`, CENTER_WEB_URL: 'http://center.test', CENTER_APP_ID: 'juntialagents', CENTER_APP_SECRET: CENTER_SECRET,
    ...extra,
  });
}

/** Instala la base simulada sobre los modelos indicados y devuelve { db, oid, M }. */
export async function fakeDb(names) {
  const M = await import('../../src/models/index.js');
  const { installFakeDb, oid } = await import('./fakedb.mjs');
  // Por si algún módulo intenta conectar: que no espere a un Mongo inexistente
  const mongoose = (await import('mongoose')).default; mongoose.connect = async () => {}; mongoose.disconnect = async () => {};
  return { db: installFakeDb(M, names), oid, M };
}

export async function resetRedis() {
  const { redis } = await import('../../src/lib/redis.js');
  await redis.flushdb();
  return redis;
}

/**
 * IA simulada con la API de Anthropic. handler(body) devuelve { content: [...], stop_reason } o un texto.
 * Se guardan todas las peticiones en llm.requests para comprobar prompts y herramientas ofrecidas.
 */
export function fakeLLM(port, handler) {
  const llm = { requests: [] };
  llm.server = http.createServer((q, s) => {
    let b = ''; q.on('data', (c) => (b += c));
    q.on('end', async () => {
      const body = JSON.parse(b); llm.requests.push(body);
      let r = await handler(body); if (typeof r === 'string') r = { content: [{ type: 'text', text: r }] };
      const content = r.content?.length ? r.content : [{ type: 'text', text: '' }];
      const stop = r.stop_reason || (content.some((x) => x.type === 'tool_use') ? 'tool_use' : 'end_turn');
      s.writeHead(200, { 'content-type': 'application/json' });
      s.end(JSON.stringify({ id: 'msg', type: 'message', role: 'assistant', model: 'simulado', stop_reason: stop, usage: { input_tokens: 1, output_tokens: 1 }, content }));
    });
  }).listen(port);
  return llm;
}
/** Nº de resultados de herramientas que ya ha recibido el modelo en esta petición (para simular varios pasos). */
export const toolResults = (body) => body.messages.filter((m) => JSON.stringify(m.content).includes('tool_result')).length;
export const systemText = (body) => JSON.stringify(body.system || '');

/** Telegram simulado: registra cada llamada en tg.calls y devuelve message_id crecientes. */
export function fakeTelegram(port) {
  const tg = { calls: [], sent: () => tg.calls.filter((c) => c.method === 'sendMessage') };
  let mid = 100;
  tg.server = http.createServer((q, s) => {
    let b = ''; q.on('data', (c) => (b += c));
    q.on('end', () => {
      const method = q.url.split('/').pop(); const body = b ? JSON.parse(b) : {}; tg.calls.push({ method, ...body });
      const result = method === 'sendMessage' ? { message_id: ++mid, chat: { id: body.chat_id } } : method === 'getMe' ? { id: 1, username: 'BotPrueba' } : true;
      s.writeHead(200, { 'content-type': 'application/json' }); s.end(JSON.stringify({ ok: true, result }));
    });
  }).listen(port);
  return tg;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Datos base: organización, plan y usuario propietario. */
export function seedTenant(db, oid) {
  const T = oid(); const U = oid();
  db.Plan?.push({ _id: 'plan-pro', slug: 'pro', name: 'Pro', limits: {} });
  db.Tenant.push({ _id: T, name: 'Tecnolift', ownerId: U, status: 'active', subscription: { planId: 'plan-pro' } });
  db.User?.push({ _id: U, email: 'soporte@tecnolift.es', name: 'Soporte', role: 'client', tenantId: T, status: 'active', notificationPrefs: { inApp: true, email: false } });
  return { T, U };
}

/** Empleado digital de prueba (con su API key de IA simulada). */
export async function makeWorker(db, oid, T, worker = {}, extra = {}) {
  const { encrypt } = await import('../../src/lib/crypto.js');
  const W = oid();
  db.Bot.push({
    _id: W, tenantId: T, kind: 'worker', name: 'Lucia', status: 'active', mcpServerIds: [], telegram: {},
    ai: { provider: 'anthropic', model: 'simulado', apiKeyEnc: encrypt('sk-ant-prueba-1234567890') },
    worker: {
      title: 'Coordinador de operaciones', memory: [], knowledge: {}, journal: [], threads: [], people: [], style: 'corto',
      autonomy: { policy: { read: 'auto', internal: 'auto', data: 'approve', external: 'approve', destructive: 'off' }, workingHours: { enabled: false } },
      reporting: { notifyPanel: true }, ...worker,
    },
    ...extra,
  });
  return W;
}

/**
 * Juntial Center simulado: API interna (/internal/*) y OAuth (/oauth/*). Registra cada llamada en center.calls.
 * Respuestas por defecto razonables (sin política, membresía de administrador…); cada prueba puede sobrescribirlas
 * con center.on('POST /internal/approvals', (body, req) => respuesta) o center.on('GET /internal/memberships', …).
 */
export function fakeCenter(port, defaults = {}) {
  const c = { calls: [], handlers: {}, on(route, fn) { this.handlers[route] = fn; return this; }, down: false };
  const def = {
    'POST /internal/approvals': () => ({ policy: null }),
    'POST /internal/events': () => ({ ok: true }),
    // Por defecto, quien pregunta por su id es administrador; por Telegram o email nadie es miembro (como el Center real con desconocidos)
    'GET /internal/memberships': (_b, q) => (q.get('userId') ? { id: 'm1', orgId: q.get('orgId'), userId: q.get('userId'), orgRole: 'owner', appRole: 'admin', appEnabled: true } : { __status: 404, body: { error: { message: 'Membresía no encontrada' } } }),
    'GET /internal/orgs/:id': (_b, _q, id) => ({ id, name: 'Tecnolift', status: 'active' }),
    'GET /internal/users/:id/orgs': () => [],
    'GET /internal/orgs/:id/departments': () => [],
    'POST /internal/oauth/introspect': () => ({ active: false }),
    ...defaults,
  };
  c.server = http.createServer((q, s) => {
    let b = ''; q.on('data', (x) => (b += x));
    q.on('end', async () => {
      const u = new URL(q.url, 'http://x'); const body = b ? (q.headers['content-type']?.includes('json') ? JSON.parse(b) : Object.fromEntries(new URLSearchParams(b))) : null;
      c.calls.push({ method: q.method, path: u.pathname, query: Object.fromEntries(u.searchParams), body, headers: q.headers });
      if (c.down) { s.writeHead(503); return s.end('{}'); }
      const key = `${q.method} ${u.pathname}`; const all = { ...def, ...c.handlers };
      let fn = all[key]; let param;
      if (!fn) for (const [k, f] of Object.entries(all)) { const [m, pat] = k.split(' '); if (m !== q.method || !pat.includes(':')) continue; const re = new RegExp(`^${pat.replace(/:[^/]+/g, '([^/]+)')}$`); const mm = u.pathname.match(re); if (mm) { fn = f; param = mm[1]; break; } }
      if (!fn) { s.writeHead(404, { 'content-type': 'application/json' }); return s.end('{"error":{"message":"No encontrado"}}'); }
      const r = await fn(body, u.searchParams, param, q);
      if (r && r.__status) { s.writeHead(r.__status, { 'content-type': 'application/json', ...(r.__headers || {}) }); return s.end(JSON.stringify(r.body ?? {})); }
      s.writeHead(200, { 'content-type': 'application/json' }); s.end(JSON.stringify(r ?? null));
    });
  }).listen(port);
  return c;
}
/** Firma como lo hace Center (para simular sus avisos de decisión). */
export async function centerSign(body) {
  const crypto = await import('node:crypto'); const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${crypto.createHmac('sha256', CENTER_SECRET).update(`${t}.${body}`).digest('hex')}`;
}
