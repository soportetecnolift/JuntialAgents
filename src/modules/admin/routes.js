import { Router } from 'express';
import { z } from 'zod';
import { User, Tenant, Bot, Audit, Ticket, Session, Usage } from '../../models/index.js';
import { asyncH, notFound, forbidden, badRequest } from '../../lib/errors.js';
import { validate } from '../../middleware/common.js';
import { requirePerm } from '../../middleware/auth.js';
import { audit } from '../../lib/audit.js';
import { Q } from '../../lib/queues.js';
import { revokeAllSessions } from '../auth/service.js';
import { assignPlan } from '../plans/routes.js';
import { invalidatePlanCache, period, usageSummary } from '../plans/limits.js';
import { emailDirect } from '../notifications/service.js';
import { emitPlatformEvent } from '../platform/events.js';

const r = Router();
const RANK = { superadmin: 4, admin: 3, employee: 2, client: 1 };
// Nadie gestiona a alguien de rango igual o superior (salvo superadmin)
const guard = (actor, targetRole) => { if (actor.role !== 'superadmin' && RANK[targetRole] >= RANK[actor.role]) throw forbidden('No puedes gestionar usuarios de ese rol'); };

r.get('/stats', requirePerm('stats.read'), asyncH(async (_req, res) => {
  const [users, tenants, bots, activeBots, openTickets, usage, queues] = await Promise.all([
    User.countDocuments(), Tenant.countDocuments(), Bot.countDocuments(), Bot.countDocuments({ status: 'active' }),
    Ticket.countDocuments({ status: { $in: ['open', 'in_progress'] } }),
    Usage.aggregate([{ $match: { period: period() } }, { $group: { _id: null, messages: { $sum: '$messages' } } }]),
    Promise.all(Object.entries(Q).map(async ([k, q]) => [k, await q.getJobCounts('waiting', 'active', 'delayed', 'failed')])),
  ]);
  res.json({ users, tenants, bots, activeBots, openTickets, messagesThisMonth: usage[0]?.messages || 0, queues: Object.fromEntries(queues) });
}));

r.get('/users', requirePerm('users.read'), asyncH(async (req, res) => {
  const q = {}; if (req.query.role) q.role = req.query.role;
  if (req.query.q) q.$or = [{ email: new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, { name: new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }];
  const page = Math.max(1, +req.query.page || 1);
  const [items, total] = await Promise.all([User.find(q).sort({ createdAt: -1 }).skip((page - 1) * 50).limit(50).populate('tenantId', 'name').lean(), User.countDocuments(q)]);
  res.json({ items, total, page });
}));
// Crear usuarios y cambiar roles o estado se hace en Juntial Center (/admin del panel de Center).
r.post('/users/:id/logout-all', requirePerm('users.write'), asyncH(async (req, res) => {
  const user = await User.findById(req.params.id); if (!user) throw notFound(); guard(req.user, user.role);
  await revokeAllSessions(user._id); audit(req, 'user.sessions.revoke', { kind: 'user', id: user.id }); res.json({ ok: true });
}));

r.get('/tenants', requirePerm('tenants.read'), asyncH(async (_req, res) => {
  const tenants = await Tenant.find().sort({ createdAt: -1 }).limit(500).populate('ownerId', 'email name').populate('subscription.planId', 'name slug').lean();
  const counts = await Bot.aggregate([{ $group: { _id: '$tenantId', n: { $sum: 1 } } }]);
  const map = Object.fromEntries(counts.map((c) => [String(c._id), c.n]));
  res.json(tenants.map((t) => ({ ...t, bots: map[String(t._id)] || 0 })));
}));
r.get('/tenants/:id/usage', requirePerm('tenants.read'), asyncH(async (req, res) => res.json(await usageSummary(req.params.id))));
r.post('/tenants/:id/plan', requirePerm('tenants.write'), validate(z.object({ planId: z.string() })), asyncH(async (req, res) => res.json(await assignPlan(req, req.params.id, req.body.planId))));
r.patch('/tenants/:id', requirePerm('tenants.write'), validate(z.object({ status: z.enum(['active', 'suspended']) })), asyncH(async (req, res) => {
  const t = await Tenant.findByIdAndUpdate(req.params.id, req.body, { new: true }); await invalidatePlanCache(t._id);
  audit(req, 'tenant.status', { kind: 'tenant', id: t.id }, req.body); emitPlatformEvent('tenant.status_changed', { tenantId: t.id, status: t.status });
  res.json(t);
}));

r.get('/audit', requirePerm('audit.read'), asyncH(async (req, res) => {
  const q = {}; if (req.query.action) q.action = new RegExp(`^${String(req.query.action).replace(/[^\w.]/g, '')}`); if (req.query.actor) q.actorEmail = req.query.actor;
  res.json(await Audit.find(q).sort({ createdAt: -1 }).limit(200).lean());
}));
r.get('/sessions/active', requirePerm('users.read'), asyncH(async (_req, res) => res.json({ count: await Session.countDocuments({ revokedAt: null, expiresAt: { $gt: new Date() } }) })));
export default r;
