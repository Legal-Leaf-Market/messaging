// Demo backend: the same calls as setup-courier.sql, kept in memory in this browser tab.
// Only loaded for ?demo=1. tests/contract.test.mjs checks it returns the same shapes as the SQL.
(function (root) {
  'use strict';
  const now = () => Date.now();
  const iso = (t) => new Date(t === undefined ? now() : t).toISOString();
  let seq = 1000, idn = 1;
  const uid = (p) => (p || 'x') + '-' + (idn++);
  const token = () => Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
  const clone = (x) => JSON.parse(JSON.stringify(x === undefined ? null : x));
  const fail = (m) => { throw new Error(m); };
  const clean = (s) => String(s == null ? '' : s).trim();
  const INTERNAL = ['owner', 'dispatcher', 'driver'];
  const NDA = (root.CC_DATA && root.CC_DATA.nda) || { version: 'demo', body: 'Demo NDA' };

  function makeState() {
    return { users: {}, orgs: {}, orders: {}, alerts: [], requests: [], rides: [], pos: {}, nda: {}, files: {}, me: null, alertId: 1, msgId: 1, evId: 1, quoteId: 1, fileId: 1, listeners: [] };
  }
  let S = makeState();

  const user = (id) => S.users[id];
  const me = () => S.me && user(S.me);
  const role = () => { const u = me(); return u ? (u.active ? u.role : 'pending') : 'pending'; };
  const ndaOk = (id) => !!S.nda[id || S.me];
  function req() {
    const r = role();
    if (!S.me) fail('Sign in first.');
    if (r === 'pending') fail('This login is waiting for approval.');
    if (!Array.prototype.slice.call(arguments).includes(r)) fail('This login cannot do that.');
    if (!ndaOk()) fail('Accept the NDA first.');
    return r;
  }
  const myOrg = () => (me() && me().org_id) || null;
  function push(userId, order, title, body, urgent) {
    const a = { id: S.alertId++, user_id: userId, order_id: order ? order.id : null, title, body, urgent: !!urgent, read: false, at: iso() };
    S.alerts.unshift(a);
    S.listeners.forEach((f) => { try { f(a); } catch (e) { /* a listener must not break the action */ } });
  }
  const pushDispatch = (o, t, b, u) => Object.values(S.users).filter((x) => ['owner', 'dispatcher'].includes(x.role) && x.active).forEach((x) => push(x.id, o, t, b, u));
  const pushOrg = (orgId, o, t, b) => Object.values(S.users).filter((x) => x.org_id === orgId && ['client', 'store'].includes(x.role) && x.active).forEach((x) => push(x.id, o, t, b));
  const log = (o, type, detail, clientVisible) => o.events.push({ id: S.evId++, at: iso(), type, detail: detail || {}, client_visible: clientVisible !== false, actor: S.me, actor_role: role() });
  const getOrder = (id) => S.orders[id] || fail('Order not found.');
  const openQuote = (o) => o.quotes.filter((q) => q.status === 'sent').slice(-1)[0];
  const activeQuote = (o) => o.quotes.filter((q) => ['sent', 'accepted'].includes(q.status)).slice(-1)[0];
  const stopsDone = (o) => o.stops.filter((s) => s.status === 'done').length;

  const IND = { place_name: 'Indianapolis International Airport (IND)', address: '7800 Col. H. Weir Cook Memorial Dr, Indianapolis, IN 46241', lat: 39.7173, lng: -86.2944 };
  function rideCheck(p) {
    if (!['to_ind', 'from_ind'].includes(p.direction)) fail('Pick to the airport or from the airport.');
    const a = clean(p.address); if (a.length < 5 || a.length > 200) fail('Add the address for the other end of the ride.');
    const n = Number(p.passengers || 0); if (!(n >= 1 && n <= 7)) fail('Up to 7 riders per vehicle. Call for a bigger group.');
    const b = Number(p.bags || 0); if (!(b >= 0 && b <= 20)) fail('Bags has to be a number from 0 to 20.');
    if (p.direction === 'to_ind' && !p.pickup_at) fail('Add when we should pick you up.');
    if (p.direction === 'from_ind' && !p.flight_at) fail('Add when the flight lands.');
  }
  function rideStops(p) {
    const here = { place_name: clean(p.place_name) || (p.direction === 'to_ind' ? 'Pickup' : 'Drop-off'), address: clean(p.address) };
    const fl = clean(p.flight);
    if (p.direction === 'to_ind') return [Object.assign({ kind: 'pickup', contact: clean(p.passenger_name), instructions: clean(p.notes) || null }, here),
      Object.assign({ kind: 'drop', instructions: 'Departures curb, upper level. ' + (fl ? 'Airline: ' + fl : '') }, IND)];
    return [Object.assign({ kind: 'pickup', contact: clean(p.passenger_name), instructions: 'Meet at the Ground Transportation Center, first floor of the terminal garage. ' + (fl ? 'Flight: ' + fl : '') }, IND),
      Object.assign({ kind: 'drop', instructions: clean(p.notes) || null }, here)];
  }

  const fn = {
    cc_me() {
      if (!S.me) fail('Sign in first.');
      const u = me(), o = u.org_id && S.orgs[u.org_id];
      return { id: u.id, username: u.username, display_name: u.display_name, role: role(), on_duty: !!u.on_duty, vehicle: u.vehicle || null,
        org: o ? { id: o.id, name: o.name, kind: o.kind } : null, nda_ok: ndaOk() };
    },
    cc_current_nda() { return { version: NDA.version, body: NDA.body }; },
    cc_accept_nda({ p_version, p_typed_name }) {
      if (!S.me) fail('Sign in first.');
      if (role() === 'pending') fail('This login is waiting for approval.');
      if (p_version !== NDA.version) fail('That NDA version is out of date. Reload and read the current one.');
      const n = clean(p_typed_name);
      if (n.length < 3 || n.length > 120) fail('Type your full legal name to accept.');
      if (!ndaOk()) S.nda[S.me] = { name: n, at: iso() };
      return fn.cc_me();
    },
    cc_request_access({ p_company, p_contact, p_email, p_phone, p_kind, p_note }) {
      const c = clean(p_company), n = clean(p_contact), e = clean(p_email).toLowerCase();
      if (c.length < 2 || n.length < 2) fail('Add your company and your name.');
      if (!e && !clean(p_phone)) fail('Add an email or a phone number.');
      if (!['client', 'store', 'driver'].includes(p_kind)) fail('Pick what you need access for.');
      S.requests.unshift({ id: S.requests.length + 1, company: c, contact: n, email: e || null, phone: clean(p_phone), kind: p_kind, note: clean(p_note), at: iso() });
      Object.values(S.users).filter((u) => u.role === 'owner').forEach((u) => push(u.id, null, 'New access request', 'Someone asked for access. Open Admin to review it.'));
      return { ok: true };
    },
    cc_list_stores() {
      req('owner', 'dispatcher', 'driver', 'client', 'store');
      return Object.values(S.orgs).filter((o) => o.kind === 'store' && o.active && o.id !== myOrg()).map((o) => ({ id: o.id, name: o.name, supplier_slug: o.supplier_slug || null })).sort((a, b) => a.name.localeCompare(b.name));
    },
    cc_submit_order({ p }) {
      const r = req('owner', 'dispatcher', 'client', 'store');
      let org = myOrg();
      if (['owner', 'dispatcher'].includes(r) && p.org_id) org = p.org_id;
      if (['client', 'store'].includes(r) && !org) fail('This login is not tied to a company yet.');
      if (p.no_prohibited !== true) fail('Confirm the order has nothing from the no carry list.');
      const urg = p.urgency || 'same_day';
      if (!['hotshot', 'same_day', 'next_day', 'scheduled'].includes(urg)) fail('Pick how fast this needs to move.');
      const stops = p.stops || [], items = p.items || [];
      if (stops.length < 2 || stops.length > 12) fail('A run needs a pickup and a drop, and at most 12 stops.');
      if (items.length > 40) fail('Keep an order to 40 lines.');
      if (!stops.some((s) => s.kind === 'drop')) fail('Add where this gets delivered.');
      if (stops[stops.length - 1].kind !== 'drop') fail('The last stop has to be a drop.');
      stops.forEach((s) => { if (!['pickup', 'process', 'drop'].includes(s.kind)) fail('That order has a bad stop.'); if (!clean(s.place_name)) fail('Every stop needs a place name.'); });
      let kind = 'courier';
      const asked = [];
      items.forEach((i) => {
        if (!clean(i.description)) fail('Every line needs a description.');
        if (!['buy', 'pickup', 'process', undefined].includes(i.action)) fail('That order has a bad line.');
        if ((i.qty === undefined ? 1 : Number(i.qty)) <= 0) fail('Quantities have to be more than zero.');
        if (i.store_org_id) {
          if (i.store_org_id === org) fail('Pick a different store than your own.');
          const st = S.orgs[i.store_org_id];
          if (!st || st.kind !== 'store' || !st.active) fail('That store is not in the network.');
          asked.push(i.store_org_id); kind = 'transfer';
        } else if (kind !== 'transfer') {
          if (i.action === 'buy') kind = 'purchase';
          else if (i.action === 'process' && kind !== 'purchase') kind = 'process';
        }
      });
      const o = { id: uid('order'), ref: 'PL-' + (++seq), kind, status: 'requested', urgency: urg, org_id: org, created_by: S.me, driver_id: null,
        title: clean(p.title).slice(0, 120) || null, notes: clean(p.notes).slice(0, 2000) || null, blind: p.blind !== false, need_by: p.need_by || null, invoice_ref: null, ride: null, track_token: token(),
        created_at: iso(), updated_at: iso(), events: [], messages: [], quotes: [], attachments: [],
        stops: stops.map((s, i) => ({ id: uid('stop'), seq: i + 1, kind: s.kind, place_name: clean(s.place_name), address: clean(s.address) || null, supplier_slug: s.supplier_slug || null,
          contact: clean(s.contact) || null, instructions: clean(s.instructions) || null, lat: s.lat === undefined ? null : s.lat, lng: s.lng === undefined ? null : s.lng,
          status: 'pending', arrived_at: null, done_at: null, received_by: null, note: null })),
        items: items.map((i, n) => ({ id: uid('item'), seq: n + 1, action: i.action || 'pickup', supplier_slug: i.supplier_slug || null, supplier_name: clean(i.supplier_name) || null,
          description: clean(i.description), part_no: clean(i.part_no) || null, qty: i.qty === undefined ? 1 : Number(i.qty), store_org_id: i.store_org_id || null,
          store_status: i.store_org_id ? 'asked' : 'none', store_price_cents: null, store_note: null })) };
      S.orders[o.id] = o;
      log(o, 'order_placed', { urgency: urg, no_carry_confirmed: true });
      pushDispatch(o, urg === 'hotshot' ? 'New hot shot request' : 'New order request', o.ref + ' needs a quote.', urg === 'hotshot');
      Array.from(new Set(asked)).forEach((x) => pushOrg(x, o, 'Stock request', 'Another store asked if you can supply a part. Job ' + o.ref + '.'));
      return { id: o.id, ref: o.ref, kind };
    },
    cc_send_quote({ p_order, p_parts, p_fee, p_courier, p_rush, p_note, p_valid_hours }) {
      req('owner', 'dispatcher');
      const o = getOrder(p_order);
      if (!['requested', 'quoted'].includes(o.status)) fail('This order is past the quote stage.');
      const v = [p_parts, p_fee, p_courier, p_rush].map((x) => Number(x || 0));
      if (Math.min.apply(null, v) < 0) fail('Amounts cannot be negative.');
      const total = v.reduce((a, b) => a + b, 0);
      if (total <= 0) fail('A quote needs a total above zero.');
      const h = p_valid_hours === undefined || p_valid_hours === null ? 24 : Number(p_valid_hours);
      if (h < 1 || h > 720) fail('A quote can last from 1 hour to 30 days.');
      o.quotes.forEach((q) => { if (q.status === 'sent') q.status = 'superseded'; });
      const q = { id: S.quoteId++, parts_cents: v[0], purchase_fee_cents: v[1], courier_cents: v[2], rush_cents: v[3], total_cents: total, note: clean(p_note) || null, valid_until: iso(now() + h * 3600e3), status: 'sent' };
      o.quotes.push(q); o.status = 'quoted'; o.updated_at = iso();
      log(o, 'quote_sent', { total_cents: total });
      pushOrg(o.org_id, o, 'Your quote is ready', 'Quote ready on job ' + o.ref + '.');
      return { quote_id: q.id, total_cents: total };
    },
    cc_respond_quote({ p_order, p_accept, p_note }) {
      const r = req('owner', 'dispatcher', 'client', 'store');
      const o = S.orders[p_order];
      if (!o || (['client', 'store'].includes(r) && o.org_id !== myOrg())) fail('Order not found.');
      const note = clean(p_note);
      const disp = ['owner', 'dispatcher'].includes(r);
      if (disp && !note) fail('Add who approved it and how, like "Dana by phone".');
      if (o.status !== 'quoted') fail('There is no open quote on this order.');
      const q = openQuote(o);
      if (!q) fail('There is no open quote on this order.');
      if (p_accept && Date.parse(q.valid_until) < now()) fail('This quote expired. Ask for a new one.');
      q.status = p_accept ? 'accepted' : 'declined';
      o.status = p_accept ? 'approved' : 'declined'; o.updated_at = iso();
      log(o, p_accept ? 'quote_accepted' : 'quote_declined', { total_cents: q.total_cents, note: note || null, by_dispatch: disp });
      pushDispatch(o, p_accept ? 'Quote accepted' : 'Quote declined', o.ref + (p_accept ? ' is ready to dispatch.' : ' was declined.'), p_accept && o.urgency === 'hotshot');
      return { status: o.status };
    },
    cc_set_duty({ p_on, p_vehicle }) {
      req('owner', 'dispatcher', 'driver');
      const u = me(); u.on_duty = !!p_on;
      if (clean(p_vehicle)) u.vehicle = clean(p_vehicle);
      if (!p_on) delete S.pos[u.id];
      return fn.cc_me();
    },
    cc_dispatch({ p_order, p_driver }) {
      req('owner', 'dispatcher');
      const o = getOrder(p_order);
      if (!['approved', 'dispatching', 'assigned'].includes(o.status)) fail('This order is not ready to dispatch.');
      const hot = o.urgency === 'hotshot';
      if (!p_driver) {
        o.status = 'dispatching'; o.driver_id = null; o.updated_at = iso();
        const on = Object.values(S.users).filter((u) => INTERNAL.includes(u.role) && u.active && u.on_duty && ndaOk(u.id));
        on.forEach((u) => push(u.id, o, hot ? 'Hot shot job open' : 'Job open', 'Job ' + o.ref + ' is open. First to claim it gets it.', hot));
        log(o, 'offered_to_drivers', { drivers: on.length }, false);
        return { status: 'dispatching', offered: on.length };
      }
      const d = user(p_driver);
      if (!d || !INTERNAL.includes(d.role)) fail('That person is not a driver.');
      if (!ndaOk(p_driver)) fail('That driver has not accepted the NDA yet.');
      o.status = 'assigned'; o.driver_id = p_driver; o.updated_at = iso();
      log(o, 'driver_assigned', { driver: p_driver });
      push(p_driver, o, hot ? 'Hot shot job assigned' : 'Job assigned', 'Job ' + o.ref + ' is yours.', hot);
      return { status: 'assigned' };
    },
    cc_claim_job({ p_order }) {
      req('owner', 'dispatcher', 'driver');
      if (!me().on_duty) fail('Go on duty to claim jobs.');
      const o = S.orders[p_order];
      if (!o || o.status !== 'dispatching') fail('Someone already claimed that job.');
      o.status = 'assigned'; o.driver_id = S.me; o.updated_at = iso();
      log(o, 'driver_assigned', { driver: S.me, claimed: true });
      pushDispatch(o, 'Job claimed', o.ref + ' has a driver.');
      return { status: 'assigned' };
    },
    cc_release_job({ p_order, p_reason }) {
      req('owner', 'dispatcher', 'driver');
      const o = S.orders[p_order];
      if (!o || o.driver_id !== S.me) fail('That job is not yours.');
      if (o.status !== 'assigned') fail('You already started this run. Call dispatch.');
      if (clean(p_reason).length < 3) fail('Say why you are giving this job back.');
      o.status = 'dispatching'; o.driver_id = null; o.updated_at = iso();
      log(o, 'driver_released', { reason: clean(p_reason) }, false);
      pushDispatch(o, 'Job given back', o.ref + ' needs a new driver.', o.urgency === 'hotshot');
      return { status: 'dispatching' };
    },
    cc_stop_update({ p_stop, p_action, p_received_by, p_note, p_lat, p_lng }) {
      const r = req('owner', 'dispatcher', 'driver');
      const o = Object.values(S.orders).find((x) => x.stops.some((s) => s.id === p_stop));
      if (!o) fail('Stop not found.');
      const s = o.stops.find((x) => x.id === p_stop);
      if (o.driver_id !== S.me && r === 'driver') fail('That job is not yours.');
      if (!['assigned', 'in_progress'].includes(o.status)) fail('This job is not running.');
      const nxt = o.stops.filter((x) => ['pending', 'arrived'].includes(x.status)).map((x) => x.seq).sort((a, b) => a - b)[0];
      if (s.seq !== nxt) fail('Finish the earlier stop first.');
      const who = clean(p_received_by);
      const here = p_lat == null || p_lng == null ? {} : { lat: p_lat, lng: p_lng };
      if (p_action === 'arrive') {
        if (s.status !== 'pending') fail('You already arrived here.');
        s.status = 'arrived'; s.arrived_at = iso();
        if (o.status === 'assigned') { o.status = 'in_progress'; o.updated_at = iso(); }
        log(o, 'arrived', Object.assign({ stop: s.seq, kind: s.kind }, here));
      } else if (p_action === 'done') {
        if (s.status !== 'arrived') fail('Mark that you arrived first.');
        if (s.kind === 'drop' && o.kind !== 'ride' && who.length < 2) fail('Get the name of the person who received it.');
        s.status = 'done'; s.done_at = iso(); s.received_by = who || null; s.note = clean(p_note) || null;
        log(o, s.kind === 'drop' ? 'delivered_stop' : s.kind === 'process' ? 'processed' : 'picked_up', Object.assign({ stop: s.seq, received_by: who || null }, here));
        if (!o.stops.some((x) => ['pending', 'arrived'].includes(x.status))) {
          o.status = 'delivered'; o.updated_at = iso();
          log(o, 'delivered', { received_by: who || null });
          pushOrg(o.org_id, o, 'Delivered', 'Job ' + o.ref + ' was delivered.');
          pushDispatch(o, 'Delivered', o.ref + ' was delivered and can be billed.');
        } else if (s.kind === 'pickup') pushOrg(o.org_id, o, 'Picked up', 'Job ' + o.ref + ' is on the road.');
      } else fail('Unknown stop action.');
      return { status: o.status };
    },
    cc_close_order({ p_order, p_invoice }) {
      req('owner', 'dispatcher');
      const o = getOrder(p_order);
      if (o.status !== 'delivered') fail('Only a delivered job can be closed.');
      o.status = 'closed'; o.invoice_ref = clean(p_invoice) || null; o.updated_at = iso();
      log(o, 'closed', { invoice: clean(p_invoice) });
      return { status: 'closed' };
    },
    cc_cancel_order({ p_order, p_reason }) {
      const r = req('owner', 'dispatcher', 'client', 'store');
      const o = S.orders[p_order];
      if (!o || (['client', 'store'].includes(r) && o.org_id !== myOrg())) fail('Order not found.');
      const why = clean(p_reason);
      if (why.length < 3) fail('Say why this is being cancelled.');
      if (['client', 'store'].includes(r) && !['requested', 'quoted', 'approved'].includes(o.status)) fail('A driver may already be on this. Message dispatch to cancel.');
      if (['delivered', 'closed', 'cancelled', 'declined', 'in_progress'].includes(o.status)) fail('This order can no longer be cancelled here.');
      o.quotes.forEach((q) => { if (q.status === 'sent') q.status = 'superseded'; });
      o.items.forEach((i) => { if (i.store_status === 'asked') { i.store_status = 'declined'; i.store_note = i.store_note || 'Job cancelled'; } });
      o.status = 'cancelled'; o.updated_at = iso();
      log(o, 'cancelled', { reason: why });
      pushDispatch(o, 'Order cancelled', o.ref + ' was cancelled.');
      pushOrg(o.org_id, o, 'Order cancelled', 'Job ' + o.ref + ' was cancelled.');
      if (o.driver_id) push(o.driver_id, o, 'Job cancelled', 'Job ' + o.ref + ' was cancelled.', true);
      return { status: 'cancelled' };
    },
    cc_store_requests() {
      req('store');
      const out = [];
      Object.values(S.orders).forEach((o) => o.items.filter((i) => i.store_org_id === myOrg()).forEach((i) => out.push({ id: i.id, ref: o.ref, description: i.description, part_no: i.part_no, qty: i.qty,
        need_by: o.need_by, urgency: o.urgency, store_status: i.store_status, store_price_cents: i.store_price_cents, store_note: i.store_note, created_at: o.created_at })));
      return out.sort((a, b) => (b.store_status === 'asked') - (a.store_status === 'asked') || (b.created_at > a.created_at ? 1 : -1));
    },
    cc_store_respond({ p_item, p_confirm, p_price_cents, p_note }) {
      req('store');
      const o = Object.values(S.orders).find((x) => x.items.some((i) => i.id === p_item));
      const i = o && o.items.find((x) => x.id === p_item);
      if (!i || i.store_org_id !== myOrg()) fail('Request not found.');
      if (i.store_status !== 'asked') fail('You already answered this request.');
      if (p_confirm && (p_price_cents === null || p_price_cents === undefined || p_price_cents < 0)) fail('Add your price.');
      i.store_status = p_confirm ? 'confirmed' : 'declined'; i.store_price_cents = p_confirm ? p_price_cents : null; i.store_note = clean(p_note) || null;
      log(o, p_confirm ? 'store_confirmed' : 'store_declined', { item: i.seq }, false);
      pushDispatch(o, 'Store answered', 'A store answered on ' + o.ref + '.');
      return { store_status: i.store_status };
    },
    cc_list_orders() {
      const r = req('owner', 'dispatcher', 'driver', 'client', 'store');
      const all = Object.values(S.orders).sort((a, b) => (b.created_at > a.created_at ? 1 : -1));
      const total = (o) => { const q = activeQuote(o); return q ? q.total_cents : null; };
      if (['owner', 'dispatcher'].includes(r)) {
        return clone(all.map((o) => ({ id: o.id, ref: o.ref, kind: o.kind, status: o.status, urgency: o.urgency, title: o.title, need_by: o.need_by, created_at: o.created_at,
          org_name: o.org_id && S.orgs[o.org_id] ? S.orgs[o.org_id].name : null, driver_name: o.driver_id ? user(o.driver_id).display_name : null, driver_id: o.driver_id, ride: o.ride,
          total_cents: total(o), stops: o.stops.length, stops_done: stopsDone(o), store_waiting: o.items.filter((i) => i.store_status === 'asked').length })));
      }
      if (r === 'driver') {
        const duty = me().on_duty;
        return clone(all.filter((o) => o.driver_id === S.me || (o.status === 'dispatching' && duty)).map((o) => ({ id: o.id, ref: o.ref, kind: o.kind, status: o.status, urgency: o.urgency,
          title: o.blind ? null : o.title, need_by: o.need_by, created_at: o.created_at, driver_id: o.driver_id, mine: o.driver_id === S.me, ride: o.ride, stops: o.stops.length, stops_done: stopsDone(o) })));
      }
      return clone(all.filter((o) => o.org_id === myOrg()).map((o) => ({ id: o.id, ref: o.ref, kind: o.kind, status: o.status, urgency: o.urgency, title: o.title, need_by: o.need_by, created_at: o.created_at, ride: o.ride,
        total_cents: total(o), stops: o.stops.length, stops_done: stopsDone(o) })));
    },
    cc_get_order({ p_order }) {
      const r = req('owner', 'dispatcher', 'driver', 'client', 'store');
      const o = getOrder(p_order);
      let side;
      if (['owner', 'dispatcher'].includes(r)) side = 'dispatch';
      else if (r === 'driver') {
        side = 'driver';
        if (!(o.driver_id === S.me || (o.status === 'dispatching' && me().on_duty))) fail('Order not found.');
      } else {
        side = 'client';
        if (o.org_id !== myOrg()) fail('Order not found.');
      }
      const isDriver = side === 'driver', show = !isDriver || !o.blind, disp = side === 'dispatch';
      const res = { id: o.id, ref: o.ref, kind: o.kind, status: o.status, urgency: o.urgency, blind: o.blind, title: show ? o.title : null, notes: show ? o.notes : null,
        need_by: o.need_by, created_at: o.created_at, updated_at: o.updated_at, invoice_ref: isDriver ? null : o.invoice_ref, side, ride: o.ride,
        stops: o.stops.map((s) => ({ id: s.id, seq: s.seq, kind: s.kind, place_name: s.place_name, address: s.address, supplier_slug: s.supplier_slug,
          contact: side === 'client' || disp || o.driver_id === S.me ? s.contact : null, instructions: s.instructions, lat: s.lat, lng: s.lng, status: s.status, arrived_at: s.arrived_at, done_at: s.done_at, received_by: s.received_by, note: s.note })),
        items: show ? o.items.map((i) => ({ id: i.id, action: i.action, supplier_name: i.supplier_name, supplier_slug: i.supplier_slug, description: i.description, part_no: i.part_no, qty: i.qty, store_status: i.store_status,
          store_name: disp && i.store_org_id ? S.orgs[i.store_org_id].name : null, store_price_cents: disp ? i.store_price_cents : null, store_note: disp ? i.store_note : null })) : [],
        cargo_hidden: !show, item_count: o.items.length, driver_name: !isDriver && o.driver_id ? user(o.driver_id).display_name : null,
        events: o.events.filter((e) => disp || (side === 'client' && e.client_visible) || (isDriver && o.driver_id === S.me)).map((e) => {
          const d = Object.assign({}, e.detail); if (!disp) delete d.driver; return { at: e.at, type: e.type, detail: d }; }),
        messages: o.messages.filter((m) => disp || (side === 'client' && !m.internal) || (isDriver && m.internal && o.driver_id === S.me)).map((m) => ({ id: m.id, body: m.body, internal: m.internal, sender_side: m.sender_side, mine: m.sender === S.me, at: m.at,
          sender_name: m.sender_side === 'internal' && side === 'client' ? 'Dispatch' : user(m.sender).display_name })),
        attachments: o.attachments.filter((a) => !isDriver || a.kind === 'proof' || !o.blind).map((a) => ({ id: a.id, kind: a.kind, path: a.path, name: a.name, stop_id: a.stop_id })) };
      if (!isDriver) {
        res.track_token = o.track_token;
        const q = o.quotes.filter((x) => x.status !== 'superseded').slice(-1)[0];
        res.quote = q ? { id: q.id, parts_cents: q.parts_cents, purchase_fee_cents: q.purchase_fee_cents, courier_cents: q.courier_cents, rush_cents: q.rush_cents, total_cents: q.total_cents, note: q.note, valid_until: q.valid_until, status: q.status } : null;
      }
      if (disp) { res.org_name = o.org_id && S.orgs[o.org_id] ? S.orgs[o.org_id].name : null; res.driver_id = o.driver_id; }
      return clone(res);
    },
    cc_post_message({ p_order, p_body, p_internal }) {
      const r = req('owner', 'dispatcher', 'driver', 'client', 'store');
      const o = getOrder(p_order), b = clean(p_body);
      let internal = !!p_internal;
      if (b.length < 1 || b.length > 2000) fail('Write a message of up to 2000 characters.');
      if (r === 'driver') { if (o.driver_id !== S.me) fail('Order not found.'); internal = true; }
      else if (['client', 'store'].includes(r)) { if (o.org_id !== myOrg()) fail('Order not found.'); internal = false; }
      o.messages.push({ id: S.msgId++, sender: S.me, sender_side: ['client', 'store'].includes(r) ? 'client' : 'internal', internal, body: b, at: iso() });
      if (['client', 'store', 'driver'].includes(r)) pushDispatch(o, 'New job message', 'New message on ' + o.ref + '.');
      else if (internal) { if (o.driver_id && o.driver_id !== S.me) push(o.driver_id, o, 'New job message', 'New message on ' + o.ref + '.'); }
      else pushOrg(o.org_id, o, 'New message', 'Dispatch sent a message on ' + o.ref + '.');
      return { ok: true };
    },
    cc_add_attachment({ p_order, p_path, p_name, p_kind, p_stop }) {
      const r = req('owner', 'dispatcher', 'driver', 'client', 'store');
      const o = getOrder(p_order);
      if (!['proof', 'drawing', 'po'].includes(p_kind)) fail('Unknown file type.');
      if (String(p_path).split('/')[0] !== String(p_order)) fail('That file path is not valid.');
      if (r === 'driver' && (o.driver_id !== S.me || p_kind !== 'proof')) fail('That job is not yours.');
      if (['client', 'store'].includes(r) && (o.org_id !== myOrg() || p_kind === 'proof')) fail('Order not found.');
      o.attachments.push({ id: S.fileId++, kind: p_kind, path: p_path, name: clean(p_name) || 'file', stop_id: p_stop || null });
      log(o, 'file_added', { kind: p_kind });
      return { ok: true };
    },
    cc_ping({ p_lat, p_lng, p_accuracy }) {
      req('owner', 'dispatcher', 'driver');
      if (!me().on_duty) return { stored: false };
      if (p_lat == null || p_lng == null || Math.abs(p_lat) > 90 || Math.abs(p_lng) > 180) fail('Bad position.');
      S.pos[S.me] = { lat: p_lat, lng: p_lng, accuracy_m: p_accuracy === undefined ? null : p_accuracy, at: iso() };
      return { stored: true };
    },
    cc_fleet() {
      req('owner', 'dispatcher');
      return clone(Object.values(S.users).filter((u) => INTERNAL.includes(u.role) && u.active).map((u) => {
        const p = S.pos[u.id] || {};
        return { id: u.id, name: u.display_name, role: u.role, on_duty: !!u.on_duty, vehicle: u.vehicle || null, nda_ok: ndaOk(u.id), lat: p.lat === undefined ? null : p.lat, lng: p.lng === undefined ? null : p.lng, accuracy_m: p.accuracy_m === undefined ? null : p.accuracy_m, at: p.at || null,
          jobs: Object.values(S.orders).filter((o) => o.driver_id === u.id && ['assigned', 'in_progress'].includes(o.status)).map((o) => o.ref) };
      }).sort((a, b) => (b.on_duty - a.on_duty) || a.name.localeCompare(b.name)));
    },
    cc_track({ p_order }) {
      const r = req('owner', 'dispatcher', 'client', 'store');
      const o = S.orders[p_order];
      if (!o || (['client', 'store'].includes(r) && o.org_id !== myOrg())) fail('Order not found.');
      if (o.status !== 'in_progress' || !o.driver_id) return { state: 'not_moving' };
      const others = Object.values(S.orders).filter((x) => x.driver_id === o.driver_id && x.status === 'in_progress' && x.id !== o.id).length;
      if (others > 0 && ['client', 'store'].includes(r)) return { state: 'hidden' };
      const p = S.pos[o.driver_id];
      if (!p || now() - Date.parse(p.at) > 600e3) return { state: 'no_signal' };
      return { state: 'live', lat: p.lat, lng: p.lng, accuracy_m: p.accuracy_m, at: p.at };
    },
    cc_alerts() {
      if (!S.me) fail('Sign in first.');
      return clone(S.alerts.filter((a) => a.user_id === S.me).slice(0, 40).map((a) => ({ id: a.id, order_id: a.order_id, title: a.title, body: a.body, urgent: a.urgent, read: a.read, at: a.at })));
    },
    cc_alerts_read() { S.alerts.forEach((a) => { if (a.user_id === S.me) a.read = true; }); return { ok: true }; },
    cc_admin_overview() {
      req('owner');
      return clone({
        members: Object.values(S.users).map((u) => ({ id: u.id, username: u.username, name: u.display_name, role: u.role, active: u.active, org_id: u.org_id || null, org_name: u.org_id ? S.orgs[u.org_id].name : null, on_duty: !!u.on_duty, nda_ok: ndaOk(u.id) })).sort((a, b) => a.name.localeCompare(b.name)),
        orgs: Object.values(S.orgs).map((o) => ({ id: o.id, name: o.name, kind: o.kind, supplier_slug: o.supplier_slug || null, contact_name: o.contact_name || null, phone: o.phone || null, email: o.email || null, address: o.address || null, active: o.active })).sort((a, b) => a.name.localeCompare(b.name)),
        requests: S.requests.filter((x) => !x.resolved),
      });
    },
    cc_admin_set_member({ p_user, p_role, p_org, p_active }) {
      req('owner');
      const u = user(p_user);
      if (!u) fail('That login was not found.');
      if (!['pending', 'owner', 'dispatcher', 'driver', 'client', 'store'].includes(p_role)) fail('Unknown role.');
      if (['client', 'store'].includes(p_role) && !p_org) fail('Customers and stores need a company.');
      if (u.role === 'owner' && (p_role !== 'owner' || !p_active) && !Object.values(S.users).some((x) => x.role === 'owner' && x.active && x.id !== p_user)) fail('Keep at least one owner.');
      u.role = p_role; u.org_id = ['client', 'store'].includes(p_role) ? p_org : null; u.active = !!p_active;
      if (!(INTERNAL.includes(p_role) && p_active)) u.on_duty = false;
      return { ok: true };
    },
    cc_admin_save_org({ p }) {
      req('owner');
      const nm = clean(p.name);
      if (!nm) fail('Give the company a name.');
      if (p.id && S.orgs[p.id]) { Object.assign(S.orgs[p.id], { name: nm, kind: p.kind || S.orgs[p.id].kind, supplier_slug: p.supplier_slug || null, contact_name: p.contact_name || null, phone: p.phone || null, email: p.email || null, address: p.address || null }); return { id: p.id }; }
      const o = { id: uid('org'), name: nm, kind: p.kind || 'client', supplier_slug: p.supplier_slug || null, contact_name: p.contact_name || null, phone: p.phone || null, email: p.email || null, address: p.address || null, active: true };
      S.orgs[o.id] = o;
      return { id: o.id };
    },
    cc_admin_resolve_request({ p_id, p_status }) {
      req('owner');
      if (!['approved', 'declined'].includes(p_status)) fail('Unknown status.');
      const r = S.requests.find((x) => x.id === p_id);
      if (r) r.resolved = p_status;
      return { ok: true };
    },
    cc_submit_ride({ p }) {
      const r = req('owner', 'dispatcher', 'client', 'store');
      let org = myOrg();
      if (['owner', 'dispatcher'].includes(r)) org = p.org_id || null;
      if (['client', 'store'].includes(r) && !org) fail('This login is not tied to a company yet.');
      rideCheck(p);
      const who = clean(p.passenger_name);
      if (who.length < 2 || who.length > 80) fail("Add the rider's name so the driver can find them.");
      if (String(p.passenger_phone || '').replace(/[^0-9]/g, '').length < 10) fail('Add a phone number the driver can call or text.');
      const to = p.direction === 'to_ind';
      const ride = { direction: p.direction, town: clean(p.town) || null, flight: clean(p.flight) || null, flight_at: p.flight_at || null, pickup_at: p.pickup_at || null,
        passengers: Number(p.passengers), bags: Number(p.bags || 0), passenger_name: who, passenger_phone: clean(p.passenger_phone), request_id: p.request_id || null };
      const o = { id: uid('order'), ref: 'PL-' + (++seq), kind: 'ride', status: 'requested', urgency: 'scheduled', org_id: org, created_by: S.me, driver_id: null,
        title: to ? 'Ride to IND' : 'Ride from IND', notes: clean(p.notes) || null, blind: p.blind !== false, need_by: to ? p.pickup_at : p.flight_at, invoice_ref: null, ride, track_token: token(),
        created_at: iso(), updated_at: iso(), events: [], messages: [], quotes: [], attachments: [], items: [],
        stops: rideStops(p).map((x, i) => Object.assign({ id: uid('stop'), seq: i + 1, supplier_slug: null, status: 'pending', arrived_at: null, done_at: null, received_by: null, note: null, contact: null, lat: null, lng: null, instructions: null }, x)) };
      S.orders[o.id] = o;
      if (['owner', 'dispatcher'].includes(r) && p.request_id) { const q = S.rides.find((x) => x.id === p.request_id); if (q) q.status = 'booked'; }
      log(o, 'order_placed', { ride: p.direction, passengers: ride.passengers });
      pushDispatch(o, 'New airport ride', o.ref + ' needs a quote.');
      return { id: o.id, ref: o.ref, kind: 'ride' };
    },
    cc_request_ride({ p }) {
      const nm = clean(p.name), ph = clean(p.phone);
      if (nm.length < 2 || nm.length > 80) fail('Add your name.');
      if (ph.replace(/[^0-9]/g, '').length < 10) fail('Add a phone number we can call or text.');
      rideCheck(p);
      S.rides.unshift({ id: S.rides.length + 1, name: nm, phone: ph, email: clean(p.email) || null, direction: p.direction, town: clean(p.town) || null, address: clean(p.address),
        flight: clean(p.flight) || null, flight_at: p.flight_at || null, pickup_at: p.pickup_at || null, passengers: Number(p.passengers), bags: Number(p.bags || 0), notes: clean(p.notes) || null, at: iso(), status: 'new' });
      Object.values(S.users).filter((u) => ['owner', 'dispatcher'].includes(u.role) && u.active).forEach((u) => push(u.id, null, 'Airport ride request', 'Someone asked for a ride. Open Admin to quote it.'));
      return { ok: true };
    },
    cc_public_track({ p_token }) {
      const o = Object.values(S.orders).find((x) => x.track_token === p_token);
      if (!p_token || String(p_token).length !== 64 || !o) fail('That tracking link is not valid.');
      let live = null;
      if (o.status === 'in_progress' && o.driver_id && !Object.values(S.orders).some((x) => x.driver_id === o.driver_id && x.status === 'in_progress' && x.id !== o.id)) {
        const p = S.pos[o.driver_id];
        if (p && now() - Date.parse(p.at) <= 600e3) live = { lat: p.lat, lng: p.lng, at: p.at };
      }
      return clone({ ref: o.ref, kind: o.kind, status: o.status, need_by: o.need_by, direction: o.ride ? o.ride.direction : null,
        driver: ['assigned', 'in_progress', 'delivered'].includes(o.status) && o.driver_id ? user(o.driver_id).display_name.split(' ')[0] : null, live,
        stops: o.stops.map((x) => ({ seq: x.seq, kind: x.kind, place_name: o.kind === 'ride' && x.place_name.startsWith('Indianapolis International') ? x.place_name : null, status: x.status, done_at: x.done_at })) });
    },
    cc_ride_requests_open() {
      req('owner', 'dispatcher');
      return clone(S.rides.filter((x) => x.status === 'new').map((x) => { const y = Object.assign({}, x); delete y.status; return y; }));
    },
    cc_admin_resolve_ride({ p_id, p_status }) {
      req('owner', 'dispatcher');
      if (!['booked', 'declined'].includes(p_status)) fail('Unknown status.');
      const x = S.rides.find((r) => r.id === p_id); if (x) x.status = p_status;
      return { ok: true };
    },
  };

  // Test and setup helpers, not part of the SQL surface.
  const api = {
    rpc(name, args) { if (!fn[name]) fail('Unknown call: ' + name); return clone(fn[name](clone(args || {}))); },
    reset() { const l = S.listeners; S = makeState(); S.listeners = l; seq = 1000; idn = 1; },
    addUser(username, display_name, r, org_id, signed) {
      const id = uid('user');
      S.users[id] = { id, username, display_name, role: r, org_id: org_id || null, active: true, on_duty: false, vehicle: null };
      if (signed) S.nda[id] = { name: display_name, at: iso() };
      return id;
    },
    addOrg(name, kind) { const o = { id: uid('org'), name, kind, active: true }; S.orgs[o.id] = o; return o.id; },
    as(id) { S.me = id; },
    who() { return S.me; },
    onAlert(f) { S.listeners.push(f); },
    file(path, url) { if (url) S.files[path] = url; return S.files[path]; },
    state() { return S; },
    seed() {
      api.reset();
      const client = api.addOrg('Sample Bracket Co. (sample)', 'client');
      const store = api.addOrg('Sample Parts Counter (sample)', 'store');
      const store2 = api.addOrg('Sample Supply North (sample)', 'store');
      const ids = {
        owner: api.addUser('demo-owner', 'Dana Dispatch', 'owner', null, true),
        driver: api.addUser('demo-driver', 'Drew Driver', 'driver', null, true),
        driver2: api.addUser('demo-driver2', 'Riley Driver', 'driver', null, true),
        client: api.addUser('demo-client', 'Casey Buyer', 'client', client, false),
        store: api.addUser('demo-store', 'Sam Counter', 'store', store, true),
        store2: api.addUser('demo-store2', 'Lee Counter', 'store', store2, true),
      };
      const sampleStops = (a, b) => [{ kind: 'pickup', place_name: a, address: '100 Sample St, Columbus, IN', instructions: 'Ask for the job number.', lat: 39.2014, lng: -85.9214 }, { kind: 'drop', place_name: b, address: '200 Example Ave, Columbus, IN', contact: 'Receiving', lat: 39.2243, lng: -85.8889 }];
      const placed = (urg, title, stops, items, blind) => { api.as(ids.client); return fn.cc_submit_order({ p: { urgency: urg, title, blind: blind !== false, no_prohibited: true, stops, items } }); };
      S.nda[ids.client] = { name: 'Casey Buyer', at: iso() };
      const a = placed('hotshot', 'Line down fitting', sampleStops('Sample Hose Shop', 'Sample Bracket Co. dock 2'), [{ action: 'buy', description: 'Hydraulic fitting, 3/4 inch', part_no: 'SAMPLE-34', qty: 6, supplier_name: 'Sample Hose Shop' }]);
      const b = placed('same_day', 'Prototype brackets for anodize', [
        { kind: 'pickup', place_name: 'Sample Machine Works', address: '300 Sample St, Columbus, IN', instructions: 'Crate is tagged with the job number.', lat: 39.1951, lng: -85.8913 },
        { kind: 'process', place_name: 'Sample Finisher', address: 'US 31, Edinburgh, IN', instructions: 'Type II clear. Wait for the traveler stamp.', lat: 39.3522, lng: -85.9672 },
        { kind: 'drop', place_name: 'Sample Bracket Co. dock 2', address: '200 Example Ave, Columbus, IN', contact: 'Receiving', lat: 39.2243, lng: -85.8889 },
      ], [{ action: 'pickup', description: 'Prototype bracket, rev C', part_no: 'SAMPLE-C', qty: 40, supplier_name: 'Sample Machine Works' }, { action: 'process', description: 'Anodize, Type II clear', qty: 40, supplier_name: 'Sample Finisher' }]);
      const c = placed('next_day', 'Monthly fasteners', sampleStops('Sample Fastener Counter', 'Sample Bracket Co. dock 2'), [{ action: 'buy', description: 'M8 x 25 flange bolts, box of 100', qty: 4, supplier_name: 'Sample Fastener Counter' }]);
      api.as(ids.owner);
      fn.cc_send_quote({ p_order: b.id, p_parts: 0, p_fee: 0, p_courier: 14000, p_rush: 0, p_note: 'Round trip with a wait at the finisher.', p_valid_hours: 24 });
      fn.cc_send_quote({ p_order: c.id, p_parts: 7600, p_fee: 1500, p_courier: 4500, p_rush: 0, p_note: '', p_valid_hours: 48 });
      api.as(ids.client); fn.cc_respond_quote({ p_order: c.id, p_accept: true, p_note: '' });
      const tomorrow = (h) => { const d = new Date(now() + 864e5); d.setHours(h, 0, 0, 0); return d.toISOString(); };
      S.me = null; fn.cc_request_ride({ p: { name: 'Sample Traveler', phone: '(812) 555-0142', direction: 'to_ind', town: 'Seymour', address: '300 Sample Ave, Seymour, IN', pickup_at: tomorrow(5), flight: 'Sample Air 410', passengers: 2, bags: 3 } });
      api.as(ids.client); fn.cc_submit_ride({ p: { direction: 'from_ind', town: 'Columbus', place_name: 'Sample Bracket Co. guest house', address: '200 Example Ave, Columbus, IN', flight: 'Sample Air 88', flight_at: tomorrow(16), passengers: 1, bags: 2, passenger_name: 'Visiting engineer (sample)', passenger_phone: '(812) 555-0177' } });
      api.as(ids.driver); fn.cc_set_duty({ p_on: true, p_vehicle: 'White cargo van' }); fn.cc_ping({ p_lat: 39.2014, p_lng: -85.9214, p_accuracy: 12 });
      api.as(ids.driver2); fn.cc_set_duty({ p_on: true, p_vehicle: 'Pickup' }); fn.cc_ping({ p_lat: 39.2596, p_lng: -85.9090, p_accuracy: 20 });
      api.as(null);
      S.alerts.length = 0;
      S.nda[ids.client] = undefined; delete S.nda[ids.client];
      S.demoIds = ids; S.demoOrders = { a: a.id, b: b.id, c: c.id };
      return ids;
    },
  };
  root.CC_DEMO = api;
})(typeof window !== 'undefined' ? window : globalThis);
