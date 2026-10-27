import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, fakeDb, fakeCenter, resetRedis, fakeLLM, toolResults, systemText, seedTenant, makeWorker } from '../helpers/setup.mjs';
const PORT = 6600; setupEnv(PORT);
const centerSim = fakeCenter(PORT + 3);
const { db, oid } = await fakeDb(['Bot', 'Tenant', 'Plan', 'Usage', 'User', 'Notification', 'WorkerRun', 'WorkerApproval', 'WorkerMessage', 'WorkerLink', 'BotLog', 'CrmRecord', 'CrmActivity', 'FieldDef', 'Workflow']);
// En el chat: si se le ofrece decidir y le dicen «adelante», decide la aprobación pendiente
const llm = fakeLLM(PORT + 1, (b) => {
  const sys = systemText(b); const last = JSON.stringify(b.messages.at(-1).content); const tools = (b.tools || []).map((t) => t.name);
  if (last.includes('adelante') && tools.includes('decide_pending_approval') && !toolResults(b)) return { content: [{ type: 'tool_use', id: 'd1', name: 'decide_pending_approval', input: { approvalId: (sys.match(/#([0-9a-f]{6}) /) || [])[1], approve: true } }] };
  return toolResults(b) ? 'Hecho, aprobado 👍' : 'Vale, lo tengo en cuenta.';
});
const { T } = seedTenant(db, oid); const TGB = oid(); const ANT = oid(); const PEP = oid();
const W = await makeWorker(db, oid, T, { reporting: { notifyPanel: true, telegramBotId: TGB, chatId: 8788578156 }, channels: { telegramChat: true, pages: true, api: true },
  people: [{ _id: ANT, name: 'Antonio Ramón Martínez', role: 'Jefe de montaje', telegramUsername: 'antonio_rm', canApprove: true }, { _id: PEP, name: 'Pepe Amorós', email: 'pepe@t.es', canApprove: false }] });
db.Bot.push({ _id: TGB, tenantId: T, kind: 'telegram', name: 'Sara', status: 'active', telegram: {} });
const conv = await import('../../src/modules/worker/conversation.js'); const { Q } = await import('../../src/lib/queues.js');
const bot = () => db.Bot.find((b) => String(b._id) === String(W));
db.CrmRecord.push({ _id: 'rec1', tenantId: T, data: { name: 'Colombia 15', status: 'Nuevo' } });
const pending = (label) => { const a = { _id: oid(), tenantId: T, botId: W, status: 'pending', tool: 'crm_update', label, category: 'data', args: { id: 'rec1', fields: { status: 'Cualificado' } }, need: 1, expiresAt: new Date(Date.now() + 864e5) }; db.WorkerApproval.push(a); return () => db.WorkerApproval.find((x) => x._id === a._id); };
before(async () => { await resetRedis(); });

test('Telegram: el bot de informes es la voz del empleado y aprende el chat de quien escribe', async () => {
  const voice = await conv.workerForTelegramBot(TGB); assert.equal(String(voice._id), String(W));
  await conv.handleTalkJob({ workerId: String(W), tgBotId: String(TGB), chatId: 5550001, from: { username: 'antonio_rm', first_name: 'Antonio' }, text: 'Ya salió de fábrica' });
  assert.equal(bot().worker.people.find((p) => p.name.startsWith('Antonio')).telegramChatId, 5550001);
  assert.ok((await Q.inbound.getJobs(['waiting'])).some((j) => j.data.chatIds?.[0] === 5550001), 'la respuesta vuelve a su chat');
  assert.match(systemText(llm.requests.at(-1)), /Te está escribiendo Antonio Ramón Martínez por Telegram/);
});

test('página personal: identifica a la persona, tiene su propio hilo y quien puede aprobar aprueba hablando', async () => {
  const a = pending('Cambiar fecha');
  const ctx = await conv.resolveLink(await conv.createPersonLink(bot(), ANT));
  assert.equal(ctx.person.name, 'Antonio Ramón Martínez');
  const r = await conv.talkToWorker(W, { text: 'sí, adelante', person: ctx.person, channel: 'page', conv: ctx.conv });
  assert.match(r.reply, /aprobado/); assert.equal(a().status, 'executed'); assert.equal(a().decidedBy, 'Antonio Ramón Martínez');
  assert.deepEqual(db.WorkerMessage.filter((m) => m.conv === ctx.conv).map((m) => m.role), ['user', 'assistant']);
});

test('quien no puede aprobar no ve esa opción', async () => {
  const a = pending('Otro cambio');
  const ctx = await conv.resolveLink(await conv.createPersonLink(bot(), PEP));
  await conv.talkToWorker(W, { text: 'sí, adelante', person: ctx.person, channel: 'page', conv: ctx.conv });
  assert.ok(!(llm.requests.at(-1).tools || []).some((t) => t.name === 'decide_pending_approval')); assert.equal(a().status, 'pending');
});

test('enlaces: uno inválido no entra y al revocarlo deja de funcionar', async () => {
  assert.equal(await conv.resolveLink('wl_falso'), null);
  const raw = await conv.createPersonLink(bot(), ANT); db.WorkerLink.length = 0;
  assert.equal(await conv.resolveLink(raw), null);
});
