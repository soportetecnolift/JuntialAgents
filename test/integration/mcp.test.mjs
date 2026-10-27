import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, fakeDb, fakeCenter, resetRedis, seedTenant } from '../helpers/setup.mjs';
const PORT = 7000; setupEnv(PORT);
const center = fakeCenter(PORT + 3);
const { db, oid } = await fakeDb(['User', 'Tenant', 'Plan', 'Bot', 'CrmRecord', 'FieldDef', 'ApiRequestLog', 'ApiKey', 'Audit', 'WorkerApproval', 'Usage', 'Workflow', 'CrmFunction', 'Session']);
const { T, U } = seedTenant(db, oid);
db.Bot.push({ _id: oid(), tenantId: T, name: 'Lucía', kind: 'worker', status: 'active', ai: {}, worker: { title: 'Cobros' }, telegram: {} });
db.CrmRecord.push({ _id: oid(), tenantId: T, data: { name: 'Ana García', status: 'Cualificado' }, updatedAt: new Date() });
let role = 'admin';
center.on('POST /internal/oauth/introspect', (b) => (b.token === 'ja_oat_bueno' ? { active: true, grantId: 'g1', clientId: 'claude', oauthScopes: ['juntial:read', 'juntial:write'], user: { id: String(U), role: 'client', tenantId: String(T), email: 'soporte@tecnolift.es' } } : { active: false }));
center.on('GET /internal/memberships', (_b, q) => ({ orgId: q.get('orgId'), userId: q.get('userId'), orgRole: 'member', appRole: role, appEnabled: true }));
const { createApp } = await import('../../src/app.js'); let srv; const P = `http://127.0.0.1:${PORT}`; const J = (r) => r.json();
before(async () => { await resetRedis(); srv = createApp().listen(PORT); }); after(() => srv?.close());
const mcp = (method, params, t = 'ja_oat_bueno') => fetch(`${P}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });

test('sin token: 401 con la pista del recurso, y el servidor de autorización es Juntial Center', async () => {
  const r = await fetch(`${P}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 401); assert.match(r.headers.get('www-authenticate'), /oauth-protected-resource/);
  const meta = await J(await fetch(`${P}/.well-known/oauth-protected-resource`));
  assert.equal(meta.resource, `${P}/mcp`); assert.deepEqual(meta.authorization_servers, [`http://127.0.0.1:${PORT + 3}`]);
  assert.equal((await mcp('initialize', {}, 'ja_oat_malo')).status, 401, 'un token que Center no reconoce no entra');
});

test('con un token válido en Center: herramientas, consulta real y respeto del rol (Lector)', async () => {
  const init = await J(await mcp('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Claude', version: '1' } }));
  assert.equal(init.result.serverInfo.name, 'juntial');
  const tools = (await J(await mcp('tools/list', {}))).result.tools; assert.ok(tools.length >= 35);
  const found = JSON.parse((await J(await mcp('tools/call', { name: 'crm_search_contacts', arguments: { query: 'Ana' } }))).result.content[0].text);
  assert.equal(found.items[0].data.name, 'Ana García');
  role = 'viewer'; await resetRedis();
  const denied = await J(await mcp('tools/call', { name: 'crm_create_contact', arguments: { data: { name: 'X' } } }));
  assert.match(denied.result.content[0].text, /solo lectura/);
});

test('CORS: el panel con cookies sí; una web ajena no; las apps de IA en /.well-known y /mcp sí', async () => {
  const pre = (path, origin) => fetch(`${P}${path}`, { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,authorization' } });
  assert.equal((await pre('/api/auth/refresh', 'http://panel.test')).headers.get('access-control-allow-origin'), 'http://panel.test');
  assert.equal((await pre('/api/bots', 'https://evil.com')).headers.get('access-control-allow-origin'), null);
  assert.equal((await pre('/mcp', 'https://chatgpt.com')).headers.get('access-control-allow-origin'), '*');
});
