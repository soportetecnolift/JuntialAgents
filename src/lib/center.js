/**
 * Cliente de Juntial Center para JuntialAgents. TODO lo que Agents necesita de Center pasa por aquí:
 * identidad (SSO), permisos de las personas, áreas, aprobaciones con política, eventos, conexiones compartidas y
 * validación de tokens OAuth del MCP. Contrato: docs/CONTRATO.md (copia del de Center).
 *
 * Autenticación servicio a servicio: HTTP Basic con CENTER_APP_ID y CENTER_APP_SECRET.
 * Lo que se consulta en cada petición (permisos, tokens) se guarda 60 s en Redis.
 */
import { env } from '../config/env.js';
import { redis } from './redis.js';
import { hmac, safeEqual } from './crypto.js';
import { logger } from '../config/logger.js';

const BASE = () => env.CENTER_URL.replace(/\/$/, '');
const AUTH = () => `Basic ${Buffer.from(`${env.CENTER_APP_ID}:${env.CENTER_APP_SECRET}`).toString('base64')}`;

export class CenterError extends Error { constructor(status, message) { super(message); this.status = status; } }

async function call(method, path, body, { timeoutMs = 10000 } = {}) {
  const r = await fetch(`${BASE()}/internal${path}`, { method, headers: { authorization: AUTH(), 'content-type': 'application/json', 'user-agent': 'JuntialAgents/1.0' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
  const text = await r.text(); let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) throw new CenterError(r.status, data?.error?.message || `Juntial Center respondió ${r.status}`);
  return data;
}
async function cached(key, ttl, fn) {
  const hit = await redis.get(key); if (hit) return JSON.parse(hit);
  const v = await fn(); await redis.set(key, JSON.stringify(v ?? null), 'EX', ttl); return v;
}
const orNull = (p) => p.catch((e) => { if (e.status === 404) return null; throw e; });

export const center = {
  /* Identidad y organización */
  user: (id) => orNull(call('GET', `/users/${id}`)),
  org: (id) => orNull(call('GET', `/orgs/${id}`)),
  /** Permisos de una persona en una organización para JuntialAgents (60 s de caché). null si no es miembro. */
  membership: (userId, orgId) => (userId && orgId ? cached(`ctr:mbr:${orgId}:${userId}`, 60, () => orNull(call('GET', `/memberships?orgId=${orgId}&userId=${userId}`))) : null),
  membershipByTelegram: (orgId, username) => orNull(call('GET', `/memberships?orgId=${orgId}&telegramUsername=${encodeURIComponent(username)}`)),
  invalidateMembership: (userId, orgId) => redis.del(`ctr:mbr:${orgId}:${userId}`),
  orgsOf: (userId) => call('GET', `/users/${userId}/orgs`),
  departments: (orgId) => cached(`ctr:deps:${orgId}`, 60, () => call('GET', `/orgs/${orgId}/departments`)),
  members: (orgId) => call('GET', `/orgs/${orgId}/members`),
  events: (orgId, { type, limit } = {}) => call('GET', `/orgs/${orgId}/events?limit=${limit || 50}${type ? `&type=${encodeURIComponent(type)}` : ''}`),

  /* Aprobaciones con política de la organización */
  createApproval: (data) => call('POST', '/approvals', data),
  vote: (approvalId, data) => call('POST', `/approvals/${approvalId}/vote`, data),
  cancelApproval: (approvalId, reason) => call('POST', `/approvals/${approvalId}/cancel`, { reason }).catch(() => null),
  approvalsFor: (orgId, userId, { scope = 'mine', status = 'pending' } = {}) => call('GET', `/approvals?orgId=${orgId}&userId=${userId}&scope=${scope}&status=${status}`),
  simulate: (data) => call('POST', '/policies/simulate', data),

  /* Eventos y conexiones */
  /** Publica un evento en el bus de la organización. Nunca lanza: un evento perdido no debe romper el trabajo. */
  publish: (orgId, type, data = {}, { actor } = {}) => (orgId ? call('POST', '/events', { orgId: String(orgId), type, data: JSON.parse(JSON.stringify(data)), actor }, { timeoutMs: 5000 }).catch((e) => { logger.warn({ err: e.message, type }, 'Evento a Juntial Center no entregado'); return null; }) : null),
  connectionRequest: (orgId, slug, opts) => call('POST', `/connections/${orgId}/${encodeURIComponent(slug)}/request`, opts, { timeoutMs: 25000 }),

  /* OAuth: validación de tokens del MCP (RFC 7662), 60 s de caché */
  introspect: (token) => cached(`ctr:oat:${token.slice(-24)}`, 60, () => call('POST', '/oauth/introspect', { token })),
};

/** Verifica la firma de los avisos que envía Center (X-Juntial-Signature: t=…,v1=HMAC(secreto, t.cuerpo)). */
export function verifyCenterSignature(header, rawBody, maxAgeS = 300) {
  const parts = Object.fromEntries(String(header || '').split(',').map((x) => x.split('=')));
  const t = Number(parts.t); if (!t || Math.abs(Date.now() / 1000 - t) > maxAgeS) return false;
  return !!parts.v1 && safeEqual(parts.v1, hmac(env.CENTER_APP_SECRET, `${t}.${rawBody}`));
}
