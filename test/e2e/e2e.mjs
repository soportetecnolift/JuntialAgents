// Prueba ENTRE SERVICIOS: Juntial Center real (proceso hijo) + JuntialAgents real (este proceso), por HTTP.
import { fork } from 'node:child_process';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
const AG = path.resolve(process.env.AGENTS_DIR || '.'); const CENTER = path.resolve(process.env.CENTER_DIR || '../juntial-center-bk');
const hex = () => crypto.randomBytes(12).toString('hex');
const ids = { ORG: hex(), ANA: hex(), ANA_M: hex(), PEPE_U: hex(), PEPE_M: hex(), OPS: hex() };
Object.assign(process.env, { DOTENV_CONFIG_PATH: 'test/.env.no-existe', NODE_ENV: 'test', LOG_LEVEL: 'silent', PORT: '7410', PUBLIC_API_URL: 'http://127.0.0.1:7410', WEB_URL: 'http://agents.test', CORS_ORIGINS: 'http://agents.test', MONGO_URI: 'mongodb://simulada', REDIS_URL: process.env.TEST_REDIS_URL || "redis://127.0.0.1:6379/14",
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'), JWT_ACCESS_SECRET: 'a'.repeat(40), JWT_REFRESH_SECRET: 'b'.repeat(40), ANTHROPIC_BASE_URL: 'http://127.0.0.1:7411', TELEGRAM_API_BASE: 'http://127.0.0.1:7412',
  CENTER_URL: 'http://127.0.0.1:7400', CENTER_WEB_URL: 'http://center.test', CENTER_APP_ID: 'juntialagents', CENTER_APP_SECRET: 'secreto-compartido-e2e-1234' });
const child = fork(new URL('./center-child.mjs', import.meta.url), { env: { ...process.env, CENTER_DIR: CENTER, E2E_IDS: JSON.stringify(ids) }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
await new Promise((r) => child.once('message', r));
const ok = (c, m) => { console.log(`${c ? '✅' : '❌'} ${m}`); if (!c) process.exitCode = 1; };
// IA y Telegram simulados para el empleado
http.createServer((q, s) => { let b = ''; q.on('data', (x) => (b += x)); q.on('end', () => { const body = JSON.parse(b); const n = body.messages.filter((m) => JSON.stringify(m.content).includes('tool_result')).length;
  const content = n ? [{ type: 'text', text: '<aviso>Te dejo un cambio para aprobar.</aviso>' }] : [{ type: 'text', text: 'Supera 5.000 €.' }, { type: 'tool_use', id: 't1', name: 'crm_update', input: { id: 'rec1', fields: { status: 'Cualificado' }, total: 12100 } }];
  s.writeHead(200, { 'content-type': 'application/json' }); s.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'x', stop_reason: n ? 'end_turn' : 'tool_use', usage: { input_tokens: 1, output_tokens: 1 }, content })); }); }).listen(7411);
let mid = 500; http.createServer((q, s) => { let b = ''; q.on('data', (x) => (b += x)); q.on('end', () => { const m = q.url.split('/').pop(); const body = b ? JSON.parse(b) : {}; s.writeHead(200, { 'content-type': 'application/json' }); s.end(JSON.stringify({ ok: true, result: m === 'sendMessage' ? { message_id: ++mid, chat: { id: body.chat_id } } : true })); }); }).listen(7412);

const M = await import(`${AG}/src/models/index.js`); const { installFakeDb, oid } = await import(`${AG}/test/helpers/fakedb.mjs`);
const mongoose = (await import(`${AG}/node_modules/mongoose/index.js`)).default; mongoose.connect = async () => {};
const db = installFakeDb(M, ['User', 'Session', 'Tenant', 'Plan', 'Usage', 'Bot', 'Notification', 'Audit', 'ApiRequestLog', 'ApiKey', 'WorkerRun', 'WorkerApproval', 'WorkerMessage', 'WorkerLink', 'BotLog', 'CrmRecord', 'CrmActivity', 'FieldDef', 'Workflow', 'CrmFunction', 'ChatContext', 'Message']);
const { redis } = await import(`${AG}/src/lib/redis.js`); await redis.flushdb();
db.Plan.push({ _id: 'free', slug: 'free', name: 'Gratis', limits: {} });
const { createApp } = await import(`${AG}/src/app.js`); createApp().listen(7410);
const A = 'http://127.0.0.1:7410'; const C = 'http://127.0.0.1:7400';
const jwt = (await import(`${CENTER}/node_modules/jsonwebtoken/index.js`)).default;
const centerSession = (sub, email) => jwt.sign({ sub, role: 'client', tid: ids.ORG, sid: 's1', email }, 'c'.repeat(40), { expiresIn: '5m' });

