// Run after setup-legal-leaf-preview.sql on the disposable tests/pg.sh database.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { test } from 'node:test';

const psql = ['-h', '127.0.0.1', '-p', '54329', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'];
const raw = sql => execFileSync('psql', psql, { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const queryAs = (uid, sql, role = 'authenticated') =>
  `begin; set local role ${role}; select set_config('request.jwt.claim.sub', '${uid}', true); ${sql}; commit;`;
const result = text => text.trim().split('\n').slice(1).join('\n').trim();
const call = (uid, sql, role) => result(raw(queryAs(uid, sql, role)));
const asyncQuery = sql => new Promise((resolve, reject) => {
  const process = spawn('psql', psql, { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', error = '';
  process.stdout.on('data', chunk => { output += chunk; });
  process.stderr.on('data', chunk => { error += chunk; });
  process.once('error', reject);
  process.once('close', code => code === 0 ? resolve(result(output)) : reject(new Error(error)));
  process.stdin.end(sql);
});

test('sample delivery is order-number idempotent, staff-scoped and attempt-scoped', async () => {
  raw(`
    insert into auth.users(email) values
      ('ll-preview-dispatch@crossroadsweddingco.shop'), ('ll-preview-nic@crossroadsweddingco.shop'),
      ('ll-preview-anthony@crossroadsweddingco.shop'), ('ll-preview-outsider@crossroadsweddingco.shop');
    with org as (insert into public.cc_orgs(name) values ('Sample Legal Leaf') returning id)
      insert into cc_legal_leaf.pilot(org_id) select id from org;
    update public.cc_members m set
      role = case when p.username = 'll-preview-dispatch' then 'dispatcher' else 'driver' end,
      org_id = case when p.username <> 'll-preview-outsider' then (select org_id from cc_legal_leaf.pilot) end
      from public.profiles p where p.id = m.user_id and p.username like 'll-preview-%';
    insert into cc_legal_leaf.staff(user_id, staff_role)
      select m.user_id, case when m.role = 'dispatcher' then 'dispatch' else 'driver' end
      from public.cc_members m where m.org_id = (select org_id from cc_legal_leaf.pilot);
    insert into public.cc_nda_acceptances(user_id, version, body_sha256, typed_name)
      select p.id, v.version, 'fixture', p.username from public.profiles p, public.cc_nda_versions v
      where p.username like 'll-preview-%' and v.is_current;
    insert into cc_legal_leaf.intake(order_number,pickup_address,drop_address,recipient,contact)
      values ('LL-SAMPLE-101','Sample pickup','100 Example Lane, Columbus, IN','Taylor Sample','812-555-0101'),
      ('LL-SAMPLE-102','Sample pickup','200 Example Lane, Columbus, IN','Casey Sample','812-555-0102');
  `);
  const who = name => raw(`select id from public.profiles where username = 'll-preview-${name}';`);
  const dispatch = who('dispatch'), nic = who('nic'), anthony = who('anthony'), outside = who('outsider');
  const range = "'2026-12-01 16:00-05', '2026-12-01 18:00-05'";
  const assign = `select cc_ll_preview_assign('LL-SAMPLE-101', '${nic}', ${range})`;
  assert.throws(() => call(nic, assign), /dispatch access required/);
  assert.throws(() => call(dispatch, `select cc_ll_preview_assign('LL-REAL-01', '${nic}', ${range})`), /Confirmed sample order required/);
  assert.throws(() => call(dispatch, `select cc_ll_preview_assign('LL-SAMPLE-102', '${outside}', ${range})`), /active Legal Leaf driver/);
  const [job, retry] = await Promise.all([
    asyncQuery(queryAs(dispatch, assign + '; select pg_sleep(0.3)')),
    asyncQuery(queryAs(dispatch, assign))
  ]);
  assert.match(job, /^[0-9a-f-]{36}$/);
  assert.equal(job, retry);
  assert.equal(call(dispatch, assign), job);
  assert.equal(raw('select count(*) from cc_legal_leaf.jobs'), '1');

  const read = `select cc_ll_preview_jobs('${job}')`;
  const update = (action, attempt = 1, more = '') =>
    `select cc_ll_preview_update('${job}', ${attempt}, '${action}'${more})`;
  assert.equal(JSON.parse(call(nic, read))[0].recipient, 'Taylor Sample');
  assert.deepEqual(JSON.parse(call(anthony, read)), []);
  assert.deepEqual(JSON.parse(call(anthony, 'select cc_ll_preview_jobs()')), []);
  assert.throws(() => call(anthony, update('picked_up')), /job unavailable/);
  assert.throws(() => call(outside, read), /staff access required/);
  assert.throws(() => call(outside, update('picked_up')), /staff access required/);
  assert.throws(() => call('', read, 'anon'), /permission denied/);
  assert.throws(() => call('', update('picked_up'), 'anon'), /permission denied/);
  assert.throws(() => call(nic, 'select * from cc_legal_leaf.jobs'), /permission denied/);
  assert.throws(() => call(outside, `select cc_get_order('${job}')`), /not found/i);
  assert.throws(() => call(dispatch, `select cc_track('${job}')`), /not found/i);
  assert.equal(call(dispatch, `select cc_can_upload('${job}')`), 'f');
  assert.equal(call(dispatch, `select cc_can_read_file('${job}/proof.jpg')`), 'f');
  assert.throws(() => call('', `select cc_public_track('${job.replaceAll('-', '').repeat(2)}')`, 'anon'), /tracking link is not valid/);
  const [alert] = JSON.parse(call(nic, 'select cc_alerts()'));
  assert.equal(alert.order_id, null);
  assert.equal(alert.title, 'Staff delivery assigned');
  assert.doesNotMatch(alert.body, /Taylor|Lane|101/);
  assert.deepEqual(JSON.parse(call(outside, 'select cc_alerts()')), []);

  assert.throws(() => call(nic, update('handed_off', 1, ', p_doorstep_checks_ok => true')), /outcome is unavailable/);
  assert.equal(call(nic, update('picked_up')), 'picked_up');
  assert.throws(() => call(nic, update('handed_off')), /outcome is unavailable/);
  assert.throws(() => call(nic, update('failed', 1, ", 'contains recipient data'")), /outcome is unavailable/);
  assert.equal(call(nic, update('failed', 1, ", 'id_check_failed'")), 'failed');
  assert.equal(call(dispatch, update('rescheduled', 1, `, null, '${anthony}', ${range}`)), 'assigned');
  assert.deepEqual(JSON.parse(call(nic, read)), []);
  assert.throws(() => call(anthony, update('picked_up')), /attempt changed/);
  assert.equal(call(anthony, update('picked_up', 2)), 'picked_up');
  assert.equal(call(anthony, update('handed_off', 2, ', p_doorstep_checks_ok => true')), 'handed_off');
  assert.deepEqual(JSON.parse(call(dispatch, read))[0].events.map(e => [e.attempt, e.outcome, e.reason]), [
    [1, 'assigned', null], [1, 'picked_up', null], [1, 'failed', 'id_check_failed'],
    [2, 'rescheduled', null], [2, 'picked_up', null], [2, 'handed_off', null]
  ]);
  assert.equal(call(dispatch, assign), job);
  const second = call(dispatch, `select cc_ll_preview_assign('LL-SAMPLE-102', '${nic}', ${range})`);
  assert.equal(call(dispatch, `select cc_ll_preview_update('${second}', 1, 'cancelled')`), 'cancelled');
  assert.throws(() => call(nic, `select cc_ll_preview_update('${second}', 1, 'picked_up')`), /outcome is unavailable/);
});
