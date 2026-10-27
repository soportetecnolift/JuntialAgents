/**
 * Avisos que envía Juntial Center a JuntialAgents (firmados con el secreto de la app):
 *  - POST /internal/center/approvals: decisión final de una aprobación con política → se ejecuta o se descarta la acción.
 */
import { Router, raw } from 'express';
import { WorkerApproval } from '../../models/index.js';
import { verifyCenterSignature } from '../../lib/center.js';
import { logger } from '../../config/logger.js';

export const centerHooks = Router();
centerHooks.post('/approvals', raw({ type: '*/*', limit: '256kb' }), async (req, res) => {
  const body = req.body?.toString('utf8') || '';
  if (!verifyCenterSignature(req.headers['x-juntial-signature'], body)) return res.status(401).json({ error: 'Firma no válida' });
  let d; try { d = JSON.parse(body); } catch { return res.status(400).json({ error: 'JSON no válido' }); }
  const a = await WorkerApproval.findOne({ $or: [{ centerApprovalId: d.approvalId }, ...(d.externalId?.match(/^[a-f0-9]{24}$/) ? [{ _id: d.externalId }] : [])] }).lean();
  if (!a) return res.status(404).json({ error: 'Aprobación desconocida' });
  if (a.status !== 'pending') return res.json({ ok: true, already: a.status }); // ya ejecutada al votar desde Agents
  const { decideApproval } = await import('../worker/engine.js');
  const out = await decideApproval(a._id, { approve: d.status === 'approved', by: d.by || 'Juntial Center', via: `center${d.via ? `:${d.via}` : ''}`, feedback: d.status === 'expired' ? 'Caducada en Juntial Center sin decisión' : d.feedback, system: true });
  logger.info({ approvalId: String(a._id), status: d.status, out: out.status }, 'Decisión de Juntial Center aplicada');
  res.json({ ok: true, status: out.status });
});
