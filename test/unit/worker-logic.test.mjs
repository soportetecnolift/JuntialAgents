import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv } from '../helpers/setup.mjs';
setupEnv(6100);
const { categorize, splitReport, approversOf, findPersonByName } = await import('../../src/modules/worker/engine.js');
const { identifyPerson } = await import('../../src/modules/worker/conversation.js');
const { renderBlueprint, blueprintCompleteness } = await import('../../src/modules/worker/blueprint.js');

test('clasificación de riesgo: consultas de solo lectura no piden aprobación aunque empiecen por «execute»/«run»', () => {
  const cases = {
    zohocrm__executeCOQLQuery: 'read', zohocrm__ZohoCRM_getTasksRecords: 'read', zohocrm__ZohoCRM_searchRecords: 'read', zohocrm__bulkSearchRecords: 'read',
    salesforce__runReport: 'read', salesforce__executeQuery: 'read', notion__search: 'read',
    zohocrm__ZohoCRM_updateRecord: 'data', zohocrm__ZohoCRM_runFunction: 'data', zohocrm__ZohoCRM_generateLink: 'data', stripe__createCustomer: 'data',
    zohocrm__ZohoCRM_sendEmail: 'external', gmail__sendMessage: 'external',
    zohocrm__ZohoCRM_deleteRecord: 'destructive', zohobooks__writeOffInvoice: 'destructive', zohocrm__executeDelete: 'destructive', zohobooks__mark_invoice_void: 'destructive',
  };
  for (const [name, expected] of Object.entries(cases)) assert.equal(categorize(name), expected, name);
});

test('las anotaciones MCP oficiales mandan sobre el nombre', () => {
  assert.equal(categorize('x__doSomething', { readOnlyHint: true }), 'read');
  assert.equal(categorize('x__getThing', { destructiveHint: true }), 'destructive');
});

test('aviso corto y detalle se separan; sin etiquetas, todo es aviso', () => {
  assert.deepEqual(splitReport('<aviso>\nCorto\n</aviso>\n<detalle>\nLargo\n</detalle>'), { short: 'Corto', detail: 'Largo' });
  assert.deepEqual(splitReport('Solo texto'), { short: 'Solo texto', detail: '' });
  assert.equal(splitReport('<aviso>Sin cierre').short, 'Sin cierre');
});

test('votos necesarios según la regla del empleado', () => {
  const ppl = [{ name: 'A', canApprove: true }, { name: 'B', canApprove: true }, { name: 'C', canApprove: true }, { name: 'D', canApprove: false }];
  const need = (rule, p = ppl) => approversOf({ worker: { people: p, approvalRule: rule } }).need;
  assert.equal(need({ mode: 'any' }), 1);
  assert.equal(need({ mode: 'all' }), 3);
  assert.equal(need({ mode: 'quorum', quorum: 2 }), 2);
  assert.equal(need({ mode: 'quorum', quorum: 5 }), 3, 'un mínimo mayor que los aprobadores se ajusta a todos');
  assert.equal(need({ mode: 'all' }, [{ name: 'D' }]), 1, 'sin aprobadores: decide quien vote');
  assert.equal(approversOf({ worker: { people: ppl, approvalRule: {} } }).onlyApprovers, true, 'por defecto solo deciden los aprobadores');
});

test('identificación de personas del equipo por cada canal', () => {
  const bot = { worker: { people: [
    { _id: 'p1', name: 'Antonio Ramón Martínez', telegramUsername: 'antonio_rm', telegramChatId: 5550001 },
    { _id: 'p2', name: 'Helena Martínez', email: 'helena@tecnolift.es' },
    { _id: 'p3', name: 'Antonio Pérez' }] } };
  assert.equal(identifyPerson(bot, { telegramUsername: '@Antonio_RM' })?.name, 'Antonio Ramón Martínez');
  assert.equal(identifyPerson(bot, { telegramChatId: 5550001 })?._id, 'p1');
  assert.equal(identifyPerson(bot, { email: 'HELENA@tecnolift.es' })?._id, 'p2');
  assert.equal(identifyPerson(bot, { email: 'nadie@x.es' }), null);
  assert.equal(findPersonByName(bot, 'helena')?._id, 'p2');
  assert.equal(findPersonByName(bot, 'Antonio'), null, 'nombre ambiguo: no adivina');
  assert.equal(findPersonByName(bot, 'antonio ramon martinez')?._id, 'p1', 'ignora tildes y mayúsculas');
});

test('guion: genera el manual por secciones y mide lo que falta', () => {
  const bp = { context: 'Tecnolift', stateField: 'Estado_del_Montaje', allStateValues: '04, 05', stages: [{ from: '04', to: '05', requirement: 'fecha' }], automations: 'facturas', autonomyNotes: 'aprobación', reportFormat: 'una línea' };
  const md = renderBlueprint(bp);
  assert.match(md, /# CONTEXTO\nTecnolift/); assert.match(md, /\*\*04 → 05\*\*: fecha/);
  assert.equal(blueprintCompleteness(bp).score, 100);
  assert.ok(blueprintCompleteness({}).missing.length >= 5);
  assert.doesNotMatch(renderBlueprint({ context: 'x' }), /VARIANTES/, 'las secciones vacías no aparecen');
});