console.log('\n── 1. SSO: «Entrar con Juntial Center» ──');
const start = await fetch(`${A}/api/auth/sso/start?next=/bots`, { redirect: 'manual' });
const authz = await fetch(start.headers.get('location'), { redirect: 'manual' });
const reqId = new URL(authz.headers.get('location')).searchParams.get('req');
ok(authz.headers.get('location').startsWith('http://center.test/oauth/consent'), 'Center recibe la petición y manda al panel de Center a identificarse');
const info = await (await fetch(`${C}/api/oauth/request/${reqId}`, { headers: { authorization: `Bearer ${centerSession(ids.ANA, 'ana@tecnolift.es')}` } })).json();
ok(info.client.firstParty === true, 'JuntialAgents es app de primera parte (sin pantalla de consentimiento)');
const cons = await (await fetch(`${C}/api/oauth/consent`, { method: 'POST', headers: { authorization: `Bearer ${centerSession(ids.ANA, 'ana@tecnolift.es')}`, 'content-type': 'application/json' }, body: JSON.stringify({ req: reqId, approve: true, orgId: ids.ORG }) })).json();
const back = await fetch(cons.redirect, { redirect: 'manual' });
ok(back.headers.get('location') === 'http://agents.test/bots', `vuelve a Agents con sesión abierta (${back.headers.get('location')})`);
const cookie = back.headers.get('set-cookie').split(';')[0];
const tok = (await (await fetch(`${A}/api/auth/refresh`, { method: 'POST', headers: { cookie, origin: 'http://agents.test' } })).json()).accessToken;
const me = await (await fetch(`${A}/api/org/me`, { headers: { authorization: `Bearer ${tok}` } })).json();
ok(me.organizations?.[0]?.name === 'Tecnolift' && me.membership?.appRole === 'admin', 'Agents conoce su organización y su rol (preguntando a Center)');
ok((await fetch(`${A}/api/bots`, { headers: { authorization: `Bearer ${tok}` } })).status === 200, 'puede usar el panel de Agents');

console.log('\n── 2. Aprobación con política: Agents pide → Center decide → Agents ejecuta ──');
const { encrypt } = await import(`${AG}/src/lib/crypto.js`);
db.CrmRecord.push({ _id: 'rec1', tenantId: ids.ORG, data: { name: 'Colombia 15', status: 'Nuevo' } });
const TGB = oid(); db.Bot.push({ _id: TGB, tenantId: ids.ORG, kind: 'telegram', name: 'Sara', status: 'active', telegram: { connected: true, tokenEnc: encrypt('123:ABC') }, ai: {}, behavior: {}, flood: {} });
const W = oid(); db.Bot.push({ _id: W, tenantId: ids.ORG, kind: 'worker', name: 'Lucia', status: 'active', mcpServerIds: [], telegram: {}, ai: { provider: 'anthropic', model: 'x', apiKeyEnc: encrypt('sk-ant-prueba-1234567890') },
  worker: { title: 'Coordinador de operaciones', departmentId: ids.OPS, memory: [], knowledge: {}, journal: [], threads: [], people: [], autonomy: { policy: { read: 'auto', internal: 'auto', data: 'approve' }, workingHours: { enabled: false } }, reporting: { notifyPanel: true, telegramBotId: TGB, chatId: 111 } } });
const { runWorker } = await import(`${AG}/src/modules/worker/engine.js`);
await runWorker({ botId: W, trigger: { type: 'manual', label: 'Facturas' }, instruction: 'Revisa' });
const ap = () => db.WorkerApproval.at(-1);
ok(!!ap().centerApprovalId && ap().policyName === 'Compras de Operaciones > 5.000 €', `Center aplicó la política «${ap().policyName}»`);
const { route } = await import(`${AG}/src/telegram/ingress.js`); const { getBotRuntime } = await import(`${AG}/src/telegram/runtime.js`);
await route(await getBotRuntime(TGB), { callback_query: { id: 'cq', from: { id: 9, username: 'pepe_ops' }, message: { message_id: ap().tgMessages[0].messageId, chat: { id: 111, type: 'group' } }, data: `a|${ap()._id}|y` } });
await new Promise((r) => setTimeout(r, 800));
ok(ap().status === 'executed', `Pepe (responsable del área) aprueba por Telegram → ejecutada en Agents (${ap().status}, por ${ap().decidedBy})`);
ok(db.CrmRecord[0].data.status === 'Cualificado', 'la acción del empleado se hizo de verdad');

console.log('\n── 3. Claude conecta al MCP de Agents con OAuth de Center ──');
const pr = await (await fetch(`${A}/.well-known/oauth-protected-resource`)).json();
const asm = await (await fetch(`${pr.authorization_servers[0]}/.well-known/oauth-authorization-server`)).json();
ok(asm.issuer === C, 'el MCP de Agents señala a Center como servidor de autorización');
const reg = await (await fetch(asm.registration_endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], token_endpoint_auth_method: 'none' }) })).json();
const v = crypto.randomBytes(32).toString('base64url'); const ch = crypto.createHash('sha256').update(v).digest('base64url');
const a2 = await fetch(`${asm.authorization_endpoint}?${new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', code_challenge: ch, code_challenge_method: 'S256', scope: 'juntial:read juntial:write', resource: pr.resource })}`, { redirect: 'manual' });
const r2 = new URL(a2.headers.get('location')).searchParams.get('req');
const c2 = await (await fetch(`${C}/api/oauth/consent`, { method: 'POST', headers: { authorization: `Bearer ${centerSession(ids.ANA, 'ana@tecnolift.es')}`, 'content-type': 'application/json' }, body: JSON.stringify({ req: r2, approve: true, orgId: ids.ORG, access: 'write' }) })).json();
const t2 = await (await fetch(asm.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: new URL(c2.redirect).searchParams.get('code'), redirect_uri: 'https://claude.ai/api/mcp/auth_callback', client_id: reg.client_id, code_verifier: v }) })).json();
const mcp = await (await fetch(`${A}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${t2.access_token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) })).json();
ok(mcp.result?.tools?.length >= 35, `Agents valida el token en Center y ofrece ${mcp.result?.tools?.length} herramientas`);
const lst = await (await fetch(`${A}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${t2.access_token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_departments', arguments: {} } }) })).json();
ok(/Operaciones/.test(lst.result?.content?.[0]?.text || ''), 'una herramienta de organización (áreas) responde con datos de Center');
child.kill(); process.exit(process.exitCode || 0);
