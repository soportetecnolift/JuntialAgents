import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, fakeDb, fakeCenter, resetRedis } from '../helpers/setup.mjs';
const PORT = 6800; setupEnv(PORT);
const center = fakeCenter(PORT + 3);
const { db, oid } = await fakeDb(['User', 'Session', 'Tenant', 'Plan', 'Usage', 'Bot', 'Notification', 'Audit', 'ApiRequestLog', 'ApiKey']);
db.Plan.push({ _id: 'plan-free', slug: 'free', name: 'Gratis', limits: {} });
const U = String(oid()); const ORG = String(oid()); const ORG2 = String(oid());
// Center simulado: OAuth del SSO
let tokenBody;
center.on('POST /oauth/token', (b, _q, _p, req) => { tokenBody = { ...b, auth: req.headers.authorization }; return b.code === 'codigo-bueno' ? { access_token: 'ja_oat_center', refresh_token: 'ja_ort_center', token_type: 'Bearer' } : { __status: 400, body: { error: 'invalid_grant' } }; });
center.on('GET /oauth/userinfo', () => ({ sub: U, email: 'ana@tecnolift.es', name: 'Ana', role: 'client', tid: ORG }));
center.on('POST /oauth/revoke', () => ({}));
center.on('GET /internal/orgs/:id', (_b, _q, id) => ({ id, name: id === ORG ? 'Tecnolift' : 'Cota Cero', status: 'active' }));
let roles = { [ORG]: 'admin', [ORG2]: 'viewer' };
center.on('GET /internal/memberships', (_b, q) => (roles[q.get('orgId')] ? { orgId: q.get('orgId'), userId: q.get('userId'), orgRole: 'member', appRole: roles[q.get('orgId')], appEnabled: true } : { __status: 404, body: {} }));
center.on('GET /internal/users/:id/orgs', () => [{ id: ORG, name: 'Tecnolift', appRole: 'admin' }, { id: ORG2, name: 'Cota Cero', appRole: 'viewer' }]);

const { createApp } = await import('../../src/app.js'); let srv; const P = `http://127.0.0.1:${PORT}`;
before(async () => { await resetRedis(); srv = createApp().listen(PORT); }); after(() => srv?.close());
let cookie;
const api = (method, path, token, body) => fetch(`${P}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', origin: 'http://panel.test' }, body: body ? JSON.stringify(body) : undefined });
async function refresh() { const r = await fetch(`${P}/api/auth/refresh`, { method: 'POST', headers: { cookie, origin: 'http://panel.test' } }); const j = await r.json(); cookie = (r.headers.get('set-cookie') || cookie).split(';')[0]; return j.accessToken; }

test('«Entrar con Juntial Center»: redirige a Center con PKCE y, al volver, abre la sesión de Agents', async () => {
  const s = await fetch(`${P}/api/auth/sso/start?next=/bots`, { redirect: 'manual' });
  const loc = new URL(s.headers.get('location'));
  assert.equal(loc.origin + loc.pathname, `http://127.0.0.1:${PORT + 3}/oauth/authorize`);
  assert.equal(loc.searchParams.get('client_id'), 'juntialagents'); assert.equal(loc.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(loc.searchParams.get('redirect_uri'), `${P}/api/auth/sso/callback`);
  const cb = await fetch(`${P}/api/auth/sso/callback?code=codigo-bueno&state=${loc.searchParams.get('state')}`, { redirect: 'manual' });
  assert.equal(cb.headers.get('location'), 'http://panel.test/bots', 'vuelve a la página de la que venía');
  assert.ok(tokenBody.code_verifier && tokenBody.auth.startsWith('Basic '), 'canjea con PKCE y el secreto de la app (servidor a servidor)');
  cookie = cb.headers.get('set-cookie').split(';')[0]; assert.match(cookie, /^ja_rt=/);
  assert.equal(db.User.find((u) => String(u._id) === U).email, 'ana@tecnolift.es', 'copia local del usuario con el id de Center');
  const t = db.Tenant.find((x) => String(x._id) === ORG); assert.equal(t.name, 'Tecnolift'); assert.equal(String(t.subscription.planId), 'plan-free', 'la organización llega con el plan gratuito de Agents');
  assert.ok(center.calls.some((c) => c.path === '/oauth/revoke'), 'el token de Center se revoca tras leer la identidad');
});

test('callbacks no válidos: estado desconocido o error de Center vuelven al login con el motivo', async () => {
  const r = await fetch(`${P}/api/auth/sso/callback?code=codigo-bueno&state=inventado`, { redirect: 'manual' });
  assert.match(r.headers.get('location'), /\/login\?error=/);
  const r2 = await fetch(`${P}/api/auth/sso/callback?error=access_denied`, { redirect: 'manual' });
  assert.match(r2.headers.get('location'), /error=access_denied/);
});

test('sesión de Agents: renovación, permisos por rol de Center y cambio de organización', async () => {
  let token = await refresh(); assert.ok(token);
  assert.equal((await api('GET', '/api/bots', token)).status, 200);
  assert.equal((await api('POST', '/api/bots', token, { name: 'Bot prueba', kind: 'web' })).status !== 403, true, 'admin puede crear');
  const orgs = await (await api('GET', '/api/auth/orgs', token)).json(); assert.deepEqual(orgs.map((o) => o.name), ['Tecnolift', 'Cota Cero']);
  assert.equal((await api('POST', '/api/auth/switch-org', token, { orgId: ORG2 })).status, 200);
  token = await refresh();
  assert.equal((await api('GET', '/api/bots', token)).status, 200, 'el lector puede consultar');
  const w = await api('POST', '/api/bots', token, { name: 'X', kind: 'web' }); assert.equal(w.status, 403); assert.match((await w.json()).error.message, /solo lectura/);
  roles[ORG2] = 'none'; await resetRedis(); cookie = cookie; token = await refresh();
  assert.equal((await api('GET', '/api/bots', token)).status, 403, 'sin acceso a la app en esa organización');
});

test('si Center no responde, se usan los últimos permisos conocidos', async () => {
  roles[ORG2] = 'viewer'; await resetRedis(); const token = await refresh();
  assert.equal((await api('GET', '/api/bots', token)).status, 200); // guarda los últimos permisos
  await (await import('../../src/lib/redis.js')).redis.del(`ctr:mbr:${ORG2}:${U}`); center.down = true;
  assert.equal((await api('GET', '/api/bots', token)).status, 200, 'sigue funcionando con los últimos permisos');
  center.down = false;
});
