import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, fakeDb, fakeCenter, resetRedis } from '../helpers/setup.mjs';
// Dirección pública (túnel) ≠ dirección del panel (localhost): el login se completa en la del panel
const PORT = 7150; setupEnv(PORT, { AUTH_API_URL: `http://localhost:${PORT}` });
const center = fakeCenter(PORT + 3);
const { db, oid } = await fakeDb(['User', 'Session', 'Tenant', 'Plan', 'Usage', 'Bot', 'Notification', 'Audit', 'ApiRequestLog', 'ApiKey']);
db.Plan.push({ _id: 'plan-free', slug: 'free', name: 'Gratis', limits: {} });
const U = String(oid()); const ORG = String(oid());
center.on('POST /oauth/token', () => ({ access_token: 'ja_oat_c', refresh_token: 'ja_ort_c' }));
center.on('GET /oauth/userinfo', () => ({ sub: U, email: 'ana@tecnolift.es', name: 'Ana', role: 'client', tid: ORG }));
center.on('POST /oauth/revoke', () => ({}));
const { createApp } = await import('../../src/app.js'); let srv; const PUB = `http://127.0.0.1:${PORT}`;
before(async () => { await resetRedis(); srv = createApp().listen(PORT); }); after(() => srv?.close());

test('el login vuelve a la dirección pública, pero la sesión se abre en la del panel con un pase de un solo uso', async () => {
  const start = await fetch(`http://localhost:${PORT}/api/auth/sso/start?next=/bots`, { redirect: 'manual' });
  const loc = new URL(start.headers.get('location'));
  assert.equal(loc.searchParams.get('redirect_uri'), `${PUB}/api/auth/sso/callback`, 'Center devuelve a la dirección pública registrada');
  const cb = await fetch(`${PUB}/api/auth/sso/callback?code=c&state=${loc.searchParams.get('state')}`, { redirect: 'manual' });
  const fin = cb.headers.get('location');
  assert.match(fin, new RegExp(`^http://localhost:${PORT}/api/auth/sso/finish\\?t=`)); assert.equal(cb.headers.get('set-cookie'), null, 'la cookie NO se deja en la pública');
  const done = await fetch(fin, { redirect: 'manual' });
  assert.equal(done.headers.get('location'), 'http://panel.test/bots'); assert.match(done.headers.get('set-cookie'), /^ja_rt=/);
  const again = await fetch(fin, { redirect: 'manual' });
  assert.match(again.headers.get('location'), /login\?error=/, 'el pase no se puede reutilizar');
});
