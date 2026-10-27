/**
 * Sesiones de JuntialAgents. La IDENTIDAD la da Juntial Center (SSO, ver sso.js): aquí solo se abre y se renueva la
 * sesión propia de Agents (access token de 15 min + refresh en cookie, 30 días absolutos), igual que antes.
 */
import jwt from 'jsonwebtoken';
import { env, isProd } from '../../config/env.js';
import { User, Session } from '../../models/index.js';
import { sha256, randomToken, safeEqual } from '../../lib/crypto.js';
import { redis } from '../../lib/redis.js';
import { unauthorized, forbidden } from '../../lib/errors.js';

const SESSION_MS = env.SESSION_DAYS * 86400000;
export const REFRESH_COOKIE = 'ja_rt';

export function cookieOpts(expiresAt) {
  return {
    httpOnly: true, secure: isProd || env.COOKIE_SAMESITE === 'none', sameSite: env.COOKIE_SAMESITE,
    domain: env.COOKIE_DOMAIN || undefined, path: '/api/auth', expires: expiresAt,
  };
}

function signAccess(user, sid) {
  return jwt.sign({ sub: String(user._id), role: user.role, tid: user.tenantId ? String(user.tenantId) : null, sid, email: user.email }, env.JWT_ACCESS_SECRET, { expiresIn: env.ACCESS_TOKEN_TTL });
}

/** Crea sesión con caducidad absoluta de 30 días. */
export async function createSession(user, { ip, userAgent, method }) {
  if (user.status !== 'active') throw forbidden('Cuenta deshabilitada');
  const secret = randomToken(48);
  const session = await Session.create({ userId: user._id, refreshHash: sha256(secret), ip, userAgent, method, expiresAt: new Date(Date.now() + SESSION_MS), lastUsedAt: new Date() });
  await User.updateOne({ _id: user._id }, { lastLoginAt: new Date() });
  return { accessToken: signAccess(user, String(session._id)), refreshToken: `${session._id}.${secret}`, expiresAt: session.expiresAt, user: publicUser(user) };
}

/** Rotación de refresh token + detección de reutilización. NO extiende la caducidad (30 días absolutos). */
export async function refreshSession(raw, { ip }) {
  if (!raw?.includes('.')) throw unauthorized();
  const [sid, secret] = raw.split('.');
  const session = await Session.findById(sid).catch(() => null);
  if (!session || session.revokedAt || session.expiresAt < new Date()) throw unauthorized('Sesión expirada, inicia sesión de nuevo');
  const h = sha256(secret);
  if (!safeEqual(h, session.refreshHash)) {
    if (session.prevRefreshHash && safeEqual(h, session.prevRefreshHash)) {
      // Token antiguo reutilizado => posible robo. Revocar.
      await revokeSession(session);
    }
    throw unauthorized();
  }
  const user = await User.findById(session.userId);
  if (!user || user.status !== 'active') { await revokeSession(session); throw unauthorized(); }
  const next = randomToken(48);
  session.prevRefreshHash = session.refreshHash; session.refreshHash = sha256(next); session.lastUsedAt = new Date(); session.ip = ip;
  await session.save();
  return { accessToken: signAccess(user, sid), refreshToken: `${sid}.${next}`, expiresAt: session.expiresAt, user: publicUser(user) };
}

export async function revokeSession(session) {
  session.revokedAt = new Date(); await session.save();
  await redis.set(`revoked:sid:${session._id}`, 1, 'EX', 3600); // > vida del access token
}
export async function revokeAllSessions(userId, exceptSid) {
  const sessions = await Session.find({ userId, revokedAt: null, _id: { $ne: exceptSid } });
  await Promise.all(sessions.map(revokeSession));
}

export const publicUser = (u) => ({ id: String(u._id), email: u.email, name: u.name, avatar: u.avatar, role: u.role, tenantId: u.tenantId ? String(u.tenantId) : null, emailVerified: u.emailVerified, notificationPrefs: u.notificationPrefs });
