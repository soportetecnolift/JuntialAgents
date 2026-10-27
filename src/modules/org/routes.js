import { Router } from 'express';
import { z } from 'zod';
import { Bot } from '../../models/index.js';
import { asyncH, forbidden } from '../../lib/errors.js';
import { validate } from '../../middleware/common.js';
import { env } from '../../config/env.js';
import { center } from '../../lib/center.js';
import { membershipOf } from './access.js';

/**
 * Lo que el panel de JuntialAgents (y su API v1 / MCP) necesita de la organización, servido por Juntial Center:
 * áreas, miembros, bandeja de aprobaciones con política, eventos y simulador. La administración (miembros, áreas,
 * políticas, conexiones…) se hace en el panel de Center.
 * Se monta en /api/org (panel) y en /v1/center (compatibilidad con las herramientas del MCP).
 */
const r = Router();
const org = (req) => { if (!req.user.tenantId) throw forbidden('Sin organización activa'); return String(req.user.tenantId); };

r.get('/me', asyncH(async (req, res) => {
  const [orgs, m] = await Promise.all([center.orgsOf(req.user.id).catch(() => []), req.user.tenantId ? membershipOf(req.user.id, req.user.tenantId).catch(() => null) : null]);
  res.json({ organizations: orgs.filter((o) => o.appRole !== 'none').map((o) => ({ ...o, _id: o.id, active: o.id === String(req.user.tenantId) })), membership: m, centerUrl: env.CENTER_WEB_URL });
}));
r.get('/departments', asyncH(async (req, res) => res.json((await center.departments(org(req))).map((d) => ({ ...d, _id: d.id })))));
r.get('/members', asyncH(async (req, res) => res.json((await center.members(org(req))).map((m) => ({ ...m, _id: m.id })))));
r.get('/events', asyncH(async (req, res) => res.json(await center.events(org(req), { type: req.query.type, limit: req.query.limit }))));
r.get('/approvals', asyncH(async (req, res) => res.json(await center.approvalsFor(org(req), req.user.id, { scope: req.query.scope === 'all' ? 'all' : 'mine', status: req.query.status === 'all' ? 'all' : 'pending' }))));
r.post('/approvals/:id/decide', validate(z.object({ approve: z.boolean(), feedback: z.string().max(1000).optional() })), asyncH(async (req, res) => {
  res.json(await center.vote(req.params.id, { approve: req.body.approve, via: 'agents', feedback: req.body.feedback, actor: { userId: req.user.id } }));
}));
r.post('/policies/simulate', validate(z.object({ agentId: z.string().optional(), category: z.string(), tool: z.string().default(''), amount: z.number().nullable().optional(), departmentId: z.string().optional() })), asyncH(async (req, res) => {
  let dep = req.body.departmentId;
  if (!dep && req.body.agentId) dep = (await Bot.findOne({ _id: req.body.agentId, tenantId: org(req) }).lean())?.worker?.departmentId;
  res.json(await center.simulate({ orgId: org(req), category: req.body.category, tool: req.body.tool, amount: req.body.amount ?? null, departmentId: dep ? String(dep) : null, agentId: req.body.agentId }));
}));
export default r;
