// Base de datos en memoria que imita a Mongoose para las pruebas (find/updateOne/$push con $slice, operador posicional «$», etc.).
// No es MongoDB: si una prueba depende de un comportamiento muy concreto de Mongo, verifícalo también contra una base real.
import mongoose from 'mongoose';
export const oid = () => new mongoose.Types.ObjectId();
export function installFakeDb(M, names) {
  const db = {};
  const isOid = (x) => x instanceof mongoose.Types.ObjectId;
  const clone = (x) => (Buffer.isBuffer(x) || isOid(x) ? x : x instanceof Date ? new Date(x) : Array.isArray(x) ? x.map(clone) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, clone(v)])) : x);
  const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : Array.isArray(a) && !/^\d+$/.test(k) ? a.map((e) => e?.[k]).flat() : a[k]), o);
  const eq = (a, b) => (a instanceof Date || b instanceof Date ? +new Date(a) === +new Date(b) : String(a) === String(b));
  const cmp = (dv, v) => {
    if (v && typeof v === 'object' && !isOid(v) && !(v instanceof Date) && !(v instanceof RegExp) && !Array.isArray(v)) {
      return Object.entries(v).every(([op, x]) => {
        const arr = Array.isArray(dv) ? dv : [dv];
        switch (op) {
          case '$in': return arr.some((d) => x.some((y) => eq(d, y)));
          case '$nin': return !arr.some((d) => x.some((y) => eq(d, y)));
          case '$ne': return !arr.some((d) => eq(d, x));
          case '$gt': return dv != null && dv > x; case '$gte': return dv != null && dv >= x;
          case '$lt': return dv != null && dv < x; case '$lte': return dv != null && dv <= x;
          case '$exists': return x ? dv !== undefined && !(Array.isArray(dv) && !dv.length && false) : dv === undefined;
          default: return false;
        }
      });
    }
    if (v instanceof RegExp) return v.test(dv || '');
    if (v === null) return dv == null;
    return Array.isArray(dv) ? dv.some((d) => eq(d, v)) : eq(dv, v);
  };
  const match = (d, q) => Object.entries(q || {}).every(([k, v]) => (k === '$or' ? v.some((x) => match(d, x)) : k === '$and' ? v.every((x) => match(d, x)) : cmp(get(d, k), v)));
  const setPath = (d, k, v) => { const ps = k.split('.'); let o = d; ps.slice(0, -1).forEach((p) => { o[p] ??= /^\d+$/.test(p) ? [] : {}; o = o[p]; }); o[ps.at(-1)] = v; };
  const posPath = (d, k, q) => {
    if (!k.includes('.$.') && !k.endsWith('.$')) return k;
    const arrPath = k.split('.$')[0]; const arr = get(d, arrPath) || [];
    const conds = Object.entries(q || {}).filter(([qk]) => qk.startsWith(`${arrPath}.`));
    const idx = arr.findIndex((el) => conds.every(([qk, qv]) => cmp(get(el, qk.slice(arrPath.length + 1)), qv)));
    return idx < 0 ? k : k.replace('.$', `.${idx}`);
  };
  const apply = (d, u, inserting, q) => {
    const plain = Object.keys(u).some((k) => !k.startsWith('$'));
    for (const [k, v] of Object.entries(plain ? u : u.$set || {})) if (!k.startsWith('$')) setPath(d, posPath(d, k, q), clone(v));
    if (inserting) for (const [k, v] of Object.entries(u.$setOnInsert || {})) setPath(d, k, clone(v));
    for (const [k, v] of Object.entries(u.$inc || {})) setPath(d, k, (get(d, k) || 0) + v);
    for (const [k, v] of Object.entries(u.$push || {})) {
      const cur = get(d, k) || []; const add = (v?.$each || [v]).map((x) => (x && typeof x === 'object' && !isOid(x) && !(x instanceof Date) && !x._id ? { _id: oid(), ...clone(x) } : clone(x)));
      let next = [...cur, ...add]; if (v?.$slice != null) next = v.$slice < 0 ? next.slice(v.$slice) : next.slice(0, v.$slice); setPath(d, k, next);
    }
    for (const [k, v] of Object.entries(u.$addToSet || {})) { const cur = get(d, k) || []; if (!cur.some((x) => eq(x, v))) setPath(d, k, [...cur, v]); }
    for (const [k, v] of Object.entries(u.$pull || {})) { const cur = get(d, k) || []; setPath(d, k, cur.filter((x) => !eq(x, v))); }
    d.updatedAt = new Date();
  };
  const wrapDoc = (Mdl, d) => d && Object.assign(clone(d), { toObject: () => clone(d), save: async function () { Object.assign(d, clone(Object.fromEntries(Object.entries(this).filter(([k]) => !['toObject', 'save', 'deleteOne', 'markModified'].includes(k))))); return this; }, deleteOne: async () => { const col = db[Mdl.modelName]; col.splice(col.indexOf(d), 1); }, markModified() {} });
  for (const name of names) {
    const col = (db[name] = []); const Mdl = M[name];
    const q = (rowsFn, one) => { let rows = rowsFn(); let lean = false; const api = {
      select() { return api; }, populate() { return api; }, skip(n) { rows = rows.slice(n); return api; }, limit(n) { rows = rows.slice(0, n); return api; },
      sort(spec) { const [[k, dir]] = Object.entries(spec || { _id: 1 }); rows = [...rows].sort((a, b) => ((get(a, k) > get(b, k) ? 1 : get(a, k) < get(b, k) ? -1 : 0) * (dir < 0 ? -1 : 1))); return api; },
      lean() { lean = true; return api; },
      then(res, rej) { const out = one ? (rows[0] ? (lean ? clone(rows[0]) : wrapDoc(Mdl, rows[0])) : null) : rows.map((r) => (lean ? clone(r) : wrapDoc(Mdl, r))); return Promise.resolve(out).then(res, rej); },
      catch(rej) { return api.then(undefined, rej); },
    }; return api; };
    Mdl.find = (f) => q(() => col.filter((d) => match(d, f)));
    Mdl.findOne = (f) => q(() => col.filter((d) => match(d, f)), true);
    Mdl.findById = (id) => q(() => col.filter((d) => eq(d._id, id)), true);
    Mdl.exists = async (f) => (col.find((d) => match(d, f)) ? { _id: col.find((d) => match(d, f))._id } : null);
    Mdl.countDocuments = async (f) => col.filter((d) => match(d, f)).length;
    Mdl.create = async (d) => { const doc = { _id: oid(), createdAt: new Date(), updatedAt: new Date(), ...clone(d) }; col.push(doc); return wrapDoc(Mdl, doc); };
    Mdl.insertMany = async (a) => Promise.all(a.map((x) => Mdl.create(x)));
    Mdl.updateOne = async (f, u, o = {}) => { let d = col.find((x) => match(x, f)); let up = 0; if (!d && o.upsert) { d = { _id: oid(), createdAt: new Date(), ...Object.fromEntries(Object.entries(f).filter(([, v]) => typeof v !== 'object' || isOid(v))) }; col.push(d); up = 1; } if (d) apply(d, u, up, f); return { matchedCount: d ? 1 : 0, upsertedCount: up }; };
    Mdl.updateMany = async (f, u) => { const l = col.filter((x) => match(x, f)); l.forEach((d) => apply(d, u, false, f)); return { matchedCount: l.length }; };
    Mdl.findOneAndUpdate = (f, u, o = {}) => q(() => { let d = col.find((x) => match(x, f)); if (!d && o.upsert) { d = { _id: oid(), ...f }; col.push(d); } if (!d) return []; const before = clone(d); apply(d, u, false, f); return [o.new === false ? before : d]; }, true);
    Mdl.findByIdAndUpdate = (id, u, o) => Mdl.findOneAndUpdate({ _id: id }, u, o);
    Mdl.deleteOne = async (f) => { const i = col.findIndex((x) => match(x, f)); if (i >= 0) col.splice(i, 1); return { deletedCount: i >= 0 ? 1 : 0 }; };
    Mdl.deleteMany = async (f) => { let n = 0; for (let i = col.length - 1; i >= 0; i--) if (match(col[i], f)) { col.splice(i, 1); n++; } return { deletedCount: n }; };
    Mdl.findOneAndDelete = (f) => q(() => { const i = col.findIndex((x) => match(x, f)); return i >= 0 ? col.splice(i, 1) : []; }, true);
    Mdl.aggregate = async () => [];
  }
  return db;
}
