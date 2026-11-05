// The demo must answer like the real SQL, or a page that works in the demo could break for real.
// Runs one job through both and compares the shape of every answer, role by role.
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

globalThis.window = globalThis;
createRequire(import.meta.url)('../messaging/courier-demo.js');
const demo = window.CC_DEMO;

const PSQL = ['-h', '127.0.0.1', '-p', '54329', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'];
const raw = (s) => execFileSync('psql', PSQL, { input: s, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

// Named arguments, the way supabase-js sends them.
function sqlCall(user, name, args = {}) {
  const parts = Object.entries(args).map(([k, v]) => {
    let val;
    if (v === null || v === undefined) val = 'null';
    else if (typeof v === 'object') val = q(JSON.stringify(v)) + '::jsonb';
    else if (typeof v === 'number') val = Number.isInteger(v) ? String(v) : `${v}::double precision`;
    else if (typeof v === 'boolean') val = String(v);
    else if (/^[0-9a-f-]{36}$/.test(v)) val = q(v) + '::uuid';
    else val = q(v);
    return `${k} := ${val}`;
  });
  const out = raw(`begin; set local role authenticated; select set_config('request.jwt.claim.sub', ${q(user)}, true); select public.${name}(${parts.join(', ')}); commit;`);
  return JSON.parse(out.split('\n').slice(1).join('\n').trim());
}

// A shape keeps keys and rough types. Null is compatible with anything, since hidden fields go null.
function same(a, b, path) {
  if (a === null || b === null || a === undefined || b === undefined) { assert.equal(a === undefined, b === undefined, `${path}: present in only one backend`); return; }
  assert.equal(Array.isArray(a), Array.isArray(b), path);
  if (Array.isArray(a)) { if (a.length && b.length) same(a[0], b[0], path + '[0]'); return; }
  assert.equal(typeof a, typeof b, path);
  if (typeof a === 'object') {
    assert.deepEqual(Object.keys(a).filter((k) => k !== 'detail').sort(), Object.keys(b).filter((k) => k !== 'detail').sort(), path + ' keys');
    for (const k of Object.keys(a)) if (k !== 'detail') same(a[k], b[k], `${path}.${k}`);
  }
}

test('demo and SQL give the same shapes through a whole job', () => {
  const stamp = Date.now();
  const mkUser = (n) => { raw(`insert into auth.users (email) values (${q(`${n}${stamp}@crossroadsweddingco.shop`)});`); return raw(`select id from public.profiles where username = ${q(n + stamp)};`); };
  const nda = JSON.parse(raw('select public.cc_current_nda();')).version;
  const owner = raw("select id from public.profiles where username = 'jake';");
  const S = { owner, client: mkUser('cc'), store: mkUser('cs'), store2: mkUser('cs2'), driver: mkUser('cd') };
  for (const u of Object.values(S)) { try { /* owner may already be signed */ } catch {} }
  raw(`update public.cc_members set role='owner' where user_id=${q(owner)};`);
  const sign = (u) => sqlCall(u, 'cc_accept_nda', { p_version: nda, p_typed_name: 'Test Person', p_title: 't', p_company: 'c' });
  sign(owner);
  const orgC = sqlCall(owner, 'cc_admin_save_org', { p: { name: 'C' + stamp, kind: 'client' } }).id;
  const orgS = sqlCall(owner, 'cc_admin_save_org', { p: { name: 'S' + stamp, kind: 'store' } }).id;
  const orgT = sqlCall(owner, 'cc_admin_save_org', { p: { name: 'T' + stamp, kind: 'store' } }).id;
  const setM = (u, r, o) => sqlCall(owner, 'cc_admin_set_member', { p_user: u, p_role: r, p_org: o, p_active: true });
  setM(S.client, 'client', orgC); setM(S.store, 'store', orgS); setM(S.store2, 'store', orgT); setM(S.driver, 'driver', null);
  for (const u of [S.client, S.store, S.store2, S.driver]) sign(u);

  demo.reset();
  const dOrgC = demo.addOrg('C', 'client'), dOrgS = demo.addOrg('S', 'store'), dOrgT = demo.addOrg('T', 'store');
  const D = {
    owner: demo.addUser('o', 'Owner', 'owner', null, true), client: demo.addUser('c', 'Client', 'client', dOrgC, true),
    store: demo.addUser('s', 'Store', 'store', dOrgS, true), store2: demo.addUser('t', 'Store2', 'store', dOrgT, true), driver: demo.addUser('d', 'Driver', 'driver', null, true),
  };

  // Each step: [who, call, args as a function of ids]. Compare the answer from both backends.
  const ids = { sql: {}, demo: {} };
  const run = (who, name, args = () => ({})) => {
    const a = sqlCall(S[who], name, args(ids.sql, 'sql'));
    demo.as(D[who]);
    const b = demo.rpc(name, args(ids.demo, 'demo'));
    same(a, b, `${who} ${name}`);
    return [a, b];
  };
  const order = (i, b) => ({ p: { urgency: 'hotshot', title: 'T', notes: 'N', blind: true, no_prohibited: true,
    stops: [{ kind: 'pickup', place_name: 'A', address: '1 St', contact: 'Lee', instructions: 'x', lat: 39.2, lng: -85.9 }, { kind: 'drop', place_name: 'B', address: '2 St', contact: 'Ann' }],
    items: [{ action: 'buy', description: 'Bolt', part_no: 'P1', qty: 2, supplier_name: 'A', store_org_id: b === 'sql' ? orgT : dOrgT }] } });

  run('client', 'cc_me'); run('driver', 'cc_me'); run('client', 'cc_current_nda'); run('client', 'cc_list_stores');
  const [sa, da] = run('client', 'cc_submit_order', order);
  ids.sql.o = sa.id; ids.demo.o = da.id;
  const O = (i) => ({ p_order: i.o });
  run('store2', 'cc_store_requests');
  ids.sql.item = sqlCall(S.store2, 'cc_store_requests')[0].id;
  demo.as(D.store2); ids.demo.item = demo.rpc('cc_store_requests')[0].id;
  run('store2', 'cc_store_respond', (i) => ({ p_item: i.item, p_confirm: true, p_price_cents: 100, p_note: 'ok' }));
  run('owner', 'cc_list_orders'); run('client', 'cc_list_orders'); run('owner', 'cc_get_order', O); run('client', 'cc_get_order', O);
  run('owner', 'cc_send_quote', (i) => ({ p_order: i.o, p_parts: 100, p_fee: 10, p_courier: 500, p_rush: 0, p_note: 'n', p_valid_hours: 24 }));
  run('client', 'cc_get_order', O);
  run('client', 'cc_respond_quote', (i) => ({ p_order: i.o, p_accept: true, p_note: 'yes' }));
  run('driver', 'cc_set_duty', () => ({ p_on: true, p_vehicle: 'Van' }));
  run('owner', 'cc_dispatch', (i) => ({ p_order: i.o, p_driver: null }));
  run('driver', 'cc_list_orders'); run('driver', 'cc_get_order', O);
  run('driver', 'cc_claim_job', O); run('driver', 'cc_alerts');
  run('client', 'cc_track', O);
  const stops = { sql: sqlCall(S.driver, 'cc_get_order', { p_order: ids.sql.o }).stops };
  demo.as(D.driver); stops.demo = demo.rpc('cc_get_order', { p_order: ids.demo.o }).stops;
  const step = (n, action, extra = {}) => run('driver', 'cc_stop_update', (i, b) => ({ p_stop: stops[b][n].id, p_action: action, p_received_by: null, p_note: null, p_lat: null, p_lng: null, ...extra }));
  run('driver', 'cc_ping', () => ({ p_lat: 39.25, p_lng: -85.95, p_accuracy: 10 }));
  step(0, 'arrive');
  run('client', 'cc_track', O); run('owner', 'cc_fleet');
  run('client', 'cc_post_message', (i) => ({ p_order: i.o, p_body: 'hi', p_internal: false }));
  run('owner', 'cc_post_message', (i) => ({ p_order: i.o, p_body: 'hello', p_internal: false }));
  run('driver', 'cc_post_message', (i) => ({ p_order: i.o, p_body: 'gate', p_internal: true }));
  run('client', 'cc_add_attachment', (i) => ({ p_order: i.o, p_path: i.o + '/d.pdf', p_name: 'd.pdf', p_kind: 'drawing', p_stop: null }));
  run('owner', 'cc_get_order', O); run('client', 'cc_get_order', O); run('driver', 'cc_get_order', O);
  step(0, 'done'); step(1, 'arrive'); step(1, 'done', { p_received_by: 'Dana' });
  run('owner', 'cc_close_order', (i) => ({ p_order: i.o, p_invoice: 'INV1' }));
  run('owner', 'cc_get_order', O);
  run('client', 'cc_alerts'); run('client', 'cc_alerts_read');
  run('owner', 'cc_admin_overview');
  run('driver', 'cc_set_duty', () => ({ p_on: false, p_vehicle: null }));
});

test('both backends refuse the same things with the same words', () => {
  demo.reset();
  const c = demo.addOrg('C', 'client');
  const u = demo.addUser('c', 'Client', 'client', c, true);
  demo.as(u);
  const bad = [[{ urgency: 'x', no_prohibited: true }, /how fast/], [{ no_prohibited: false }, /no carry list/], [{ no_prohibited: true, stops: [] }, /pickup and a drop/]];
  for (const [p, re] of bad) assert.throws(() => demo.rpc('cc_submit_order', { p }), re);
  const sqlText = raw("select prosrc from pg_proc where proname = 'cc_submit_order';");
  for (const phrase of ['how fast', 'no carry list', 'pickup and a drop']) assert.ok(sqlText.includes(phrase), phrase);
});
