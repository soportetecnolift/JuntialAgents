/**
 * Permisos de JuntialAgents según el rol de cada persona en su organización, que vive en Juntial Center.
 * viewer: solo lectura · editor: todo salvo administración · admin: todo · none: sin acceso.
 * Si Center no responde, se usan los últimos permisos conocidos (hasta 24 h) para que una caída breve no tumbe Agents.
 */
import { center, CenterError } from '../../lib/center.js';
import { redis } from '../../lib/redis.js';
import { forbidden, AppError } from '../../lib/errors.js';
import { Tenant } from '../../models/index.js';
import { ensureTenant } from '../auth/sso.js';
import { logger } from '../../config/logger.js';

const ADMIN_ONLY = [/^\/api\/developer/, /^\/api\/plans\/request/];

export async function membershipOf(userId, orgId) {
  try {
    const m = await center.membership(userId, orgId);
    if (m) await redis.set(`ctr:mbrlast:${orgId}:${userId}`, JSON.stringify(m), 'EX', 86400);
    return m;
  } catch (e) {
    if (e instanceof CenterError && e.status < 500) throw e;
    const last = await redis.get(`ctr:mbrlast:${orgId}:${userId}`);
    if (last) { logger.warn({ err: e.message }, 'Juntial Center no responde: se usan los últimos permisos conocidos'); return JSON.parse(last); }
    throw new AppError(503, 'CENTER_UNAVAILABLE', 'Juntial Center no responde ahora mismo. Inténtalo en un momento.');
  }
}

export const appGuard = () => async (req, _res, next) => {
  try {
    if (!req.user || req.user.role !== 'client' || !req.user.tenantId) return next();
    const m = await membershipOf(req.user.id, req.user.tenantId);
    if (!m) throw forbidden('No perteneces a esta organización');
    if (m.appEnabled === false) throw forbidden('JuntialAgents está desactivada en tu organización');
    if (m.appRole === 'none') throw forbidden('No tienes acceso a JuntialAgents. Pídeselo a un administrador en Juntial Center.');
    const write = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (m.appRole === 'viewer' && write) throw forbidden('Tu rol es de solo lectura');
    if (m.appRole !== 'admin' && write && ADMIN_ONLY.some((r) => r.test(req.originalUrl))) throw forbidden('Solo los administradores pueden hacer esto');
    if (!(await Tenant.exists({ _id: req.user.tenantId }))) await ensureTenant(req.user.tenantId); // copia local de la organización
    req.member = m; req.appRole = m.appRole; next();
  } catch (e) { next(e); }
};
