// Runs the whole job against the real SQL on a throwaway Postgres (tests/pg.sh starts it).
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const PSQL = ['-h', '127.0.0.1', '-p', '54329', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'];
const raw = (sql) => execFileSync('psql', PSQL, { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const sqlVal = (v) => {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'object' && v.__t) return q(JSON.stringify(v.v)) + '::jsonb';
  if (typeof v === 'object' && v.__raw) return v.__raw;
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : `${v}::double precision`;
  if (typeof v === 'boolean') return String(v);
  return q(v);
};
const J = (v) => ({ __t: 1, v });
const U = (s) => ({ __raw: s === null ? 'null::uuid' : q(s) + '::uuid' });
// Call a function as a signed-in person, the way PostgREST does: as role authenticated with the JWT sub set.
function as(user, sql, role = 'authenticated') {
  const out = raw(`begin; set local role ${role}; select set_config('request.jwt.claim.sub', ${q(user ?? '')}, true); ${sql}; commit;`);
  return out.split('\n').slice(1).join('\n').trim();
}
function call(user, fn, ...args) {
  const out = as(user, `select public.${fn}(${args.map(sqlVal).join(', ')})`);
  return out ? JSON.parse(out) : null;
}
function fails(user, fn, args, re) {
  assert.throws(() => call(user, fn, ...args), re, `${fn} should fail with ${re}`);
}
function newUser(name) {
  raw(`insert into auth.users (email) values (${q(name + '@crossroadsweddingco.shop')});`);
  return raw(`select id from public.profiles where username = ${q(name)};`);
}
const NDA = () => JSON.parse(raw('select public.cc_current_nda();')).version;
const sign = (u, name) => call(u, 'cc_accept_nda', NDA(), name, 'Title', 'Co', 'test');
const uid = (name) => raw(`select id from public.profiles where username = ${q(name)};`);

const jake = uid('jake'), terry = uid('terry');
let clientA, clientB, storeA, storeB, driver2, orgA, orgB, orgS, orgS2, orderId, order;

test('lines that existed before the script became internal, with jake as owner', () => {
  assert.equal(call(jake, 'cc_me').role, 'owner');
  assert.equal(call(terry, 'cc_me').role, 'driver');
});

test('a brand new login is pending and can do nothing', () => {
  const p = newUser('newbie');
  assert.equal(call(p, 'cc_me').role, 'pending');
  fails(p, 'cc_list_orders', [], /waiting for approval/);
  fails(p, 'cc_accept_nda', [NDA(), 'New Person', '', '', ''], /waiting for approval/);
});

test('owner must accept the NDA before doing anything', () => {
  fails(jake, 'cc_admin_overview', [], /Accept the NDA/);
  fails(jake, 'cc_accept_nda', [NDA(), 'x', '', '', ''], /full legal name/);
  fails(jake, 'cc_accept_nda', ['bad-version', 'Jake Owner', '', '', ''], /out of date/);
  assert.equal(sign(jake, 'Jake Owner').nda_ok, true);
  assert.equal(raw(`select count(*) from public.cc_nda_acceptances where user_id = ${q(jake)};`), '1');
  sign(jake, 'Jake Owner');
  assert.equal(raw(`select count(*) from public.cc_nda_acceptances where user_id = ${q(jake)};`), '1');
  assert.match(raw(`select body_sha256 from public.cc_nda_acceptances where user_id = ${q(jake)};`), /^[0-9a-f]{64}$/);
});

test('owner sets up companies and logins', () => {
  orgA = call(jake, 'cc_admin_save_org', J({ name: 'Sample Client A', kind: 'client' })).id;
  orgB = call(jake, 'cc_admin_save_org', J({ name: 'Sample Client B', kind: 'client' })).id;
  orgS = call(jake, 'cc_admin_save_org', J({ name: 'Sample Store One', kind: 'store', supplier_slug: 's1' })).id;
  orgS2 = call(jake, 'cc_admin_save_org', J({ name: 'Sample Store Two', kind: 'store' })).id;
  clientA = newUser('clienta'); clientB = newUser('clientb'); storeA = newUser('storea'); storeB = newUser('storeb'); driver2 = newUser('driver2');
  const set = (u, r, o) => call(jake, 'cc_admin_set_member', U(u), r, o ? U(o) : U(null), true);
  set(clientA, 'client', orgA); set(clientB, 'client', orgB); set(storeA, 'store', orgS); set(storeB, 'store', orgS2); set(driver2, 'driver', null);
  fails(jake, 'cc_admin_set_member', [U(clientA), 'client', U(null), true], /need a company/);
  fails(jake, 'cc_admin_set_member', [U(jake), 'driver', U(null), true], /at least one owner/);
  for (const [u, n] of [[clientA, 'Client Ann'], [clientB, 'Client Bob'], [storeA, 'Store Sue'], [storeB, 'Store Sam'], [terry, 'Terry Driver'], [driver2, 'Driver Two']]) sign(u, n);
  fails(clientA, 'cc_admin_overview', [], /cannot do that/);
  fails(terry, 'cc_admin_overview', [], /cannot do that/);
  assert.equal(call(clientA, 'cc_me').org.name, 'Sample Client A');
});

test('outside logins cannot see or reach internal lines', () => {
  const see = (u) => as(u, 'select count(*) from public.profiles');
  assert.equal(see(clientA), '1');
  assert.equal(see(storeA), '1');
  const internalCount = Number(see(jake));
  assert.ok(internalCount >= 3);
  assert.ok(!as(jake, 'select string_agg(username, $$,$$) from public.profiles').includes('clienta'), 'internal list shows no customers');
  assert.throws(() => as(clientA, `insert into public.messages (recipient, body) values (${q(jake)}, 'hello')`), /row-level security/);
  assert.throws(() => as(jake, `insert into public.messages (recipient, body) values (${q(clientA)}, 'hello')`), /row-level security/);
  assert.throws(() => as(clientA, `insert into public.calls (callee, kind) values (${q(jake)}, 'audio')`), /row-level security/);
  as(jake, `insert into public.messages (recipient, body) values (${q(terry)}, 'still works')`);
  assert.equal(as(terry, `select count(*) from public.messages where body = 'still works'`), '1');
});

test('no table can be read directly', () => {
  for (const t of ['cc_orders', 'cc_stops', 'cc_items', 'cc_quotes', 'cc_events', 'cc_members', 'cc_orgs', 'cc_driver_pos', 'cc_nda_acceptances', 'cc_access_requests', 'cc_order_messages', 'cc_attachments']) {
    assert.throws(() => as(jake, `select * from public.${t}`), /permission denied/, t);
    assert.throws(() => as(null, `select * from public.${t}`, 'anon'), /permission denied/, t);
  }
  assert.throws(() => as(jake, `insert into public.cc_events (order_id, type) values (gen_random_uuid(), 'fake')`), /permission denied/);
  assert.throws(() => as(jake, `select public.cc_log(gen_random_uuid(), 'fake')`), /permission denied/);
  assert.throws(() => as(jake, `select public.cc_notify(${q(jake)}, null, 'x', 'y', false)`), /permission denied/);
});

test('the public can request access, nothing else', () => {
  const pub = (sql) => as(null, sql, 'anon');
  pub(`select public.cc_request_access('Sample Shop', 'Pat Shop', 'pat@example.com', '', 'client', 'hi')`);
  pub(`select public.cc_request_access('Sample Shop', 'Pat Shop', 'pat@example.com', '', 'client', 'again')`);
  assert.equal(raw(`select count(*) from public.cc_access_requests where email = 'pat@example.com';`), '1');
  assert.throws(() => pub(`select public.cc_request_access('', '', '', '', 'client', '')`), /company/);
  assert.throws(() => pub(`select public.cc_me()`), /permission denied/);
  assert.throws(() => pub(`select public.cc_list_orders()`), /permission denied/);
  assert.equal(call(jake, 'cc_admin_overview').requests.length, 1);
});

const goodOrder = () => ({
  urgency: 'hotshot', title: 'Prototype brackets', notes: 'Fragile', blind: true, no_prohibited: true,
  stops: [
    { kind: 'pickup', place_name: 'Sample Machine Shop', address: '1 Main St', contact: 'Lee', instructions: 'Ask for job number' },
    { kind: 'process', place_name: 'Sample Anodizer', address: '2 Main St', instructions: 'Type II clear' },
    { kind: 'drop', place_name: 'Client A Dock', address: '3 Main St', instructions: 'Dock 4' },
  ],
  items: [
    { action: 'pickup', description: 'Secret bracket', part_no: 'ABC-1', qty: 40, supplier_name: 'Sample Machine Shop' },
    { action: 'process', description: 'Anodize brackets', qty: 40, supplier_name: 'Sample Anodizer' },
  ],
});

test('orders validate what they are given', () => {
  const bad = (patch, re) => fails(clientA, 'cc_submit_order', [J({ ...goodOrder(), ...patch })], re);
  bad({ no_prohibited: false }, /no carry list/);
  bad({ stops: [{ kind: 'drop', place_name: 'x' }] }, /pickup and a drop/);
  bad({ stops: [{ kind: 'pickup', place_name: 'a' }, { kind: 'pickup', place_name: 'b' }] }, /delivered/);
  bad({ stops: [{ kind: 'drop', place_name: 'a' }, { kind: 'pickup', place_name: 'b' }] }, /last stop/);
  bad({ urgency: 'yesterday' }, /how fast/);
  bad({ items: [{ description: '', qty: 1 }] }, /description/);
  bad({ items: [{ description: 'x', qty: 0 }] }, /more than zero/);
  fails(terry, 'cc_submit_order', [J(goodOrder())], /cannot do that/);
});

test('the full run: request, quote, approve, offer, claim, stops, delivered, closed', () => {
  order = call(clientA, 'cc_submit_order', J(goodOrder()));
  orderId = order.id;
  assert.match(order.ref, /^PL-\d+$/);
  assert.equal(order.kind, 'process');
  const oid = U(orderId);

  // Other customers and off-duty drivers cannot see it.
  fails(clientB, 'cc_get_order', [oid], /not found/);
  assert.equal(call(clientB, 'cc_list_orders').length, 0);
  fails(terry, 'cc_get_order', [oid], /not found/);
  assert.equal(call(jake, 'cc_alerts')[0].title, 'New hot shot request');
  assert.ok(!JSON.stringify(call(jake, 'cc_alerts')).includes('Secret'), 'alerts never include cargo');

  fails(clientA, 'cc_send_quote', [oid, 0, 0, 5000, 0, '', 24], /cannot do that/);
  fails(jake, 'cc_send_quote', [oid, 0, 0, 0, 0, '', 24], /above zero/);
  fails(jake, 'cc_dispatch', [oid, U(null)], /not ready/);
  fails(clientA, 'cc_respond_quote', [oid, true, ''], /no open quote/);
  assert.equal(call(jake, 'cc_send_quote', oid, 0, 0, 5000, 2500, 'First', 24).total_cents, 7500);
  assert.equal(call(jake, 'cc_send_quote', oid, 1000, 200, 5000, 2500, 'Better', 24).total_cents, 8700);
  const seen = call(clientA, 'cc_get_order', oid);
  assert.equal(seen.quote.total_cents, 8700);
  assert.equal(seen.status, 'quoted');
  fails(clientB, 'cc_respond_quote', [oid, true, ''], /not found/);
  fails(jake, 'cc_respond_quote', [oid, true, ''], /who approved/);
  raw(`update public.cc_quotes set valid_until = now() - interval '1 hour' where order_id = ${q(orderId)} and status = 'sent';`);
  fails(clientA, 'cc_respond_quote', [oid, true, ''], /expired/);
  raw(`update public.cc_quotes set valid_until = now() + interval '1 hour' where order_id = ${q(orderId)} and status = 'sent';`);
  assert.equal(call(clientA, 'cc_respond_quote', oid, true, 'go').status, 'approved');

  call(terry, 'cc_set_duty', true, 'Van 1');
  assert.equal(call(jake, 'cc_dispatch', oid, U(null)).offered, 1);
  assert.equal(call(terry, 'cc_alerts')[0].urgent, true);
  assert.ok(!JSON.stringify(call(terry, 'cc_alerts')).includes('Client'), 'driver alert has no customer name');

  // Blind: the driver sees stops, not the cargo or the customer.
  const dv = call(terry, 'cc_get_order', oid);
  assert.equal(dv.side, 'driver');
  assert.equal(dv.title, null);
  assert.equal(dv.notes, null);
  assert.deepEqual(dv.items, []);
  assert.equal(dv.cargo_hidden, true);
  assert.equal(dv.item_count, 2);
  assert.equal(dv.quote, undefined);
  assert.equal(dv.org_name, undefined);
  assert.equal(dv.stops.length, 3);
  assert.ok(!JSON.stringify(dv).includes('Secret'));
  assert.ok(!JSON.stringify(dv).includes('Sample Client'));
  assert.equal(dv.stops[0].contact, null, 'contact stays hidden until claimed');
  const list = call(terry, 'cc_list_orders');
  assert.equal(list[0].title, null);
  assert.equal(list[0].org_name, undefined);

  fails(driver2, 'cc_claim_job', [oid], /Go on duty/);
  call(driver2, 'cc_set_duty', true, null);
  assert.equal(call(terry, 'cc_claim_job', oid).status, 'assigned');
  fails(driver2, 'cc_claim_job', [oid], /already claimed/);
  fails(driver2, 'cc_get_order', [oid], /not found/);
  assert.equal(call(terry, 'cc_get_order', oid).stops[0].contact, 'Lee');

  assert.equal(call(terry, 'cc_release_job', oid, 'flat tire').status, 'dispatching');
  fails(terry, 'cc_release_job', [oid, 'again'], /not yours/);
  call(driver2, 'cc_claim_job', oid);
  call(jake, 'cc_dispatch', oid, U(terry));

  const stops = call(terry, 'cc_get_order', oid).stops;
  const sid = (i) => U(stops[i].id);
  fails(driver2, 'cc_stop_update', [sid(0), 'arrive', null, null, null, null], /not yours/);
  fails(terry, 'cc_stop_update', [sid(1), 'arrive', null, null, null, null], /earlier stop/);
  fails(terry, 'cc_stop_update', [sid(0), 'done', null, null, null, null], /arrived first/);

  // GPS: nothing yet, then live, and the customer only sees it while the job is moving.
  assert.equal(call(clientA, 'cc_track', oid).state, 'not_moving');
  assert.equal(call(terry, 'cc_stop_update', sid(0), 'arrive', null, null, 39.2, -85.9).status, 'in_progress');
  fails(terry, 'cc_release_job', [oid, 'too late'], /already started/);
  fails(clientA, 'cc_cancel_order', [oid, 'changed my mind'], /Message dispatch/);
  fails(jake, 'cc_cancel_order', [oid, 'nope'], /no longer be cancelled/);
  assert.equal(call(clientA, 'cc_track', oid).state, 'no_signal');
  assert.equal(call(terry, 'cc_ping', 39.21, -85.91, 8, null, null).stored, true);
  const live = call(clientA, 'cc_track', oid);
  assert.equal(live.state, 'live');
  assert.equal(live.lat, 39.21);
  fails(clientB, 'cc_track', [oid], /not found/);
  fails(terry, 'cc_track', [oid], /cannot do that/);
  fails(clientA, 'cc_ping', [1, 1, null, null, null], /cannot do that/);
  fails(terry, 'cc_ping', [120, 1, null, null, null], /Bad position/);
  const fleet = call(jake, 'cc_fleet');
  const t = fleet.find((d) => d.id === terry);
  assert.equal(t.lat, 39.21);
  assert.deepEqual(t.jobs, [order.ref]);
  assert.ok(!fleet.some((d) => d.id === clientA), 'customers are not in the fleet');

  // Messages: the customer thread and the driver thread stay apart.
  call(clientA, 'cc_post_message', oid, 'Please call on arrival', false);
  call(terry, 'cc_post_message', oid, 'Gate code needed', true);
  call(jake, 'cc_post_message', oid, 'Note for the driver only', true);
  call(jake, 'cc_post_message', oid, 'On the way', false);
  const cm = call(clientA, 'cc_get_order', oid).messages.map((m) => m.body);
  assert.deepEqual(cm, ['Please call on arrival', 'On the way']);
  const dm = call(terry, 'cc_get_order', oid).messages.map((m) => m.body);
  assert.deepEqual(dm, ['Gate code needed', 'Note for the driver only']);
  assert.equal(call(jake, 'cc_get_order', oid).messages.length, 4);
  assert.ok(call(clientA, 'cc_get_order', oid).messages.every((m) => m.sender_side === 'client' || m.sender_name === 'Dispatch'));
  fails(clientB, 'cc_post_message', [oid, 'hi', false], /not found/);

  call(terry, 'cc_stop_update', sid(0), 'done', null, 'Boxes: 2', 39.2, -85.9);
  call(terry, 'cc_stop_update', sid(1), 'arrive', null, null, null, null);
  call(terry, 'cc_stop_update', sid(1), 'done', null, null, null, null);
  call(terry, 'cc_stop_update', sid(2), 'arrive', null, null, null, null);
  fails(terry, 'cc_stop_update', [sid(2), 'done', '', null, null, null], /name of the person/);
  fails(jake, 'cc_close_order', [oid, 'INV-1'], /Only a delivered/);
  assert.equal(call(terry, 'cc_stop_update', sid(2), 'done', 'Dana Receiver', null, 39.3, -85.8).status, 'delivered');
  assert.equal(call(clientA, 'cc_track', oid).state, 'not_moving');
  const cv = call(clientA, 'cc_get_order', oid);
  assert.equal(cv.stops[2].received_by, 'Dana Receiver');
  assert.equal(cv.driver_name, call(terry, 'cc_me').display_name);
  const types = cv.events.map((e) => e.type);
  for (const want of ['order_placed', 'quote_sent', 'quote_accepted', 'driver_assigned', 'arrived', 'picked_up', 'processed', 'delivered_stop', 'delivered']) assert.ok(types.includes(want), want);
  assert.ok(!types.includes('driver_released'), 'internal events stay internal');
  assert.ok(!JSON.stringify(cv.events).includes(terry), 'driver id stays out of the customer view');
  assert.equal(call(jake, 'cc_close_order', oid, 'INV-1').status, 'closed');
  fails(jake, 'cc_send_quote', [oid, 1, 1, 1, 1, '', 1], /past the quote stage/);
  call(terry, 'cc_set_duty', false, null);
  assert.equal(raw(`select count(*) from public.cc_driver_pos where user_id = ${q(terry)};`), '0', 'going off duty erases position');
});

test('tracking hides the driver when he is also on another customer job', () => {
  const mk = (u) => call(u, 'cc_submit_order', J({ ...goodOrder(), urgency: 'same_day' })).id;
  const a = mk(clientA), b = mk(clientB);
  for (const [id, who] of [[a, clientA], [b, clientB]]) {
    call(jake, 'cc_send_quote', U(id), 0, 0, 100, 0, '', 24);
    call(who, 'cc_respond_quote', U(id), true, null);
    call(jake, 'cc_dispatch', U(id), U(terry));
  }
  call(terry, 'cc_set_duty', true, null);
  call(terry, 'cc_ping', 39.2, -85.9, null, null, null);
  const stopA = call(terry, 'cc_get_order', U(a)).stops[0].id, stopB = call(terry, 'cc_get_order', U(b)).stops[0].id;
  call(terry, 'cc_stop_update', U(stopA), 'arrive', null, null, null, null);
  assert.equal(call(clientA, 'cc_track', U(a)).state, 'live');
  call(terry, 'cc_stop_update', U(stopB), 'arrive', null, null, null, null);
  assert.equal(call(clientA, 'cc_track', U(a)).state, 'hidden');
  assert.equal(call(clientB, 'cc_track', U(b)).state, 'hidden');
  assert.equal(call(jake, 'cc_track', U(a)).state, 'live');
});

test('non-blind jobs show the driver the cargo', () => {
  const id = call(clientA, 'cc_submit_order', J({ ...goodOrder(), blind: false, urgency: 'next_day' })).id;
  call(jake, 'cc_send_quote', U(id), 0, 0, 100, 0, '', 24);
  call(jake, 'cc_respond_quote', U(id), true, 'Ann by phone');
  call(jake, 'cc_dispatch', U(id), U(terry));
  const d = call(terry, 'cc_get_order', U(id));
  assert.equal(d.title, 'Prototype brackets');
  assert.equal(d.items.length, 2);
  assert.equal(d.items[0].store_name, null);
  const ev = call(jake, 'cc_get_order', U(id)).events.find((e) => e.type === 'quote_accepted');
  assert.equal(ev.detail.by_dispatch, true);
  assert.equal(ev.detail.note, 'Ann by phone');
});

test('store to store: the other store sees only its line, no customer', () => {
  const stores = call(clientA, 'cc_list_stores');
  assert.equal(stores.length, 2);
  assert.ok(!call(storeA, 'cc_list_stores').some((s) => s.id === orgS), 'a store does not list itself');
  const o = call(storeA, 'cc_submit_order', J({ urgency: 'same_day', no_prohibited: true, blind: true, title: 'Pull from store two',
    stops: [{ kind: 'pickup', place_name: 'Store Two' }, { kind: 'drop', place_name: 'Store One' }],
    items: [{ action: 'pickup', description: 'Seal kit', part_no: 'SK-9', qty: 2, store_org_id: orgS2 }] }));
  assert.equal(o.kind, 'transfer');
  fails(storeA, 'cc_submit_order', [J({ urgency: 'same_day', no_prohibited: true,
    stops: [{ kind: 'pickup', place_name: 'a' }, { kind: 'drop', place_name: 'b' }],
    items: [{ description: 'x', qty: 1, store_org_id: orgS }] })], /different store/);
  fails(storeA, 'cc_submit_order', [J({ urgency: 'same_day', no_prohibited: true,
    stops: [{ kind: 'pickup', place_name: 'a' }, { kind: 'drop', place_name: 'b' }],
    items: [{ description: 'x', qty: 1, store_org_id: orgA }] })], /not in the network/);
  const reqs = call(storeB, 'cc_store_requests');
  assert.equal(reqs.length, 1);
  assert.equal(reqs[0].description, 'Seal kit');
  assert.ok(!JSON.stringify(reqs).includes('Sample Store One'), 'the supplying store does not see who asked');
  assert.equal(call(storeA, 'cc_store_requests').length, 0);
  fails(clientA, 'cc_store_requests', [], /cannot do that/);
  fails(storeB, 'cc_get_order', [U(o.id)], /not found/);
  fails(storeA, 'cc_store_respond', [U(reqs[0].id), true, 500, ''], /not found/);
  fails(storeB, 'cc_store_respond', [U(reqs[0].id), true, null, ''], /Add your price/);
  assert.equal(call(storeB, 'cc_store_respond', U(reqs[0].id), true, 4200, 'On the shelf').store_status, 'confirmed');
  fails(storeB, 'cc_store_respond', [U(reqs[0].id), true, 4200, ''], /already answered/);
  const dv = call(jake, 'cc_get_order', U(o.id));
  assert.equal(dv.items[0].store_price_cents, 4200);
  assert.equal(dv.items[0].store_name, 'Sample Store Two');
  const asker = call(storeA, 'cc_get_order', U(o.id));
  assert.equal(asker.items[0].store_price_cents, null, 'the asking side sees the quote, not the store price');
});

test('cancel rules and quote decline', () => {
  const mk = () => call(clientA, 'cc_submit_order', J(goodOrder())).id;
  const a = mk();
  fails(clientA, 'cc_cancel_order', [U(a), ''], /Say why/);
  fails(clientB, 'cc_cancel_order', [U(a), 'not mine'], /not found/);
  assert.equal(call(clientA, 'cc_cancel_order', U(a), 'wrong part').status, 'cancelled');
  const b = mk();
  call(jake, 'cc_send_quote', U(b), 0, 0, 100, 0, '', 24);
  assert.equal(call(clientA, 'cc_respond_quote', U(b), false, 'too high').status, 'declined');
  fails(jake, 'cc_dispatch', [U(b), U(null)], /not ready/);
});

test('files: only the right people can upload or read', () => {
  const id = call(clientA, 'cc_submit_order', J(goodOrder())).id;
  const path = `${id}/drawing.pdf`;
  assert.equal(as(clientA, `select public.cc_can_upload(${q(id)})`), 't');
  assert.equal(as(clientB, `select public.cc_can_upload(${q(id)})`), 'f');
  assert.equal(as(clientA, `select public.cc_can_upload('not-a-uuid')`), 'f');
  as(clientA, `insert into storage.objects (bucket_id, name, owner) values ('cc-files', ${q(path)}, ${q(clientA)})`);
  assert.throws(() => as(clientB, `insert into storage.objects (bucket_id, name, owner) values ('cc-files', ${q(id + '/x.pdf')}, ${q(clientB)})`), /row-level security/);
  call(clientA, 'cc_add_attachment', U(id), path, 'drawing.pdf', 'drawing', U(null));
  fails(clientA, 'cc_add_attachment', [U(id), 'other/x.pdf', 'x', 'drawing', U(null)], /path/);
  fails(clientA, 'cc_add_attachment', [U(id), `${id}/p.jpg`, 'p', 'proof', U(null)], /not found/);
  assert.equal(as(clientA, `select count(*) from storage.objects where name = ${q(path)}`), '1');
  assert.equal(as(clientB, `select count(*) from storage.objects where name = ${q(path)}`), '0');
  call(jake, 'cc_send_quote', U(id), 0, 0, 100, 0, '', 24);
  call(clientA, 'cc_respond_quote', U(id), true, null);
  call(jake, 'cc_dispatch', U(id), U(driver2));
  assert.equal(as(driver2, `select count(*) from storage.objects where name = ${q(path)}`), '0', 'a blind driver cannot read the drawing');
  assert.equal(call(driver2, 'cc_get_order', U(id)).attachments.length, 0);
  assert.equal(call(clientA, 'cc_get_order', U(id)).attachments.length, 1);
  fails(driver2, 'cc_add_attachment', [U(id), `${id}/d.pdf`, 'd', 'drawing', U(null)], /not yours/);
  call(driver2, 'cc_add_attachment', U(id), `${id}/proof.jpg`, 'proof.jpg', 'proof', U(null));
  assert.equal(call(driver2, 'cc_get_order', U(id)).attachments.length, 1);
});
