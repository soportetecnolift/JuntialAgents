/**
 * Inicio de sesión único con Juntial Center (OAuth 2.1 authorization code + PKCE, cliente confidencial).
 * El navegador solo ve redirecciones: el código se canjea aquí con el secreto de la app y el token de Center se
 * revoca nada más leer la identidad. Agents guarda una COPIA LOCAL (proyección) del usuario y de la organización,
 * con el mismo id que en Center, para que todo su código siga consultando User y Tenant como siempre.
 */
import crypto from 'node:crypto';
import { User, Tenant, Plan } from '../../models/index.js';
import { env } from '../../config/env.js';
import { redis } from '../../lib/redis.js';
import { center } from '../../lib/center.js';
import { logger } from '../../config/logger.js';

const REDIRECT = () => `${env.PUBLIC_API_URL.replace(/\/$/, '')}/api/auth/sso/callback`;
const C = () => env.CENTER_URL.replace(/\/$/, '');
const basicAuth = () => `Basic ${Buffer.from(`${env.CENTER_APP_ID}:${env.CENTER_APP_SECRET}`).toString('base64')}`;

/** Copia local de la organización (con su plan de JuntialAgents; el plan gratuito al llegar por primera vez). */
export async function ensureTenant(orgId, orgInfo) {
  if (!orgId) return null;
  const exists = await Tenant.findById(orgId).lean();
  const info = orgInfo || (await center.org(orgId).catch(() => null)) || {};
  if (exists) { if (info.name && info.name !== exists.name) await Tenant.updateOne({ _id: orgId }, { name: info.name }); return exists; }
  const free = await Plan.findOne({ slug: 'free' }).lean(); const now = new Date();
  return (await Tenant.create({ _id: orgId, name: info.name || 'Organización', status: info.status === 'suspended' ? 'suspended' : 'active', subscription: { planId: free?._id, status: 'active', currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + 30 * 86400000) } })).toObject();
}
/** Copia local del usuario con el mismo id que en Center. */
export async function provisionUser(info) {
  const set = { email: String(info.email).toLowerCase(), name: info.name, avatar: info.avatar, role: info.role || 'client', status: 'active', emailVerified: true };
  if (info.tid !== undefined) set.tenantId = info.tid || null;
  // Si había una copia antigua con ese email y otro id, se retira (Center manda)
  await User.deleteMany({ email: set.email, _id: { $ne: info.sub } });
  await User.updateOne({ _id: info.sub }, { $set: set }, { upsert: true });
  if (info.tid) await ensureTenant(info.tid);
  return User.findById(info.sub);
}

export async function startUrl(next) {
  const state = crypto.randomBytes(18).toString('base64url'); const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  await redis.set(`sso:${state}`, JSON.stringify({ verifier, next: typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/' }), 'EX', 600);
  return `${C()}/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: env.CENTER_APP_ID, redirect_uri: REDIRECT(), code_challenge: challenge, code_challenge_method: 'S256', state, scope: 'openid profile', resource: env.PUBLIC_API_URL.replace(/\/$/, '') })}`;
}

/** Canjea el código de Center, lee la identidad, revoca el token de Center y devuelve el usuario local. */
export async function finish({ code, state }) {
  const saved = JSON.parse((await redis.getdel(`sso:${state}`)) || 'null');
  if (!saved) throw new Error('El inicio de sesión caducó. Vuelve a intentarlo.');
  const tr = await fetch(`${C()}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: basicAuth() }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT(), code_verifier: saved.verifier }), signal: AbortSignal.timeout(10000) });
  const tok = await tr.json().catch(() => ({}));
  if (!tr.ok || !tok.access_token) throw new Error(tok.error_description || 'Juntial Center no aceptó el inicio de sesión');
  const ui = await fetch(`${C()}/oauth/userinfo`, { headers: { authorization: `Bearer ${tok.access_token}` }, signal: AbortSignal.timeout(10000) });
  const info = await ui.json().catch(() => ({}));
  fetch(`${C()}/oauth/revoke`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: tok.refresh_token || tok.access_token }) }).catch(() => {});
  if (!ui.ok || !info.sub) throw new Error('No se pudo leer tu identidad en Juntial Center');
  if (info.role === 'client' && info.tid) {
    const m = await center.membership(info.sub, info.tid);
    if (!m) throw new Error('No perteneces a esa organización');
    if (m.appRole === 'none' || m.appEnabled === false) throw new Error('No tienes acceso a JuntialAgents en esta organización. Pídeselo a un administrador en Juntial Center.');
  }
  logger.info({ user: info.email, org: info.tid }, 'SSO: sesión iniciada con Juntial Center');
  return { user: await provisionUser(info), next: saved.next };
}
