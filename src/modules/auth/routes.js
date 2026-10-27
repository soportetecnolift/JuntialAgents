import { Router } from 'express';
import { z } from 'zod';
import { User, Session } from '../../models/index.js';
import { asyncH, forbidden } from '../../lib/errors.js';
import { validate } from '../../middleware/common.js';
import { requireAuth } from '../../middleware/auth.js';
import { audit } from '../../lib/audit.js';
import { env } from '../../config/env.js';
import { center } from '../../lib/center.js';
import * as S from './service.js';
import { startUrl, finish, ensureTenant } from './sso.js';

/**
 * Acceso a JuntialAgents: SIEMPRE con Juntial Center (SSO). Agents no guarda contraseñas ni envía códigos:
 * el registro, el login, Google, el 2FA del equipo y la recuperación de cuenta están en Center.
 */
const r = Router();
const meta = (req) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });
function respond(res, s) {
  res.cookie(S.REFRESH_COOKIE, s.refreshToken, S.cookieOpts(s.expiresAt));
  res.json({ accessToken: s.accessToken, sessionExpiresAt: s.expiresAt, user: s.user });
}

/* ── SSO con Juntial Center ── */
r.get('/sso/start', asyncH(async (req, res) => res.redirect(302, await startUrl(req.query.next))));
r.get('/sso/callback', asyncH(async (req, res) => {
  const back = (q) => res.redirect(302, `${env.WEB_URL.replace(/\/$/, '')}/login?${new URLSearchParams(q)}`);
  if (req.query.error) return back({ error: req.query.error_description || req.query.error });
  try {
    const { user, next } = await finish({ code: String(req.query.code || ''), state: String(req.query.state || '') });
    const s = await S.createSession(user, { ...meta(req), method: 'sso' });
    res.cookie(S.REFRESH_COOKIE, s.refreshToken, S.cookieOpts(s.expiresAt));
    res.redirect(302, `${env.WEB_URL.replace(/\/$/, '')}${next || '/'}`);
  } catch (e) { back({ error: e.message }); }
}));

r.post('/refresh', asyncH(async (req, res) => {
  try { respond(res, await S.refreshSession(req.cookies[S.REFRESH_COOKIE], meta(req))); }
  catch (e) { res.clearCookie(S.REFRESH_COOKIE, S.cookieOpts()); throw e; }
}));

/* ── Autenticado ── */
r.post('/logout', requireAuth, asyncH(async (req, res) => {
  const s = await Session.findById(req.user.sid); if (s) await S.revokeSession(s);
  res.clearCookie(S.REFRESH_COOKIE, S.cookieOpts());
  res.json({ ok: true, centerUrl: env.CENTER_WEB_URL }); // el panel puede ofrecer cerrar también la sesión de Center
}));
r.get('/me', requireAuth, asyncH(async (req, res) => {
  const user = await User.findById(req.user.id); const s = await Session.findById(req.user.sid).lean();
  res.json({ user: S.publicUser(user), sessionExpiresAt: s?.expiresAt, centerUrl: env.CENTER_WEB_URL });
}));
r.get('/sessions', requireAuth, asyncH(async (req, res) => {
  const items = await Session.find({ userId: req.user.id, revokedAt: null, expiresAt: { $gt: new Date() } }).select('ip userAgent method createdAt lastUsedAt expiresAt').sort({ lastUsedAt: -1 }).lean();
  res.json(items.map((s) => ({ ...s, current: String(s._id) === req.user.sid })));
}));
r.delete('/sessions/:id', requireAuth, asyncH(async (req, res) => {
  const s = await Session.findOne({ _id: req.params.id, userId: req.user.id }); if (s) await S.revokeSession(s);
  audit(req, 'session.revoke', { kind: 'session', id: req.params.id }); res.json({ ok: true });
}));

/* ── Organizaciones (de Center) y cambio de organización activa ── */
r.get('/orgs', requireAuth, asyncH(async (req, res) => {
  if (req.user.role !== 'client') return res.json([]);
  const orgs = await center.orgsOf(req.user.id);
  res.json(orgs.filter((o) => o.appRole !== 'none').map((o) => ({ ...o, active: o.id === String(req.user.tenantId) })));
}));
r.post('/switch-org', requireAuth, validate(z.object({ orgId: z.string() })), asyncH(async (req, res) => {
  const m = await center.membership(req.user.id, req.body.orgId);
  if (!m || m.appRole === 'none' || m.appEnabled === false) throw forbidden('No tienes acceso a JuntialAgents en esa organización');
  await ensureTenant(req.body.orgId); await User.updateOne({ _id: req.user.id }, { tenantId: req.body.orgId });
  res.json({ ok: true, refresh: true }); // el panel renueva la sesión (/refresh) para obtener el token de la nueva organización
}));
export default r;
