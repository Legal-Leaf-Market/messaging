/* Private Line Courier: one page, four experiences.
   Senders, receivers and stores get the portal. Dispatch gets the board. Drivers get big buttons.
   Everything reads through the cc_ database functions, which decide what each role may see. */
(function () {
  'use strict';

  /* ===== SETTINGS ===== */
  const SUPABASE_URL = 'https://xppyedslhbrnqnymaaxb.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_m_BQ-HC1v3-JANssdXJRlA_9TphYPCM'; // meant to be public, the database rules protect the data
  const LOGIN_DOMAIN = 'crossroadsweddingco.shop';
  const BRAND = 'Private Line Courier'; // working name, one place to change it
  const CONTACT_PHONE = '(812) 671-1780';
  const CONTACT_EMAIL = 'jake@crossroadsweddingco.shop';
  const GOOGLE_TILES_KEY = '';          // optional: a Google Map Tiles key turns on Google satellite imagery
  const NO_CARRY = 'Hazmat and gas cylinders, firearms and ammunition, cannabis or THC products, cash and valuables, live animals, or anything illegal to ship.';
  // Rate card from the Lead Playbook: $35 local counter run, $35 + $1.85 a mile dedicated hot shot,
  // $50 a stop on a shared scheduled corridor run. Dispatch always sets the real quote.
  const RATES = { counter: 3500, base: 3500, perMile: 185, localMiles: 8, sharedStop: 5000, feePct: 0.15, feeMin: 1500 };
  // Airport rides: rough road miles to IND by town, and a starting rate card. Dispatch sets the real quote.
  const AIRPORT_TOWNS = { Greenwood: 22, Whiteland: 25, Franklin: 30, Shelbyville: 40, Edinburgh: 42, Taylorsville: 48, Bloomington: 50, Columbus: 55, Nashville: 55,
    Hope: 65, Greensburg: 65, Seymour: 75, 'North Vernon': 75, Batesville: 80, Brownstown: 85, Scottsburg: 90, Madison: 95 };
  const RIDE_RATES = { near: 6500, mid: 9500, far: 12500, long: 16500, extraRider: 1000, includedRiders: 3, lateNight: 2000 };
  const MAX_RIDERS = 7; // the Indiana authority class of 8 or fewer, counting the driver
  /* ==================== */

  const DATA = window.CC_DATA;
  const qs = new URLSearchParams(location.search);
  const DEMO = qs.has('demo') || window.CC_FORCE_DEMO === true;
  const root = document.getElementById('root');

  /* ---------- small helpers ---------- */
  function h(tag, attrs) {
    const el = document.createElement(tag);
    for (const k of Object.keys(attrs || {})) {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'required') el[k] = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (let i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, kid) {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) kid.forEach((x) => add(el, x));
    else el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  const money = (c) => (c === null || c === undefined ? '' : '$' + (Number(c) / 100).toFixed(2));
  const cents = (s) => { const n = parseFloat(String(s).replace(/[^0-9.]/g, '')); return isNaN(n) ? 0 : Math.round(n * 100); };
  const when = (t) => (t ? new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
  const safeUrl = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : null; } catch (e) { return null; } };
  const tel = (p) => 'tel:' + String(p).replace(/[^0-9+]/g, '');
  const mapsUrl = (s) => 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(s.lat != null && !s.address ? s.lat + ',' + s.lng : s.address || s.place_name);
  function toast(text, hot) {
    document.querySelectorAll('.toast').forEach((t) => t.remove());
    const t = h('div', { class: 'toast' + (hot ? ' hot' : ''), role: 'status' }, text);
    document.body.append(t);
    setTimeout(() => t.remove(), 4500);
  }
  function modal(title, build, onClose) {
    const close = () => { scrim.remove(); document.removeEventListener('keydown', esc); if (onClose) onClose(); };
    const esc = (e) => { if (e.key === 'Escape') close(); };
    const box = h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('h2', null, title));
    add(box, build(close));
    const scrim = h('div', { class: 'scrim', onclick: (e) => { if (e.target === scrim) close(); } }, box);
    document.body.append(scrim);
    document.addEventListener('keydown', esc);
    const first = box.querySelector('input,select,textarea,button');
    if (first) first.focus();
    return close;
  }
  // A button that runs an action, shows the error next to it, and refreshes on success.
  function act(label, fn, cls) {
    const err = h('div', { class: 'err' });
    const btn = h('button', { type: 'button', class: cls || '', onclick: async () => {
      err.textContent = ''; btn.disabled = true;
      try { await fn(); } catch (e) { err.textContent = e.message; }
      btn.disabled = false;
    } }, label);
    return h('div', { class: 'stack', style: 'gap:4px' }, btn, err);
  }

  /* ---------- backend ---------- */
  const backend = DEMO ? demoBackend() : realBackend();
  function realBackend() {
    if (typeof supabase === 'undefined') { root.append(h('div', { class: 'gate' }, h('div', { class: 'card' }, 'The app could not load. Check your connection and reload.'))); throw new Error('supabase-js failed to load'); }
    const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return {
      async rpc(name, args) {
        const { data, error } = await sb.rpc(name, args || {});
        if (error) throw new Error(/function .* does not exist|schema cache/i.test(error.message) ? 'The courier database is not set up yet. Run setup-courier.sql.' : error.message);
        return data;
      },
      async signIn(u, p) {
        const email = u.includes('@') ? u : u + '@' + LOGIN_DOMAIN;
        const { error } = await sb.auth.signInWithPassword({ email, password: p });
        if (error) throw new Error(error.status === 400 ? 'Wrong username or password.' : 'Could not reach the server. Check your connection and try again.');
      },
      async signOut() { await sb.auth.signOut(); },
      async session() { const { data } = await sb.auth.getSession(); return !!data.session; },
      async upload(orderId, file) {
        const safe = String(file.name || 'file').replace(/[^a-zA-Z0-9._]/g, '_').slice(-80);
        const path = orderId + '/' + Date.now() + '_' + safe;
        const { error } = await sb.storage.from('cc-files').upload(path, file);
        if (error) throw new Error('That file did not upload: ' + error.message);
        return path;
      },
      async fileUrl(path) {
        const { data, error } = await sb.storage.from('cc-files').createSignedUrl(path, 600);
        if (error) throw new Error('You do not have access to that file.');
        return data.signedUrl;
      },
      async createLogin(body) {
        const { data, error } = await sb.functions.invoke('courier-admin', { body });
        if (error) throw new Error('Could not create the login. Is the courier-admin function deployed?');
        if (data && data.error) throw new Error(data.error);
        return data;
      },
      listen(userId, cb) {
        sb.channel('cc-alerts').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'cc_notifications', filter: 'user_id=eq.' + userId }, (p) => cb(p.new)).subscribe();
      },
      async enablePush() {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('This browser cannot get alerts. On iPhone, add the app to your Home Screen first.');
        const reg = await navigator.serviceWorker.register('/messaging/sw.js', { scope: '/messaging/' });
        if ((await Notification.requestPermission()) !== 'granted') throw new Error('Alerts are blocked in this browser’s settings.');
        const { publicKey } = await fetch(SUPABASE_URL + '/functions/v1/push', { headers: { apikey: SUPABASE_ANON_KEY } }).then((r) => r.json());
        const b = publicKey.replace(/-/g, '+').replace(/_/g, '/');
        const key = Uint8Array.from(atob(b + '='.repeat((4 - (b.length % 4)) % 4)), (c) => c.charCodeAt(0));
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        const j = sub.toJSON();
        const { error } = await sb.rpc('save_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
        if (error) throw new Error(error.message);
      },
    };
  }
  function demoBackend() {
    const d = window.CC_DEMO;
    const ids = d.seed();
    return {
      demo: true, ids,
      async rpc(name, args) { return d.rpc(name, args); },
      async signIn() {}, async signOut() { d.as(null); },
      async session() { return !!d.who(); },
      async upload(orderId, file) { const path = orderId + '/' + Date.now() + '_' + (file.name || 'file'); d.file(path, URL.createObjectURL(file)); return path; },
      async fileUrl(path) { const u = d.file(path); if (!u) throw new Error('Sample file, nothing to open.'); return u; },
      async createLogin(b) { const id = d.addUser(b.username, b.display_name || b.username, b.role, b.org_id, false); return { id }; },
      listen(userId, cb) { d.onAlert((a) => { if (a.user_id === d.who()) cb(a); }); },
      async enablePush() { toast('Demo only: a real phone gets a push alert here.'); },
      as(id) { d.as(id); },
    };
  }

  /* ---------- state ---------- */
  let me = null, alertsUnread = 0, stores = [], lastPos = null, gpsWatch = null, simTimer = null, lastPing = 0, wakeLock = null, pollTimer = null;
  const INTERNAL = ['owner', 'dispatcher', 'driver'];
  const isInternal = () => me && INTERNAL.includes(me.role);
  const isDispatch = () => me && ['owner', 'dispatcher'].includes(me.role);
  let draft = newDraft();
  function newDraft() { return { urgency: 'same_day', blind: true, title: '', notes: '', need_by: '', stops: [], drop: { place_name: '', address: '', contact: '', instructions: '' }, ok: false, org_id: '' }; }

  const STATUS = {
    requested: ['Waiting for a quote', 'act'], quoted: ['Quote sent', 'act'], approved: ['Approved', 'act'], declined: ['Declined', 'off'],
    dispatching: ['Finding a driver', 'act'], assigned: ['Driver assigned', ''], in_progress: ['On the road', 'hot'], delivered: ['Delivered', 'ok'], closed: ['Closed', 'off'], cancelled: ['Cancelled', 'off'],
  };
  const clientStatus = (s) => (s === 'quoted' ? 'Your quote is ready' : s === 'approved' ? 'Approved, finding a driver' : (STATUS[s] || [s])[0]);
  const URGENCY = { hotshot: ['Hot shot', 'Right now'], same_day: ['Same day', 'Today'], next_day: ['Next day', 'Tomorrow'], scheduled: ['Scheduled', 'Pick a time'] };
  const KIND = { courier: 'Courier run', purchase: 'Purchasing run', process: 'Outside processing', transfer: 'Store transfer', ride: 'Airport ride' };
  const STOPK = { pickup: 'Pick up', process: 'Process', drop: 'Deliver' };
  const ACTION = { buy: 'Buy', pickup: 'Pick up', process: 'Process' };
  const EVENT = {
    order_placed: 'Order placed', quote_sent: 'Quote sent', quote_accepted: 'Quote accepted', quote_declined: 'Quote declined', offered_to_drivers: 'Offered to drivers',
    driver_assigned: 'Driver assigned', driver_released: 'Driver gave the job back', arrived: 'Driver arrived', picked_up: 'Picked up', processed: 'Left at processing',
    delivered_stop: 'Dropped off', delivered: 'Delivered', closed: 'Closed', cancelled: 'Cancelled', file_added: 'File added', store_confirmed: 'Store confirmed stock', store_declined: 'Store declined',
  };
  const statusTag = (o) => { const s = STATUS[o.status] || [o.status, '']; return h('span', { class: 'status ' + s[1] }, me.role === 'client' || me.role === 'store' ? clientStatus(o.status) : s[0]); };
  const hotTag = (o) => (o.urgency === 'hotshot' ? h('span', { class: 'status hot' }, 'Hot shot') : null);

  /* ---------- start ---------- */
  async function boot() {
    if (qs.get('t') && !DEMO) return gateTrack(qs.get('t'));
    if (DEMO) return gateDemo();
    if (await backend.session()) return enter();
    if (qs.has('new')) return gateRequest(); // the pamphlet's QR code lands here
    if (qs.has('ride')) return gateRide();
    gateLogin();
  }
  async function enter() {
    try { me = await backend.rpc('cc_me'); } catch (e) { root.replaceChildren(gateCard([h('p', null, e.message), h('button', { onclick: signOut }, 'Sign out')])); return; }
    document.documentElement.classList.toggle('internal', isInternal());
    if (me.role === 'pending') return gatePending();
    if (!me.nda_ok) return gateNda();
    try { stores = await backend.rpc('cc_list_stores'); } catch (e) { stores = []; }
    await loadAlerts();
    if (!enter.listening) { enter.listening = true; backend.listen(me.id, onAlert); }
    startGps();
    window.onhashchange = render;
    clearInterval(pollTimer); pollTimer = setInterval(softRefresh, 30000);
    if (!location.hash || location.hash === '#/') location.hash = home();
    const o = qs.get('order') || qs.get('o'); // push alerts and box tags open a job directly
    if (o) location.hash = '#/job/' + o;
    render();
  }
  const home = () => (isDispatch() ? '#/board' : me.role === 'driver' ? '#/driver' : '#/jobs');
  async function signOut() { stopGps(); await backend.signOut(); location.hash = ''; if (DEMO) { me = null; root.replaceChildren(); gateDemo(); } else location.reload(); }
  async function loadAlerts() { try { alertsUnread = (await backend.rpc('cc_alerts')).filter((a) => !a.read).length; } catch (e) { alertsUnread = 0; } }
  async function onAlert(a) {
    alertsUnread++;
    toast(a.title + '. ' + a.body, a.urgent);
    if (a.urgent && navigator.vibrate) navigator.vibrate([300, 150, 300]);
    softRefresh(true);
  }
  function softRefresh(force) {
    if (paused) return;
    const el = document.activeElement;
    if (document.querySelector('.scrim')) return;
    if (!force && el && /INPUT|TEXTAREA|SELECT/.test(el.tagName)) return;
    const r = route();
    if (['jobs', 'board', 'driver', 'alerts', 'requests', 'map', 'job'].includes(r.name) && !(el && /INPUT|TEXTAREA|SELECT/.test(el.tagName))) render();
    else drawTop();
  }

  /* ---------- gates: sign in, demo, pending, NDA ---------- */
  const gateCard = (kids, wide) => h('div', { class: 'gate' + (wide ? ' wide' : '') }, h('div', { class: 'card' }, kids));
  function gateLogin() {
    const err = h('div', { class: 'err' });
    const u = h('input', { placeholder: 'Username', autocomplete: 'username', autocapitalize: 'none', required: true, 'aria-label': 'Username' });
    const p = h('input', { type: 'password', placeholder: 'Password', autocomplete: 'current-password', required: true, 'aria-label': 'Password' });
    const btn = h('button', { class: 'primary', type: 'submit' }, 'Sign in');
    root.replaceChildren(gateCard([
      h('h1', null, 'Parts move. Nobody talks.'),
      h('p', { class: 'muted' }, BRAND + ': hot shot courier and parts buying under NDA, for shops and plants around Columbus, Indiana.'),
      h('form', { class: 'stack', onsubmit: async (e) => {
        e.preventDefault(); err.textContent = ''; btn.disabled = true;
        try { await backend.signIn(u.value.trim().toLowerCase(), p.value); await enter(); } catch (x) { err.textContent = x.message; }
        btn.disabled = false;
      } }, u, p, btn, err),
      h('button', { class: 'link', type: 'button', onclick: gateRequest }, 'New here? Request an account'),
      h('button', { class: 'link', type: 'button', onclick: gateRide }, 'Need a ride to or from the Indianapolis airport?'),
      h('p', { class: 'small muted' }, 'Need it moving now? Call ', h('a', { href: tel(CONTACT_PHONE) }, CONTACT_PHONE), '.'),
    ]));
  }
  // Anyone can ask for an airport ride. Dispatch calls back with a price and books it.
  function gateRide() {
    const st = { direction: 'to_ind', passengers: 1, bags: 1 };
    const f = rideFields(st, true);
    const err = h('div', { class: 'err' });
    root.replaceChildren(gateCard([
      h('h2', null, 'Ride to or from the Indianapolis airport'),
      h('p', { class: 'muted small' }, 'Door to door between south central Indiana and IND. Send this and we will call or text you with a price before anything is booked.'),
      f.node, err,
      h('button', { class: 'primary big', type: 'button', onclick: async () => {
        err.textContent = '';
        try {
          await backend.rpc('cc_request_ride', { p: f.collect() });
          root.replaceChildren(gateCard([h('h2', null, 'Request sent'), h('p', null, 'We will call or text you with a price. Nothing is booked until you say yes.'),
            h('p', { class: 'small muted' }, 'Questions? Call ', h('a', { href: tel(CONTACT_PHONE) }, CONTACT_PHONE), '.'), h('button', { onclick: DEMO ? gateDemo : gateLogin }, 'Done')]));
        } catch (e) { err.textContent = e.message; }
      } }, 'Ask for a price'),
      h('button', { class: 'link', type: 'button', onclick: DEMO ? gateDemo : gateLogin }, 'Back'),
    ], true));
  }
  function gateRequest() {
    const v = {};
    const field = (k, label, attrs) => h('label', { class: 'f' }, label, (v[k] = h('input', attrs || {})));
    const kind = h('select', null, h('option', { value: 'client' }, 'Send or receive parts'), h('option', { value: 'store' }, 'A store or shop that supplies parts'), h('option', { value: 'driver' }, 'Drive for you'));
    const note = h('textarea', { placeholder: 'What do you move, and how often?' });
    const err = h('div', { class: 'err' });
    root.replaceChildren(gateCard([
      h('h2', null, 'Request an account'),
      h('p', { class: 'muted small' }, 'We set up every account by hand, and you sign the NDA before your first run. In a hurry? Call or text ', h('a', { href: tel(CONTACT_PHONE) }, CONTACT_PHONE), ' or email ', h('a', { href: 'mailto:' + CONTACT_EMAIL }, CONTACT_EMAIL), '.'),
      field('company', 'Company'), field('contact', 'Your name', { autocomplete: 'name' }), field('email', 'Email', { type: 'email', autocomplete: 'email' }), field('phone', 'Phone', { type: 'tel', autocomplete: 'tel' }),
      h('label', { class: 'f' }, 'What do you need?', kind), h('label', { class: 'f' }, 'Anything else', note),
      h('button', { class: 'primary', type: 'button', onclick: async () => {
        err.textContent = '';
        try {
          await backend.rpc('cc_request_access', { p_company: v.company.value, p_contact: v.contact.value, p_email: v.email.value, p_phone: v.phone.value, p_kind: kind.value, p_note: note.value });
          root.replaceChildren(gateCard([h('h2', null, 'Request sent'), h('p', null, 'We will call or email you to set up your login.'), h('button', { onclick: DEMO ? gateDemo : gateLogin }, 'Back to sign in')]));
        } catch (e) { err.textContent = e.message; }
      } }, 'Send request'), err,
      h('button', { class: 'link', type: 'button', onclick: DEMO ? gateDemo : gateLogin }, 'Back to sign in'),
    ]));
  }
  function gateDemo() {
    const pick = (id, title, sub) => h('button', { type: 'button', onclick: async () => { backend.as(id); enter.listening = false; await enter(); } }, title, h('small', null, sub));
    const i = backend.ids;
    root.replaceChildren(gateCard([
      h('h1', null, 'Parts move. Nobody talks.'),
      h('p', { class: 'muted' }, 'This is a working demo with sample companies and no real orders. Pick who to be. You can switch at any time and follow one job from every side.'),
      h('div', { class: 'demo-pick' },
        pick(i.client, 'Customer', 'Build a run from the supplier list, approve the quote, track it'),
        pick(i.owner, 'Dispatch and owner', 'Quote jobs, send them to drivers, see the fleet map, manage logins'),
        pick(i.driver, 'Driver', 'Go on duty, claim jobs, log each stop'),
        pick(i.store, 'Store', 'Answer stock requests from other stores')),
      h('button', { class: 'link', type: 'button', onclick: gateRequest }, 'See the account request form'),
      h('button', { class: 'link', type: 'button', onclick: gateRide }, 'See the public airport ride form'),
    ]));
  }
  // The page behind a shared tracking link. No login: the 64-character link is the key.
  let trackTimer = null, paused = false;
  async function gateTrack(token, back) {
    clearInterval(trackTimer);
    paused = !!back; // a preview inside the app: hold the app's own refresh until Back
    const body = h('div', { class: 'stack' });
    const mapEl = h('div', { class: 'map', 'data-map': '1' });
    const card = gateCard([h('h2', null, BRAND), body, mapEl, h('p', { class: 'small muted' }, 'This page updates every 30 seconds. Questions? Call ', h('a', { href: tel(CONTACT_PHONE) }, CONTACT_PHONE), '.'),
      back ? h('button', { class: 'link', type: 'button', onclick: () => { clearInterval(trackTimer); paused = false; back(); } }, 'Back to the job') : null], true);
    root.replaceChildren(card);
    const PUBLIC = { requested: 'Being priced', quoted: 'Waiting on approval', approved: 'Booked', dispatching: 'Finding a driver', assigned: 'Driver assigned', in_progress: 'On the way', delivered: 'Done', closed: 'Done', cancelled: 'Cancelled', declined: 'Cancelled' };
    async function draw() {
      try {
        const t = await backend.rpc('cc_public_track', { p_token: token });
        body.replaceChildren(
          h('div', { class: 'traveler' }, h('h2', null, 'Job ' + t.ref), h('p', null, h('span', { class: 'status' }, PUBLIC[t.status] || t.status)), t.driver ? h('p', null, 'Your driver: ' + t.driver) : null,
            t.need_by ? h('p', null, (t.kind === 'ride' ? (t.direction === 'from_ind' ? 'Flight lands ' : 'Pickup ') : 'Need by ') + when(t.need_by)) : null),
          h('div', { class: 'route' }, t.stops.map((x) => h('div', { class: 'stop ' + (x.status === 'done' ? 'done' : x.status === 'arrived' ? 'arrived' : '') },
            h('div', { class: 'rail' }, h('div', { class: 'dot' }), h('div', { class: 'bar' })),
            h('div', { class: 'body' }, h('div', { class: 'where' }, (t.kind === 'ride' ? (x.kind === 'pickup' ? 'Pickup' : 'Drop-off') : 'Stop ' + x.seq + ': ' + STOPK[x.kind]) + (x.place_name ? ', ' + x.place_name : '')),
              h('div', { class: 'line muted' }, x.status === 'done' ? 'Done ' + when(x.done_at) : x.status === 'arrived' ? 'Driver is there now' : 'Not yet')))))) ;
        if (t.live) { mapEl.classList.remove('hidden'); await drawMap(mapEl, { drivers: [{ name: t.driver || 'Driver', lat: t.live.lat, lng: t.live.lng }] }); }
        else mapEl.classList.add('hidden');
      } catch (e) { body.replaceChildren(h('p', { class: 'err' }, e.message)); mapEl.classList.add('hidden'); clearInterval(trackTimer); }
    }
    await draw();
    trackTimer = setInterval(draw, 30000);
  }
  function gatePending() {
    root.replaceChildren(gateCard([h('h2', null, 'Your login is waiting for approval'), h('p', null, 'We will let you know when it is ready.'), h('button', { onclick: signOut }, 'Sign out')]));
  }
  async function gateNda() {
    const nda = await backend.rpc('cc_current_nda');
    const name = h('input', { autocomplete: 'name', 'aria-label': 'Full legal name' });
    const title = h('input', { autocomplete: 'organization-title', 'aria-label': 'Title' });
    const company = h('input', { value: me.org ? me.org.name : '', autocomplete: 'organization', 'aria-label': 'Company' });
    const agree = h('input', { type: 'checkbox' });
    const err = h('div', { class: 'err' });
    root.replaceChildren(gateCard([
      demoBar(),
      h('h2', null, 'Sign the NDA to continue'),
      h('p', { class: 'small muted' }, 'Everyone signs this once, customers, stores and drivers alike. It goes both ways: we protect your information and you protect ours.'),
      h('div', { class: 'nda-text', tabindex: '0' }, nda.body.trim()),
      h('div', { class: 'grid2' }, h('label', { class: 'f' }, 'Full legal name', name), h('label', { class: 'f' }, 'Title', title)),
      h('label', { class: 'f' }, 'Company', company),
      h('label', { class: 'c' }, agree, h('span', null, 'I read this agreement and I am authorized to accept it. Typing my name is my electronic signature.')),
      h('button', { class: 'primary', type: 'button', onclick: async () => {
        err.textContent = '';
        if (!agree.checked) { err.textContent = 'Check the box to accept.'; return; }
        try {
          await backend.rpc('cc_accept_nda', { p_version: nda.version, p_typed_name: name.value, p_title: title.value, p_company: company.value, p_user_agent: navigator.userAgent.slice(0, 300) });
          await enter();
        } catch (e) { err.textContent = e.message; }
      } }, 'Sign and continue'), err,
      h('button', { class: 'link', type: 'button', onclick: signOut }, 'Sign out'),
    ], true));
  }

  /* ---------- shell ---------- */
  function demoBar() {
    if (!DEMO) return null;
    const i = backend.ids;
    const sel = h('select', { 'aria-label': 'Switch who you are', onchange: async () => { backend.as(sel.value); location.hash = ''; enter.listening = false; await enter(); } },
      [[i.client, 'Customer'], [i.owner, 'Dispatch and owner'], [i.driver, 'Driver'], [i.driver2, 'Second driver'], [i.store, 'Store']].map(([id, label]) => h('option', { value: id, selected: me && me.id === id }, label)));
    return h('div', { class: 'demo-bar' }, h('span', null, 'Demo with sample data. Viewing as'), sel);
  }
  function tabsFor() {
    if (me.role === 'driver') return [['#/driver', 'Jobs', 'driver'], ['#/alerts', 'Alerts', 'alerts']];
    if (isDispatch()) return [['#/board', 'Board', 'board'], ['#/map', 'Map', 'map'], ['#/new', 'New run', 'new'], ['#/ride', 'Airport ride', 'ride'], me.role === 'owner' ? ['#/admin', 'Admin', 'admin'] : null, ['#/alerts', 'Alerts', 'alerts']].filter(Boolean);
    return [['#/new', 'New run', 'new'], ['#/ride', 'Airport ride', 'ride'], ['#/jobs', 'My jobs', 'jobs'], me.role === 'store' ? ['#/requests', 'Stock requests', 'requests'] : null, ['#/alerts', 'Alerts', 'alerts']].filter(Boolean);
  }
  const topEl = h('div', { id: 'top' });
  function drawTop() {
    const r = route();
    topEl.replaceChildren(demoBar() || document.createTextNode(''), h('header', { class: 'top' },
      h('div', { class: 'brand' }, BRAND),
      h('nav', { class: 'tabs', 'aria-label': 'Main' }, tabsFor().map(([href, label, name]) => h('a', { href, class: r.name === name ? 'on' : '', 'aria-current': r.name === name ? 'page' : null }, label, name === 'alerts' && alertsUnread ? h('span', { class: 'badge' }, alertsUnread) : null))),
      h('div', { class: 'row who' }, h('span', null, me.display_name + (me.org ? ', ' + me.org.name : '')),
        isInternal() && !DEMO ? h('a', { href: '/messaging/', style: 'color:#fff' }, 'Private Line') : null,
        h('button', { class: 'link', type: 'button', onclick: signOut }, 'Sign out'))));
  }
  function route() {
    const p = location.hash.replace(/^#\/?/, '').split('/');
    return { name: p[0] || 'home', id: p[1] };
  }
  let renderToken = 0;
  async function render() {
    if (!me || paused) return;
    const t = ++renderToken;
    const r = route();
    if (r.name === 'home') { location.hash = home(); return; }
    drawTop();
    if (!topEl.isConnected) root.replaceChildren(topEl, h('main', { id: 'main' }));
    const main = document.getElementById('main');
    const views = { new: viewNew, ride: viewRide, jobs: viewJobs, job: viewJob, board: viewBoard, map: viewMapPage, admin: viewAdmin, requests: viewRequests, alerts: viewAlerts, driver: viewDriver };
    const fn = views[r.name] || (() => h('div', { class: 'card' }, 'Page not found.'));
    let node;
    try { node = await fn(r.id); } catch (e) { node = h('div', { class: 'card' }, h('p', { class: 'err' }, e.message), h('a', { href: home() }, 'Back to your jobs')); }
    if (t !== renderToken) return;
    main.replaceChildren(node);
    if (node.afterMount) node.afterMount();
  }
  const reload = () => { render(); };

  /* ---------- catalog ---------- */
  const partsRows = (function () {
    const out = DATA.suppliers.map((s) => ({ key: s.id, name: s.name, caps: s.caps || [], city: s.city, address: s.address || '', phone: s.phone || '', web: s.web || '', hours: s.hours || '', note: s.note || '', source: s.source, checked: s.checked, verify: !!s.verify, lat: s.lat, lng: s.lng }));
    DATA.hoc.forEach((b) => { if (DATA.hocCaps[b.s]) out.push({ key: 'hoc-' + b.s, name: b.n, caps: DATA.hocCaps[b.s], city: 'Columbus', address: b.a ? b.a + ', Columbus, IN' : '', phone: b.p, web: b.w, type: b.t, hoc: b.s, lat: b.l ? b.l[0] : null, lng: b.l ? b.l[1] : null }); });
    return out.sort((a, b) => a.name.localeCompare(b.name));
  })();
  const hocRows = DATA.hoc.map((b) => ({ key: 'hoc-' + b.s, name: b.n, caps: [], cat: b.c, sub: b.u, type: b.t, city: 'Columbus', address: b.a ? b.a + ', Columbus, IN' : '', phone: b.p, web: b.w, hoc: b.s, lat: b.l ? b.l[0] : null, lng: b.l ? b.l[1] : null }));
  const capsInUse = Object.keys(DATA.capLabels).filter((c) => partsRows.some((r) => r.caps.includes(c)));
  const hocCats = Array.from(new Set(hocRows.map((r) => r.cat))).sort();
  const cities = Array.from(new Set(partsRows.map((r) => r.city))).sort((a, b) => (a === 'Columbus' ? -1 : b === 'Columbus' ? 1 : a.localeCompare(b)));
  const cat = { tab: 'parts', q: '', cap: '', city: '', hocCat: '', shown: 30 };

  function catalogPanel() {
    const list = h('div', { class: 'sup-list' });
    const countEl = h('p', { class: 'small muted' });
    const more = h('button', { type: 'button', onclick: () => { cat.shown += 40; draw(); } }, 'Show more');
    function draw() {
      const q = cat.q.toLowerCase();
      let rows = cat.tab === 'parts' ? partsRows : hocRows;
      if (cat.tab === 'parts') {
        if (cat.cap) rows = rows.filter((r) => r.caps.includes(cat.cap));
        if (cat.city) rows = rows.filter((r) => r.city === cat.city);
      } else if (cat.hocCat) rows = rows.filter((r) => r.cat === cat.hocCat);
      if (q) rows = rows.filter((r) => (r.name + ' ' + (r.type || '') + ' ' + (r.note || '') + ' ' + r.address + ' ' + (r.sub || '') + ' ' + r.caps.map((c) => DATA.capLabels[c] || c).join(' ')).toLowerCase().includes(q));
      countEl.textContent = rows.length + (rows.length === 1 ? ' place' : ' places');
      list.replaceChildren(...rows.slice(0, cat.shown).map(supCard));
      more.classList.toggle('hidden', rows.length <= cat.shown);
    }
    const search = h('input', { type: 'search', placeholder: 'Search: bearing, anodize, Seymour, a shop name', value: cat.q, 'aria-label': 'Search suppliers', oninput: (e) => { cat.q = e.target.value; cat.shown = 30; draw(); } });
    const capRow = h('div', { class: 'filters' });
    const drawCaps = () => capRow.replaceChildren(h('button', { type: 'button', class: 'chip' + (!cat.cap ? ' on' : ''), onclick: () => { cat.cap = ''; drawCaps(); draw(); } }, 'Everything'),
      ...capsInUse.map((c) => h('button', { type: 'button', class: 'chip' + (cat.cap === c ? ' on' : ''), onclick: () => { cat.cap = c; cat.shown = 30; drawCaps(); draw(); } }, DATA.capLabels[c])));
    drawCaps();
    const citySel = h('select', { 'aria-label': 'Town', onchange: (e) => { cat.city = e.target.value; cat.shown = 30; draw(); } }, h('option', { value: '' }, 'All towns'), cities.map((c) => h('option', { value: c, selected: cat.city === c }, c)));
    const hocSel = h('select', { 'aria-label': 'Heart of Columbus category', onchange: (e) => { cat.hocCat = e.target.value; cat.shown = 30; draw(); } }, h('option', { value: '' }, 'All categories'), hocCats.map((c) => h('option', { value: c, selected: cat.hocCat === c }, c)));
    const tabBtn = (id, label) => h('button', { type: 'button', class: 'chip' + (cat.tab === id ? ' on' : ''), onclick: () => { cat.tab = id; cat.shown = 30; reload(); } }, label);
    draw();
    return h('section', { class: 'card', 'aria-label': 'Supplier list' },
      h('div', { class: 'row between' }, h('h2', null, 'Pick from around Columbus'), h('button', { type: 'button', onclick: () => addPlaceDialog(null) }, 'Add a place not listed')),
      h('div', { class: 'filters' }, tabBtn('parts', 'Parts and services'), tabBtn('hoc', 'Everything on Heart of Columbus')),
      search,
      cat.tab === 'parts' ? [capRow, citySel] : [hocSel, h('p', { class: 'small muted' }, 'All ' + hocRows.length + ' Heart of Columbus listings, as of ' + DATA.hocTaken + '.')],
      countEl, list, more,
      h('p', { class: 'small muted' }, 'These are public listings, not partners. Listed businesses are not affiliated with us unless marked "In our network". We buy and pick up like any other customer.'));
  }
  function supCard(r) {
    const web = safeUrl(r.web), net = stores.find((s) => s.supplier_slug && (s.supplier_slug === r.key || 'hoc-' + s.supplier_slug === r.key));
    return h('article', { class: 'sup' },
      h('div', { class: 'row between', style: 'align-items:flex-start;flex-wrap:nowrap' },
        h('div', null, h('h3', null, r.name), h('div', { class: 'meta' }, [r.type, r.address || r.city].filter(Boolean).join(', '))),
        h('button', { type: 'button', class: 'primary', style: 'flex:none', onclick: () => addPlaceDialog(r, net), 'aria-label': 'Add ' + r.name + ' to this run' }, 'Add')),
      r.caps.length || r.verify || net ? h('div', { class: 'row', style: 'gap:5px' }, net ? h('span', { class: 'tag net' }, 'In our network') : null, r.caps.map((c) => h('span', { class: 'tag' }, DATA.capLabels[c] || c)), r.verify ? h('span', { class: 'tag verify' }, 'Call to confirm') : null) : null,
      r.note ? h('p', { class: 'small' }, r.note) : null,
      r.hours ? h('p', { class: 'small muted' }, r.hours) : null,
      h('div', { class: 'links' }, r.phone ? h('a', { href: tel(r.phone) }, r.phone) : null, web ? h('a', { href: web, target: '_blank', rel: 'noopener noreferrer' }, 'Website') : null,
        r.hoc ? h('a', { href: DATA.hocOrigin + '/b/' + encodeURIComponent(r.hoc) + '/', target: '_blank', rel: 'noopener' }, 'Heart of Columbus') : null,
        safeUrl(r.source) ? h('a', { href: r.source, target: '_blank', rel: 'noopener noreferrer', class: 'muted' }, 'Source') : null));
  }
  function addPlaceDialog(r, net) {
    modal(r ? r.name : 'Add a place', (close) => {
      const action = h('select', null, h('option', { value: 'buy' }, 'Buy this for me'), h('option', { value: 'pickup' }, 'Pick up something waiting there'), h('option', { value: 'process' }, 'Drop off for processing and pick up when done'));
      const name = h('input', { value: r ? r.name : '' }), address = h('input', { value: r ? r.address : '' });
      const desc = h('textarea', { placeholder: 'Bearing 6205-2RS, 2 boxes of brackets, or "Type II clear on all 40"' });
      const part = h('input', { placeholder: 'Optional' }), qty = h('input', { type: 'number', min: '0', step: 'any', value: '1', inputmode: 'decimal' });
      const instr = h('input', { placeholder: 'Ask for Lee at the counter, use dock 3' });
      const askStore = net ? h('input', { type: 'checkbox', checked: true }) : null;
      const err = h('div', { class: 'err' });
      return h('form', { class: 'stack', onsubmit: (e) => {
        e.preventDefault();
        if (!name.value.trim()) { err.textContent = 'Add the place name.'; return; }
        if (!desc.value.trim()) { err.textContent = 'Say what we are getting or doing here.'; return; }
        if (!(Number(qty.value) > 0)) { err.textContent = 'Quantity has to be more than zero.'; return; }
        const kind = action.value === 'process' ? 'process' : 'pickup';
        let stop = draft.stops.find((s) => s.key && r && s.key === r.key && s.kind === kind);
        if (!stop) { stop = { key: r ? r.key : null, kind, place_name: name.value.trim(), address: address.value.trim(), supplier_slug: r ? (r.hoc || r.key) : null, instructions: '', lat: r ? r.lat : null, lng: r ? r.lng : null, lines: [] }; draft.stops.push(stop); }
        if (instr.value.trim()) stop.instructions = (stop.instructions ? stop.instructions + ' ' : '') + instr.value.trim();
        stop.lines.push({ action: action.value, description: desc.value.trim(), part_no: part.value.trim(), qty: Number(qty.value), supplier_name: stop.place_name, supplier_slug: stop.supplier_slug, store_org_id: askStore && askStore.checked ? net.id : null });
        close(); reload(); toast('Added to your run.');
      } },
        h('label', { class: 'f' }, 'What do we do here?', action),
        !r ? [h('label', { class: 'f' }, 'Place name', name), h('label', { class: 'f' }, 'Address', address)] : null,
        h('label', { class: 'f' }, 'What is it?', desc),
        h('div', { class: 'grid2' }, h('label', { class: 'f' }, 'Part number', part), h('label', { class: 'f' }, 'Quantity', qty)),
        h('label', { class: 'f' }, 'Instructions for the driver', instr),
        net ? h('label', { class: 'c' }, askStore, h('span', null, 'Ask ' + net.name + ' to confirm stock and price first')) : null,
        err, h('div', { class: 'row' }, h('button', { class: 'primary', type: 'submit' }, 'Add to run'), h('button', { type: 'button', onclick: close }, 'Cancel')));
    });
  }

  /* ---------- new run ---------- */
  async function viewNew() {
    return h('div', { class: 'builder' }, catalogPanel(), runPanel());
  }
  function runPanel() {
    const err = h('div', { class: 'err' });
    const move = (i, d) => { const s = draft.stops; const [x] = s.splice(i, 1); s.splice(i + d, 0, x); reload(); };
    const stopsEl = draft.stops.length ? draft.stops.map((s, i) => h('div', { class: 'stop' },
      h('div', { class: 'rail' }, h('div', { class: 'dot' }), h('div', { class: 'bar' })),
      h('div', { class: 'body' },
        h('div', { class: 'row between', style: 'flex-wrap:nowrap;align-items:flex-start' }, h('div', { class: 'where' }, STOPK[s.kind] + ': ' + s.place_name),
          h('div', { class: 'row', style: 'gap:2px;flex:none' },
            i > 0 ? h('button', { type: 'button', class: 'link', 'aria-label': 'Move ' + s.place_name + ' earlier', onclick: () => move(i, -1) }, 'Up') : null,
            i < draft.stops.length - 1 ? h('button', { type: 'button', class: 'link', style: 'margin-left:8px', 'aria-label': 'Move ' + s.place_name + ' later', onclick: () => move(i, 1) }, 'Down') : null,
            h('button', { type: 'button', class: 'link', style: 'margin-left:8px', 'aria-label': 'Remove ' + s.place_name, onclick: () => { draft.stops.splice(i, 1); reload(); } }, 'Remove'))),
        s.lines.map((l) => h('div', { class: 'lineitem' }, h('span', null, ACTION[l.action] + ': ' + l.description + (l.part_no ? ' (' + l.part_no + ')' : '')), h('span', null, '×' + l.qty))),
        s.instructions ? h('div', { class: 'line muted' }, s.instructions) : null))) : null;
    const speed = h('div', { class: 'speed', role: 'group', 'aria-label': 'How fast' }, Object.keys(URGENCY).map((u) => h('button', { type: 'button', class: (draft.urgency === u ? 'on ' : '') + (u === 'hotshot' ? 'hot' : ''), 'aria-pressed': String(draft.urgency === u), onclick: () => { draft.urgency = u; reload(); } }, URGENCY[u][0], h('small', null, URGENCY[u][1]))));
    const bind = (obj, k, attrs) => h(attrs && attrs.tag === 'textarea' ? 'textarea' : 'input', Object.assign({}, attrs, { tag: null, value: obj[k], oninput: (e) => { obj[k] = e.target.value; } }));
    return h('aside', { class: 'run stack' },
      h('div', { class: 'traveler' },
        h('h2', null, 'Your run'),
        draft.stops.length ? null : h('p', { class: 'small' }, 'Add shops from the list, in the order the parts should go. One stop or six.'),
        h('div', { class: 'route', style: '--ink:#10203a;--panel:#fff;--line:#10203a' }, stopsEl,
          h('div', { class: 'stop' }, h('div', { class: 'rail' }, h('div', { class: 'dot' })), h('div', { class: 'body' }, h('div', { class: 'where' }, 'Deliver: ' + (draft.drop.place_name || 'your dock')))))),
      h('div', { class: 'card' },
        h('h3', null, 'Deliver to'),
        h('label', { class: 'f' }, 'Place', bind(draft.drop, 'place_name', { placeholder: 'Company and dock', oninput: null })),
        h('label', { class: 'f' }, 'Address', bind(draft.drop, 'address', { autocomplete: 'street-address' })),
        h('label', { class: 'f' }, 'Who receives it', bind(draft.drop, 'contact', {})),
        h('label', { class: 'f' }, 'Instructions', bind(draft.drop, 'instructions', { placeholder: 'Use dock 2, ring the bell' }))),
      h('div', { class: 'card' },
        h('h3', null, 'How fast?'), speed,
        h('label', { class: 'f' }, 'Need it by (optional)', bind(draft, 'need_by', { type: 'datetime-local' })),
        h('label', { class: 'f' }, 'Job name, for your records', bind(draft, 'title', { placeholder: 'Your PO or a nickname' })),
        h('label', { class: 'f' }, 'Notes for dispatch', bind(draft, 'notes', { tag: 'textarea' })),
        h('label', { class: 'c' }, h('input', { type: 'checkbox', checked: draft.blind, onchange: (e) => { draft.blind = e.target.checked; } }), h('span', null, h('strong', null, 'Blind handling. '), 'Drivers and suppliers get a job number, not your name. Drivers do not see the part details.')),
        h('label', { class: 'c' }, h('input', { type: 'checkbox', checked: draft.ok, onchange: (e) => { draft.ok = e.target.checked; err.textContent = ''; } }), h('span', null, 'This run has nothing on the no carry list: ' + NO_CARRY)),
        err,
        h('button', { type: 'button', class: 'primary big', onclick: async () => {
          err.textContent = '';
          if (!draft.stops.length) { err.textContent = 'Add at least one stop from the list.'; return; }
          if (!draft.drop.place_name.trim()) { err.textContent = 'Add where this gets delivered.'; return; }
          const stops = draft.stops.map((s) => ({ kind: s.kind, place_name: s.place_name, address: s.address, supplier_slug: s.supplier_slug, instructions: s.instructions, lat: s.lat, lng: s.lng }));
          stops.push({ kind: 'drop', place_name: draft.drop.place_name, address: draft.drop.address, contact: draft.drop.contact, instructions: draft.drop.instructions });
          const items = [].concat(...draft.stops.map((s) => s.lines));
          try {
            const o = await backend.rpc('cc_submit_order', { p: { urgency: draft.urgency, title: draft.title, notes: draft.notes, blind: draft.blind, no_prohibited: draft.ok, need_by: draft.need_by ? new Date(draft.need_by).toISOString() : null, stops, items } });
            draft = newDraft();
            toast('Sent. ' + o.ref + ' is waiting for a quote.');
            location.hash = '#/job/' + o.id;
          } catch (e) { err.textContent = e.message; }
        } }, 'Send for a quote'),
        h('p', { class: 'small muted' }, 'You get a price before anything is bought or moved.')));
  }

  /* ---------- lists ---------- */
  function jobCard(o) {
    return h('a', { class: 'job', href: '#/job/' + o.id },
      h('div', { class: 'row between' }, h('span', { class: 'ref' }, o.ref), h('span', { class: 'row', style: 'gap:6px' }, hotTag(o), statusTag(o))),
      o.title ? h('div', null, o.title) : null,
      h('div', { class: 'small muted' }, [o.org_name, KIND[o.kind], o.stops_done + ' of ' + o.stops + ' stops', o.driver_name, o.total_cents != null ? money(o.total_cents) : null].filter(Boolean).join(', ')),
      o.store_waiting ? h('div', { class: 'small' }, 'Waiting on a store to answer') : null,
      o.ride ? h('div', { class: 'small' }, rideLine(o.ride)) : null,
      o.need_by && !o.ride ? h('div', { class: 'small' }, 'Need by ' + when(o.need_by)) : null);
  }
  const riders = (n) => n + (n === 1 ? ' rider' : ' riders');
  const rideLine = (r) => [r.direction === 'to_ind' ? 'To IND' : 'From IND', r.town, riders(r.passengers), r.direction === 'to_ind' ? 'pickup ' + when(r.pickup_at) : 'lands ' + when(r.flight_at)].filter(Boolean).join(', ');
  async function viewJobs() {
    const rows = await backend.rpc('cc_list_orders');
    return h('div', { class: 'stack' },
      h('div', { class: 'row between' }, h('h1', null, 'My jobs'), h('a', { href: '#/new' }, h('button', { class: 'primary', type: 'button' }, 'New run'))),
      pushCard(),
      rows.length ? rows.map(jobCard) : h('div', { class: 'card' }, h('p', null, 'No jobs yet. Start a run and you will get a price back.'), h('a', { href: '#/new' }, 'Start your first run')));
  }
  async function viewBoard() {
    const rows = await backend.rpc('cc_list_orders');
    const rideReqs = await backend.rpc('cc_ride_requests_open');
    const cols = [['Needs a quote', ['requested']], ['Waiting on customer', ['quoted']], ['Needs a driver', ['approved', 'dispatching']], ['Out now', ['assigned', 'in_progress']], ['To bill', ['delivered']]];
    return h('div', { class: 'stack' }, h('h1', null, 'Board'), pushCard(),
      rideReqs.length ? h('section', { class: 'card' }, h('h2', null, 'Airport ride requests'), h('p', { class: 'small muted' }, 'From the public form. Call or text with a price, then book it.'),
        rideReqs.map((r) => h('div', { class: 'msg' },
          h('strong', null, r.name + ', ' + rideLine(r)),
          h('div', { class: 'small' }, [r.address, r.flight ? 'Flight ' + r.flight : null, r.bags + (r.bags === 1 ? ' bag' : ' bags'), r.notes].filter(Boolean).join(', ')),
          h('div', { class: 'row small' }, h('a', { href: tel(r.phone) }, r.phone), r.email ? h('a', { href: 'mailto:' + r.email }, r.email) : null),
          h('div', { class: 'row' }, h('button', { type: 'button', class: 'primary', onclick: () => { rideDraft = { direction: r.direction, town: r.town, address: r.address, flight: r.flight, flight_at: r.flight_at, pickup_at: r.pickup_at, passengers: r.passengers, bags: r.bags, notes: r.notes, passenger_name: r.name, passenger_phone: r.phone, request_id: r.id }; location.hash = '#/ride'; } }, 'Book it'),
            act('Decline', async () => { await backend.rpc('cc_admin_resolve_ride', { p_id: r.id, p_status: 'declined' }); reload(); }))))) : null,
      h('div', { class: 'board', style: 'grid-template-columns:repeat(auto-fit,minmax(180px,1fr))' }, cols.map(([label, sts]) => {
        const list = rows.filter((o) => sts.includes(o.status)).sort((a, b) => (b.urgency === 'hotshot') - (a.urgency === 'hotshot'));
        return h('section', null, h('h2', null, label, h('span', { class: 'muted' }, list.length)), list.length ? list.map(jobCard) : h('p', { class: 'empty' }, 'Nothing here.'));
      })));
  }
  async function viewRequests() {
    const rows = await backend.rpc('cc_store_requests');
    return h('div', { class: 'stack' }, h('h1', null, 'Stock requests'),
      h('p', { class: 'muted' }, 'Other stores asking for a part. You see the job number and the part, not who asked.'),
      rows.length ? rows.map((r) => {
        const price = h('input', { inputmode: 'decimal', placeholder: '0.00', 'aria-label': 'Your price for ' + r.description }), note = h('input', { placeholder: 'On the shelf, ready at the counter', 'aria-label': 'Note' });
        return h('div', { class: 'card' },
          h('div', { class: 'row between' }, h('strong', null, r.ref), r.urgency === 'hotshot' ? h('span', { class: 'status hot' }, 'Hot shot') : null, h('span', { class: 'status' }, { asked: 'Needs your answer', confirmed: 'Confirmed', declined: 'Declined' }[r.store_status] || r.store_status)),
          h('p', null, r.description + (r.part_no ? ' (' + r.part_no + ')' : '') + ', quantity ' + r.qty),
          r.need_by ? h('p', { class: 'small' }, 'Need by ' + when(r.need_by)) : null,
          r.store_status === 'asked' ? [h('div', { class: 'grid2' }, h('label', { class: 'f' }, 'Your price', price), h('label', { class: 'f' }, 'Note', note)),
            h('div', { class: 'row' }, act('Confirm stock', async () => { await backend.rpc('cc_store_respond', { p_item: r.id, p_confirm: true, p_price_cents: price.value.trim() ? cents(price.value) : null, p_note: note.value }); toast('Confirmed.'); reload(); }, 'primary'),
              act('Not available', async () => { await backend.rpc('cc_store_respond', { p_item: r.id, p_confirm: false, p_price_cents: null, p_note: note.value }); reload(); }))]
            : r.store_price_cents != null ? h('p', { class: 'small muted' }, 'Your price: ' + money(r.store_price_cents)) : null);
      }) : h('div', { class: 'card' }, 'No requests right now. You get an alert when another store asks.'));
  }
  async function viewAlerts() {
    const rows = await backend.rpc('cc_alerts');
    await backend.rpc('cc_alerts_read');
    alertsUnread = 0; setTimeout(drawTop, 0);
    return h('div', { class: 'stack' }, h('h1', null, 'Alerts'), pushCard(),
      rows.length ? rows.map((a) => h(a.order_id ? 'a' : 'div', { class: 'job', href: a.order_id ? '#/job/' + a.order_id : null }, h('div', { class: 'row between' }, h('strong', null, a.title), h('span', { class: 'small muted' }, when(a.at))), h('div', { class: 'small' }, a.body)))
        : h('div', { class: 'card' }, 'Nothing yet. New jobs and quotes show up here.'));
  }
  function pushCard() {
    if ('Notification' in window && Notification.permission === 'granted' && !DEMO) return null;
    return h('div', { class: 'card row between' }, h('div', { style: 'flex:1;min-width:200px' }, h('strong', null, 'Get alerts on this phone'), h('p', { class: 'small muted' }, 'Alerts show a job number and never what is in the box.')),
      act('Turn on alerts', async () => { await backend.enablePush(); if (!DEMO) { toast('Alerts are on.'); reload(); } }));
  }

  /* ---------- one job ---------- */
  async function viewJob(id) {
    const o = await backend.rpc('cc_get_order', { p_order: id });
    const side = o.side;
    const left = h('div', { class: 'stack' }), right = h('div', { class: 'stack' });
    const page = h('div', { class: 'stack' },
      h('a', { href: home(), class: 'small' }, 'Back to ' + (side === 'dispatch' ? 'the board' : 'your jobs')),
      h('div', { class: 'traveler', style: '--bg:' + getComputedStyle(document.body).backgroundColor },
        h('div', { class: 'row between' }, h('h2', null, 'Job ' + o.ref), h('span', { class: 'row', style: 'gap:6px' }, statusTag(o))),
        h('p', null, [URGENCY[o.urgency][0], KIND[o.kind], o.blind ? 'Blind handling' : null, side === 'dispatch' ? o.org_name : null].filter(Boolean).join(', ')),
        o.title ? h('p', { style: 'font-weight:700' }, o.title) : null,
        o.need_by ? h('p', null, 'Need by ' + when(o.need_by)) : null),
      h('div', { class: 'detail' }, left, right));

    if (side === 'driver') add(left, driverPanel(o));
    add(left, h('section', { class: 'card', 'aria-label': 'Stops' }, h('h2', null, 'Route'), h('div', { class: 'route' }, o.stops.map((s) => stopRow(o, s)))));
    if (o.ride) add(left, rideCard(o)); else add(left, itemsCard(o));
    const mapCard = trackCard(o);
    if (mapCard) add(left, mapCard);

    const acts = h('div', { class: 'stack acts' });
    if (side === 'client') add(acts, clientActions(o));
    if (side === 'dispatch') add(acts, dispatchPanel(o));
    if (acts.childNodes.length) add(right, acts);
    if (side !== 'driver') add(right, shareCard(o));
    if (!o.ride) add(right, filesCard(o));
    add(right, messagesCard(o));
    add(right, timelineCard(o));
    page.afterMount = () => { page.querySelectorAll('[data-map]').forEach((el) => el.__draw && el.__draw()); if (side === 'driver' && o.status === 'in_progress') keepAwake(); };
    return page;
  }
  function stopRow(o, s) {
    const cls = 'stop ' + (s.status === 'done' ? 'done' : s.status === 'arrived' ? 'arrived' : '');
    return h('div', { class: cls },
      h('div', { class: 'rail' }, h('div', { class: 'dot' }), h('div', { class: 'bar' })),
      h('div', { class: 'body' },
        h('div', { class: 'where' }, STOPK[s.kind] + ': ' + s.place_name),
        s.address ? h('div', { class: 'line' }, h('a', { href: mapsUrl(s), target: '_blank', rel: 'noopener noreferrer' }, s.address)) : null,
        s.contact ? h('div', { class: 'line muted' }, 'Ask for ' + s.contact) : null,
        s.instructions ? h('div', { class: 'line' }, s.instructions) : null,
        s.status === 'arrived' ? h('div', { class: 'line' }, 'Arrived ' + when(s.arrived_at)) : null,
        s.status === 'done' ? h('div', { class: 'line muted' }, 'Done ' + when(s.done_at) + (s.received_by ? ', received by ' + s.received_by : '')) : null,
        s.note ? h('div', { class: 'line muted' }, s.note) : null));
  }
  function itemsCard(o) {
    if (o.cargo_hidden) return h('section', { class: 'card' }, h('h2', null, 'Cargo'), h('p', null, 'Blind job with ' + o.item_count + (o.item_count === 1 ? ' line' : ' lines') + '. Follow the stop instructions and do not open sealed packages.'));
    if (!o.items.length) return null;
    return h('section', { class: 'card' }, h('h2', null, 'What is on this run'), o.notes ? h('p', { class: 'small' }, o.notes) : null,
      h('div', { class: 'scrollx' }, h('table', { class: 't' }, h('thead', null, h('tr', null, ['Do', 'What', 'Qty', 'Where'].map((x) => h('th', null, x)))),
        h('tbody', null, o.items.map((i) => h('tr', null, h('td', null, ACTION[i.action]), h('td', null, i.description, i.part_no ? h('div', { class: 'small muted' }, i.part_no) : null),
          h('td', null, i.qty), h('td', null, i.store_name || i.supplier_name || '', i.store_status !== 'none' ? h('div', { class: 'small muted' }, { asked: 'Waiting on store', confirmed: 'Store confirmed', declined: 'Store declined' }[i.store_status] + (i.store_price_cents != null ? ', ' + money(i.store_price_cents) : '') + (i.store_note ? ', ' + i.store_note : '')) : null)))))));
  }
  function quoteLines(q, o) {
    const row = (l, c) => (c ? h('div', null, h('span', null, l), h('span', null, money(c))) : null);
    const ride = o && o.kind === 'ride';
    return h('div', { class: 'quote-lines' }, row('Parts', q.parts_cents), row('Purchasing fee', q.purchase_fee_cents), row(ride ? 'Ride' : 'Delivery', q.courier_cents), row(ride ? 'Extra riders or late night' : 'Rush', q.rush_cents), h('div', { class: 'total' }, h('span', null, 'Total'), h('span', null, money(q.total_cents))));
  }
  function clientActions(o) {
    const out = [];
    if (o.quote) {
      const note = h('input', { placeholder: 'Optional note', 'aria-label': 'Note' });
      out.push(h('section', { class: 'card' }, h('h2', null, o.status === 'quoted' ? 'Your quote' : 'Quote'), quoteLines(o.quote, o), o.quote.note ? h('p', { class: 'small' }, o.quote.note) : null,
        o.status === 'quoted' ? [h('p', { class: 'small muted' }, 'Good until ' + when(o.quote.valid_until) + '.'), note, h('div', { class: 'row' },
          act('Approve and send a driver', async () => { await backend.rpc('cc_respond_quote', { p_order: o.id, p_accept: true, p_note: note.value }); toast('Approved. Dispatch is finding a driver.'); reload(); }, 'primary'),
          act('Decline', async () => { await backend.rpc('cc_respond_quote', { p_order: o.id, p_accept: false, p_note: note.value }); reload(); }))] : null));
    } else if (o.status === 'requested') out.push(h('section', { class: 'card' }, h('h2', null, 'We are pricing this'), h('p', { class: 'small muted' }, 'You will get an alert when your quote is ready.')));
    if (o.driver_name && ['assigned', 'in_progress'].includes(o.status)) out.push(h('section', { class: 'card' }, h('strong', null, 'Your driver: ' + o.driver_name)));
    if (['requested', 'quoted', 'approved'].includes(o.status)) out.push(cancelCard(o));
    return out;
  }
  function cancelCard(o) {
    return h('div', null, h('button', { type: 'button', class: 'link danger', onclick: () => modal('Cancel ' + o.ref + '?', (close) => {
      const why = h('input', { placeholder: 'Why?', 'aria-label': 'Reason' });
      return h('div', { class: 'stack' }, h('label', { class: 'f' }, 'Reason', why), h('div', { class: 'row' },
        act('Cancel this job', async () => { await backend.rpc('cc_cancel_order', { p_order: o.id, p_reason: why.value }); close(); reload(); }, 'danger'),
        h('button', { type: 'button', onclick: close }, 'Keep it')));
    }) }, 'Cancel this job'));
  }
  function suggestRide(r) {
    const miles = AIRPORT_TOWNS[r.town] || 55;
    const ride = miles <= 35 ? RIDE_RATES.near : miles <= 60 ? RIDE_RATES.mid : miles <= 80 ? RIDE_RATES.far : RIDE_RATES.long;
    const at = new Date(r.direction === 'to_ind' ? r.pickup_at : r.flight_at);
    const late = !isNaN(at) && (at.getHours() >= 22 || at.getHours() < 5);
    const extra = Math.max(0, (r.passengers || 1) - RIDE_RATES.includedRiders) * RIDE_RATES.extraRider + (late ? RIDE_RATES.lateNight : 0);
    return { parts: 0, fee: 0, courier: ride, rush: extra, miles, label: 'about ' + miles + ' miles from IND' + (late ? ', late night' : '') };
  }
  function suggestQuote(o) {
    if (o.ride) return suggestRide(o.ride);
    const text = o.stops.map((x) => (x.address || '') + ' ' + x.place_name).join(' ').toLowerCase();
    let miles = 5;
    for (const c of Object.keys(DATA.areaMiles)) if (text.includes(c.toLowerCase())) miles = Math.max(miles, DATA.areaMiles[c]);
    const parts = o.items.reduce((n, i) => n + (i.store_price_cents || 0), 0);
    const buying = o.items.some((i) => i.action === 'buy');
    const fee = buying || parts ? Math.max(RATES.feeMin, Math.round(parts * RATES.feePct)) : 0;
    const dedicated = o.urgency === 'hotshot' || o.urgency === 'same_day';
    let courier, label;
    if (dedicated && miles <= RATES.localMiles) { courier = RATES.counter; label = 'local counter run, $35 flat'; }
    else if (dedicated) { courier = RATES.base + RATES.perMile * miles; label = 'dedicated run, $35 plus $1.85 a mile for about ' + miles + ' miles'; }
    else { const n = Math.max(1, o.stops.length - 1); courier = RATES.sharedStop * n; label = 'shared corridor run, $50 a stop for ' + n + (n === 1 ? ' stop' : ' stops'); }
    return { parts, fee, courier, rush: 0, miles, label };
  }
  function dispatchPanel(o) {
    const out = [];
    if (['requested', 'quoted'].includes(o.status)) {
      const s = suggestQuote(o);
      const cur = o.quote && o.quote.status === 'sent' ? o.quote : null;
      const inp = (label, v) => { const el = h('input', { inputmode: 'decimal', value: (v / 100).toFixed(2), 'aria-label': label }); return [el, h('label', { class: 'f' }, label, el)]; };
      const rd = !!o.ride;
      const [p, pl] = inp('Parts', cur ? cur.parts_cents : s.parts), [f, fl] = inp('Purchasing fee', cur ? cur.purchase_fee_cents : s.fee), [c, cl] = inp(rd ? 'Ride' : 'Delivery', cur ? cur.courier_cents : s.courier), [r, rl] = inp(rd ? 'Extra riders or late night' : 'Rush', cur ? cur.rush_cents : s.rush);
      const note = h('input', { placeholder: 'Shown to the customer', value: cur && cur.note ? cur.note : '', 'aria-label': 'Note' }), hours = h('input', { type: 'number', value: '24', min: '1', max: '720', 'aria-label': 'Hours the quote lasts' });
      out.push(h('section', { class: 'card' }, h('h2', null, cur ? 'Change the quote' : 'Send a quote'),
        h('p', { class: 'small muted' }, 'Filled from the rate card, ' + (s.label || 'about ' + s.miles + ' miles out') + '. Change anything.'),
        h('div', { class: 'grid2' }, rd ? null : pl, rd ? null : fl, cl, rl), h('label', { class: 'f' }, 'Note', note), h('label', { class: 'f' }, 'Good for how many hours', hours),
        act('Send quote', async () => { await backend.rpc('cc_send_quote', { p_order: o.id, p_parts: cents(p.value), p_fee: cents(f.value), p_courier: cents(c.value), p_rush: cents(r.value), p_note: note.value, p_valid_hours: Number(hours.value) }); toast('Quote sent.'); reload(); }, 'primary')));
    }
    if (o.quote && o.status !== 'requested') out.push(h('section', { class: 'card' }, h('h2', null, 'Quote'), quoteLines(o.quote, o), h('p', { class: 'small muted' }, 'Status: ' + o.quote.status)));
    if (o.status === 'quoted') {
      const who = h('input', { placeholder: 'Dana by phone', 'aria-label': 'Who approved and how' });
      out.push(h('section', { class: 'card' }, h('h3', null, 'Approved by phone?'), h('label', { class: 'f' }, 'Who approved and how', who), act('Record approval', async () => { await backend.rpc('cc_respond_quote', { p_order: o.id, p_accept: true, p_note: who.value }); reload(); })));
    }
    if (['approved', 'dispatching', 'assigned'].includes(o.status)) out.push(dispatchCard(o));
    if (o.status === 'delivered') {
      const inv = h('input', { placeholder: 'Invoice number', 'aria-label': 'Invoice number' });
      out.push(h('section', { class: 'card' }, h('h2', null, 'Bill and close'), inv, act('Close job', async () => { await backend.rpc('cc_close_order', { p_order: o.id, p_invoice: inv.value }); reload(); }, 'primary')));
    }
    if (!['delivered', 'closed', 'cancelled', 'declined', 'in_progress'].includes(o.status)) out.push(cancelCard(o));
    return out;
  }
  function dispatchCard(o) {
    const sec = h('section', { class: 'card' }, h('h2', null, o.status === 'assigned' ? 'Change the driver' : 'Send to drivers'),
      o.driver_name ? h('p', null, 'Assigned to ' + o.driver_name) : null,
      o.status === 'dispatching' ? h('p', { class: 'small muted' }, 'Offered to everyone on duty. First to claim gets it.') : null,
      act('Offer to everyone on duty', async () => { const r = await backend.rpc('cc_dispatch', { p_order: o.id, p_driver: null }); toast('Offered to ' + r.offered + (r.offered === 1 ? ' driver.' : ' drivers.'), o.urgency === 'hotshot'); reload(); }, 'primary'));
    backend.rpc('cc_fleet').then((fleet) => {
      const sel = h('select', { 'aria-label': 'Pick a driver' }, fleet.filter((d) => d.nda_ok).map((d) => h('option', { value: d.id }, d.name + (d.on_duty ? ' (on duty)' : ' (off duty)') + (d.jobs.length ? ', ' + d.jobs.length + ' open' : ''))));
      sec.append(h('label', { class: 'f' }, 'Or pick a driver', sel), act('Assign this driver', async () => { await backend.rpc('cc_dispatch', { p_order: o.id, p_driver: sel.value }); toast('Driver assigned.'); reload(); }));
    }).catch(() => {});
    return sec;
  }
  function driverPanel(o) {
    const out = [];
    if (o.status === 'dispatching') out.push(act('Claim this job', async () => { await backend.rpc('cc_claim_job', { p_order: o.id }); toast('It is yours.'); reload(); }, 'primary big'));
    const mine = ['assigned', 'in_progress'].includes(o.status); // a driver can only open these when the job is theirs
    const next = o.stops.find((s) => s.status === 'pending' || s.status === 'arrived');
    if (mine && next) {
      out.push(h('section', { class: 'card' }, h('h2', null, 'Next: ' + STOPK[next.kind] + ' at ' + next.place_name),
        next.address ? h('p', null, next.address) : null, next.instructions ? h('p', { class: 'small' }, next.instructions) : null,
        h('p', { class: 'small' }, h('a', { href: tel(CONTACT_PHONE) }, 'Call dispatch'), next.contact && o.ride ? ' or ' : null, next.contact && o.ride ? h('a', { href: smsUrl(o.ride.passenger_phone, 'Hi, this is your driver from ' + BRAND + '. ') }, 'text the rider') : null),
        next.status === 'arrived' && !o.ride ? h('button', { type: 'button', onclick: () => scanDialog(o, next) }, 'Check a box tag' + (tagChecks[next.id] ? ' (' + tagChecks[next.id] + ' checked)' : '')) : null,
        h('a', { href: mapsUrl(next), target: '_blank', rel: 'noopener noreferrer' }, h('button', { type: 'button', class: 'big' }, 'Open in Google Maps')),
        next.status === 'pending'
          ? act('I am here', async () => { await backend.rpc('cc_stop_update', { p_stop: next.id, p_action: 'arrive', p_received_by: null, p_note: null, p_lat: lastPos && lastPos.lat, p_lng: lastPos && lastPos.lng }); keepAwake(); reload(); }, 'primary big')
          : h('button', { type: 'button', class: 'primary big', onclick: () => finishStop(o, next) }, o.kind === 'ride' ? (next.kind === 'drop' ? 'Dropped off' : 'Rider is in the vehicle') : next.kind === 'drop' ? 'Deliver and get a name' : next.kind === 'process' ? 'Dropped at processing' : 'Picked up')));
      if (o.status === 'assigned') out.push(h('button', { type: 'button', class: 'link', onclick: () => modal('Give this job back?', (close) => {
        const why = h('input', { 'aria-label': 'Reason', placeholder: 'Flat tire, wrong vehicle' });
        return h('div', { class: 'stack' }, h('label', { class: 'f' }, 'Reason', why), h('div', { class: 'row' }, act('Give it back', async () => { await backend.rpc('cc_release_job', { p_order: o.id, p_reason: why.value }); close(); location.hash = '#/driver'; }), h('button', { type: 'button', onclick: close }, 'Keep it')));
      }) }, 'I cannot do this job'));
    }
    return out;
  }
  function finishStop(o, s) {
    if (o.kind === 'ride') {
      modal(s.kind === 'drop' ? 'Dropped off' : 'Rider picked up', (close) => {
        const note = h('input', { placeholder: s.kind === 'drop' ? 'Departures door 4' : 'Flight was 20 minutes late', 'aria-label': 'Note' });
        return h('div', { class: 'stack' }, h('label', { class: 'f' }, 'Note (optional)', note),
          act(s.kind === 'drop' ? 'Mark dropped off' : 'Mark picked up', async () => {
            await backend.rpc('cc_stop_update', { p_stop: s.id, p_action: 'done', p_received_by: null, p_note: note.value, p_lat: lastPos && lastPos.lat, p_lng: lastPos && lastPos.lng });
            close(); toast('Logged.'); reload();
          }, 'primary big'), h('button', { type: 'button', onclick: close }, 'Back'));
      });
      return;
    }
    modal(s.kind === 'drop' ? 'Deliver' : s.kind === 'process' ? 'Dropped at processing' : 'Picked up', (close) => {
      const who = h('input', { autocomplete: 'off', 'aria-label': 'Name of the person who took it' }), note = h('input', { placeholder: 'Boxes: 2, gate was closed', 'aria-label': 'Note', value: tagChecks[s.id] ? 'Box tags checked: ' + tagChecks[s.id] : '' });
      const photo = h('input', { type: 'file', accept: 'image/*', capture: 'environment', 'aria-label': 'Photo' });
      return h('div', { class: 'stack' },
        h('label', { class: 'f' }, 'Name of the person who took it' + (s.kind === 'drop' ? '' : ' (optional)'), who),
        h('label', { class: 'f' }, 'Note', note),
        h('label', { class: 'f' }, 'Photo of the package and the place. Do not photograph contents.', photo),
        act(s.kind === 'drop' ? 'Mark delivered' : 'Mark done', async () => {
          if (s.kind === 'drop' && who.value.trim().length < 2) throw new Error('Get the name of the person who received it.');
          if (photo.files[0]) { const path = await backend.upload(o.id, photo.files[0]); await backend.rpc('cc_add_attachment', { p_order: o.id, p_path: path, p_name: photo.files[0].name, p_kind: 'proof', p_stop: s.id }); }
          await backend.rpc('cc_stop_update', { p_stop: s.id, p_action: 'done', p_received_by: who.value, p_note: note.value, p_lat: lastPos && lastPos.lat, p_lng: lastPos && lastPos.lng });
          close(); toast('Logged.'); reload();
        }, 'primary big'),
        h('button', { type: 'button', onclick: close }, 'Back'));
    });
  }
  function filesCard(o) {
    const canAdd = o.side !== 'driver' && !['closed', 'cancelled', 'declined'].includes(o.status);
    if (!canAdd && !o.attachments.length) return null;
    const file = h('input', { type: 'file', accept: 'application/pdf,image/*', 'aria-label': 'Choose a file' });
    const kind = h('select', { 'aria-label': 'File type' }, h('option', { value: 'drawing' }, 'Drawing'), h('option', { value: 'po' }, 'Purchase order'));
    return h('section', { class: 'card' }, h('h2', null, 'Files'),
      o.attachments.map((a) => h('button', { type: 'button', class: 'link', style: 'text-align:left', onclick: async () => { try { window.open(await backend.fileUrl(a.path), '_blank', 'noopener'); } catch (e) { toast(e.message); } } }, ({ proof: 'Delivery photo', drawing: 'Drawing', po: 'Purchase order' }[a.kind]) + ': ' + a.name)),
      canAdd ? [h('div', { class: 'grid2' }, kind, file), act('Upload file', async () => {
        if (!file.files[0]) throw new Error('Choose a file first.');
        const path = await backend.upload(o.id, file.files[0]);
        await backend.rpc('cc_add_attachment', { p_order: o.id, p_path: path, p_name: file.files[0].name, p_kind: kind.value, p_stop: null });
        toast('Uploaded.'); reload();
      }), h('p', { class: 'small muted' }, o.blind ? 'On a blind job, drivers cannot open these.' : 'Your driver can open these.')] : null);
  }
  function messagesCard(o) {
    const body = h('textarea', { 'aria-label': 'Message', placeholder: o.side === 'driver' ? 'Message dispatch' : o.side === 'client' ? 'Message dispatch about this job' : 'Message' });
    const internal = o.side === 'dispatch' ? h('input', { type: 'checkbox' }) : null;
    return h('section', { class: 'card' }, h('h2', null, o.side === 'driver' ? 'Dispatch' : 'Messages'),
      o.messages.length ? o.messages.map((m) => h('div', { class: 'msg' + (m.mine ? ' mine' : '') + (m.internal ? ' inner' : '') }, h('small', null, (m.mine ? 'You' : m.sender_name) + ', ' + when(m.at) + (m.internal && o.side === 'dispatch' ? ', driver thread' : '')), m.body)) : h('p', { class: 'empty' }, 'No messages yet.'),
      body, internal ? h('label', { class: 'c small' }, internal, h('span', null, 'Send to the driver instead of the customer')) : null,
      act('Send', async () => { await backend.rpc('cc_post_message', { p_order: o.id, p_body: body.value, p_internal: internal ? internal.checked : false }); reload(); }));
  }
  function timelineCard(o) {
    if (!o.events.length) return null;
    return h('section', { class: 'card' }, h('h2', null, 'Custody record'), h('div', { class: 'timeline' }, o.events.map((e) => h('div', null,
      h('span', null, (EVENT[e.type] || e.type) + (e.detail && e.detail.received_by ? ', ' + e.detail.received_by : '') + (e.detail && e.detail.lat ? ', location logged' : '')), h('span', { class: 'muted', style: 'flex:none' }, when(e.at))))));
  }

  /* ---------- share, calendar, tags ---------- */
  const smsUrl = (phone, body) => 'sms:' + String(phone || '').replace(/[^0-9+]/g, '') + '?&body=' + encodeURIComponent(body || '');
  const tagChecks = {};
  function icsDate(t) { return new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
  const icsText = (x) => String(x || '').replace(/\\/g, '\\\\').replace(/([,;])/g, '\\$1').replace(/\n/g, '\\n');
  function downloadIcs(o) {
    const start = o.ride ? (o.ride.direction === 'to_ind' ? o.ride.pickup_at : o.ride.flight_at) : o.need_by;
    const where = o.stops.length ? (o.stops[0].address || o.stops[0].place_name) : '';
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Private Line Courier//EN', 'BEGIN:VEVENT', 'UID:' + o.id + '@crossroadsweddingco.shop', 'DTSTAMP:' + icsDate(Date.now()),
      'DTSTART:' + icsDate(start), 'DTEND:' + icsDate(Date.parse(start) + 90 * 60000), 'SUMMARY:' + icsText((o.title || KIND[o.kind]) + ' (' + o.ref + ')'),
      'LOCATION:' + icsText(where), 'DESCRIPTION:' + icsText(BRAND + ' job ' + o.ref + '. Questions: ' + CONTACT_PHONE), 'END:VEVENT', 'END:VCALENDAR'];
    const a = h('a', { href: URL.createObjectURL(new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/calendar' })), download: o.ref + '.ics' });
    document.body.append(a); a.click(); a.remove();
  }
  function shareCard(o) {
    if (!o.track_token || ['closed', 'cancelled', 'declined'].includes(o.status)) return null;
    const url = location.origin + '/messaging/courier.html?t=' + o.track_token;
    const start = o.ride ? (o.ride.direction === 'to_ind' ? o.ride.pickup_at : o.ride.flight_at) : o.need_by;
    return h('section', { class: 'card' }, h('h2', null, 'Share and plan'),
      h('p', { class: 'small muted' }, 'Anyone with this link sees this job\u2019s progress and the driver while it moves. It shows no prices, cargo or addresses.'),
      h('input', { class: 'share-url', readonly: true, value: url, 'aria-label': 'Tracking link', onfocus: (e) => e.target.select() }),
      h('div', { class: 'row' },
        h('button', { type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(url); toast('Link copied.'); } catch (e) { toast('Select the link and copy it.'); } } }, 'Copy link'),
        h('a', { href: smsUrl(o.ride ? o.ride.passenger_phone : '', 'Track ' + o.ref + ': ' + url) }, h('button', { type: 'button' }, 'Text the link')),
        DEMO ? h('button', { type: 'button', onclick: () => gateTrack(o.track_token, () => { drawTop(); root.replaceChildren(topEl, h('main', { id: 'main' })); render(); }) }, 'Preview') : h('a', { href: url, target: '_blank', rel: 'noopener' }, h('button', { type: 'button' }, 'Open')),
        start ? h('button', { type: 'button', onclick: () => downloadIcs(o) }, 'Add to calendar') : null,
        !o.ride ? h('button', { type: 'button', onclick: () => tagsDialog(o) }, 'Print box tags') : null));
  }
  function tagsDialog(o) {
    modal('Print box tags for ' + o.ref, (close) => {
      const n = h('input', { type: 'number', min: '1', max: '20', value: '1', inputmode: 'numeric', 'aria-label': 'How many boxes' });
      return h('div', { class: 'stack' }, h('p', { class: 'small' }, 'One tag per box. The driver checks each tag at every stop.' + (o.blind ? ' Tags show only the job number, never your company or the contents.' : '')),
        h('label', { class: 'f' }, 'How many boxes', n),
        act('Print tags', async () => { const k = Math.round(Number(n.value)); if (!(k >= 1 && k <= 20)) throw new Error('Print 1 to 20 tags at a time.'); close(); printTags(o, k); }, 'primary'));
    });
  }
  function printTags(o, n) {
    const area = document.getElementById('print-area');
    const base = location.origin + '/messaging/courier.html?o=' + o.id + '&b=';
    area.replaceChildren(h('div', { class: 'tag-sheet' }, Array.from({ length: n }, (_, i) => h('div', { class: 'ptag' },
      h('img', { src: window.CC_QR.dataUrl(base + (i + 1), 8), alt: 'QR code for ' + o.ref }),
      h('div', { class: 'ptag-brand' }, BRAND), h('div', { class: 'ptag-ref' }, o.ref), h('div', { class: 'ptag-box' }, 'Box ' + (i + 1) + ' of ' + n),
      h('div', { class: 'ptag-note' }, o.blind ? 'Confidential. Do not open. If found, call ' + CONTACT_PHONE + '.' : 'Questions: ' + CONTACT_PHONE)))));
    document.body.classList.add('printing');
    const done = () => { document.body.classList.remove('printing'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
  }
  function scanDialog(o, s) {
    let stream = null, timer = null;
    const stop = () => { clearInterval(timer); if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; };
    modal('Check a box tag', (close) => {
      const status = h('p', { class: 'small' }, 'Point the camera at the QR code on the tag.');
      const video = h('video', { class: 'scan-video', playsinline: true, muted: true, autoplay: true });
      const typed = h('input', { placeholder: o.ref, autocapitalize: 'characters', 'aria-label': 'Job number on the tag' });
      const check = (text) => {
        const t = String(text || '').trim();
        if (t.includes(o.id) || t.toUpperCase() === o.ref) {
          tagChecks[s.id] = (tagChecks[s.id] || 0) + 1; close(); toast('Tag matches ' + o.ref + '. ' + tagChecks[s.id] + (tagChecks[s.id] === 1 ? ' box' : ' boxes') + ' checked here.');
        } else status.textContent = 'That tag is not for ' + o.ref + '. Set the box aside and call dispatch.';
      };
      if ('BarcodeDetector' in window && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then((st) => {
          stream = st; video.srcObject = st;
          const det = new window.BarcodeDetector({ formats: ['qr_code'] });
          timer = setInterval(async () => { try { const r = await det.detect(video); if (r[0]) check(r[0].rawValue); } catch (e) { /* keep trying */ } }, 400);
        }).catch(() => { status.textContent = 'The camera is not available. Type the job number from the tag.'; video.remove(); });
      } else { status.textContent = 'This phone can\u2019t scan inside the app. Type the job number from the tag.'; video.remove(); }
      return h('div', { class: 'stack' }, status, video, h('label', { class: 'f' }, 'Or type the job number', typed),
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'primary', onclick: () => check(typed.value) }, 'Check'), h('button', { type: 'button', onclick: close }, 'Done')));
    }, stop);
  }

  /* ---------- airport rides ---------- */
  function rideCard(o) {
    const r = o.ride;
    return h('section', { class: 'card' }, h('h2', null, r.direction === 'to_ind' ? 'Ride to the airport' : 'Ride from the airport'),
      h('div', { class: 'quote-lines' },
        h('div', null, h('span', null, 'Rider'), h('span', null, r.passenger_name)),
        h('div', null, h('span', null, 'Phone'), h('span', { class: 'row', style: 'gap:12px' }, h('a', { href: tel(r.passenger_phone) }, r.passenger_phone), h('a', { href: smsUrl(r.passenger_phone, o.side === 'driver' ? 'Hi, this is your driver from ' + BRAND + '. ' : '') }, 'Text'))),
        r.direction === 'to_ind' ? h('div', null, h('span', null, 'Pickup'), h('span', null, when(r.pickup_at))) : h('div', null, h('span', null, 'Flight lands'), h('span', null, when(r.flight_at))),
        r.flight ? h('div', null, h('span', null, 'Flight'), h('span', null, r.flight)) : null,
        h('div', null, h('span', null, 'Riders and bags'), h('span', null, riders(r.passengers) + ', ' + r.bags + (r.bags === 1 ? ' bag' : ' bags')))),
      o.side === 'driver' && r.direction === 'from_ind' ? h('p', { class: 'small' }, 'Check the flight status before you leave. Text the rider when you are parked.') : null);
  }
  let rideDraft = null;
  function rideFields(st, isPublic) {
    const towns = Object.keys(AIRPORT_TOWNS).sort();
    const local = (t) => { if (!t) return ''; const d = new Date(t); if (isNaN(d)) return ''; const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 16); };
    const v = {};
    const box = h('div', { class: 'stack' });
    function draw() {
      const to = st.direction === 'to_ind';
      const inp = (k, label, attrs) => h('label', { class: 'f' }, label, (v[k] = h('input', Object.assign({ value: st[k] == null ? '' : st[k], oninput: (e) => { st[k] = e.target.value; } }, attrs || {}))));
      const when_ = (k, label) => h('label', { class: 'f' }, label, (v[k] = h('input', { type: 'datetime-local', value: local(st[k]), oninput: (e) => { st[k] = e.target.value ? new Date(e.target.value).toISOString() : ''; } })));
      box.replaceChildren(...[
        h('div', { class: 'speed', role: 'group', 'aria-label': 'Direction' }, [['to_ind', 'To the airport', 'From home or work to IND'], ['from_ind', 'From the airport', 'IND back home or to work']].map(([k, a, b]) =>
          h('button', { type: 'button', class: st.direction === k ? 'on' : '', 'aria-pressed': String(st.direction === k), onclick: () => { st.direction = k; draw(); } }, a, h('small', null, b)))),
        h('label', { class: 'f' }, 'Town', h('select', { onchange: (e) => { st.town = e.target.value; } }, h('option', { value: '' }, 'Pick a town'), towns.map((t) => h('option', { value: t, selected: st.town === t }, t)), h('option', { value: 'Other', selected: st.town === 'Other' }, 'Somewhere else'))),
        inp('address', to ? 'Pickup address' : 'Drop-off address', { autocomplete: 'street-address' }),
        isPublic ? null : inp('place_name', 'Name for this place (optional)', { placeholder: 'Home, hotel, plant gate 3' }),
        to ? when_('pickup_at', 'Pick me up at') : when_('flight_at', 'Flight lands at'),
        inp('flight', 'Airline and flight number' + (to ? ' (optional)' : ''), { placeholder: 'Delta 1234' }),
        h('div', { class: 'grid2' }, inp('passengers', 'Riders', { type: 'number', min: '1', max: String(MAX_RIDERS), inputmode: 'numeric' }), inp('bags', 'Bags', { type: 'number', min: '0', max: '20', inputmode: 'numeric' })),
        isPublic ? [inp('name', 'Your name', { autocomplete: 'name' }), h('div', { class: 'grid2' }, inp('phone', 'Phone', { type: 'tel', autocomplete: 'tel' }), inp('email', 'Email (optional)', { type: 'email', autocomplete: 'email' }))]
          : h('div', { class: 'grid2' }, inp('passenger_name', 'Rider\u2019s name', { autocomplete: 'off' }), inp('passenger_phone', 'Rider\u2019s phone', { type: 'tel' })),
        h('label', { class: 'f' }, 'Anything the driver should know', (v.notes = h('textarea', { value: st.notes || '', oninput: (e) => { st.notes = e.target.value; } }))),
        isPublic ? null : h('label', { class: 'c' }, h('input', { type: 'checkbox', checked: st.blind !== false, onchange: (e) => { st.blind = e.target.checked; } }), h('span', null, h('strong', null, 'Blind booking. '), 'The driver gets the rider\u2019s name and phone, not your company\u2019s name or the price.')),
        h('p', { class: 'small muted' }, 'Up to ' + MAX_RIDERS + ' riders per vehicle. We confirm the pickup time with your price.')].flat().filter(Boolean));
    }
    draw();
    return { node: box, collect: () => Object.assign({}, st, { passengers: Number(st.passengers || 0), bags: Number(st.bags || 0) }) };
  }
  async function viewRide() {
    const st = rideDraft || { direction: 'to_ind', passengers: 1, bags: 1, blind: true };
    rideDraft = null;
    const f = rideFields(st, false);
    const err = h('div', { class: 'err' });
    return h('div', { class: 'stack', style: 'max-width:640px' },
      h('h1', null, 'Airport ride'),
      h('p', { class: 'muted' }, 'Door to door between south central Indiana and Indianapolis International Airport.' + (st.request_id ? ' Filled in from a public request.' : '')),
      h('section', { class: 'card' }, f.node, err,
        h('button', { type: 'button', class: 'primary big', onclick: async () => {
          err.textContent = '';
          try { const o = await backend.rpc('cc_submit_ride', { p: f.collect() }); toast('Sent. ' + o.ref + ' is waiting for a price.'); location.hash = '#/job/' + o.id; } catch (e) { err.textContent = e.message; }
        } }, isDispatch() ? 'Book and price it' : 'Send for a price')));
  }

  /* ---------- GPS and maps ---------- */
  function trackCard(o) {
    if (o.side === 'driver' || !['assigned', 'in_progress'].includes(o.status)) return null;
    const status = h('p', { class: 'small muted' });
    const el = h('div', { class: 'map', 'data-map': '1' });
    el.__draw = async () => {
      const t = await backend.rpc('cc_track', { p_order: o.id });
      status.textContent = { not_moving: 'Live tracking starts when the driver reaches the first stop.', hidden: 'Your driver is on a shared route right now. Tracking comes back on your leg.', no_signal: 'No GPS signal from the driver in the last 10 minutes.', live: 'Driver location as of ' + when(t.at) + '.' }[t.state];
      await drawMap(el, { stops: o.stops, drivers: t.state === 'live' ? [{ name: o.driver_name || 'Driver', lat: t.lat, lng: t.lng }] : [] });
    };
    return h('section', { class: 'card' }, h('h2', null, 'Where is it?'), status, el);
  }
  let leafletP = null;
  function loadLeaflet() {
    if (leafletP) return leafletP;
    leafletP = new Promise((res, rej) => {
      if (window.L) return res(window.L);
      // Integrity values are the ones Leaflet publishes for 1.9.4, so a changed file from the CDN won't run.
      document.head.append(h('link', { rel: 'stylesheet', href: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', integrity: 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=', crossorigin: '' }));
      const s = h('script', { src: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', integrity: 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=', crossorigin: '' });
      s.onload = () => res(window.L); s.onerror = () => { leafletP = null; rej(new Error('map')); };
      document.head.append(s);
      setTimeout(() => { if (!window.L) { leafletP = null; rej(new Error('map')); } }, 8000);
    });
    return leafletP;
  }
  async function satelliteLayer(L) {
    if (GOOGLE_TILES_KEY) {
      try {
        const r = await fetch('https://tile.googleapis.com/v1/createSession?key=' + GOOGLE_TILES_KEY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mapType: 'satellite', language: 'en-US', region: 'US' }) });
        const j = await r.json();
        if (j.session) return L.tileLayer('https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=' + j.session + '&key=' + GOOGLE_TILES_KEY, { maxZoom: 20, attribution: 'Imagery © Google' });
      } catch (e) { /* falls through to the no-key imagery */ }
    }
    return L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagery © Esri' });
  }
  async function drawMap(el, data) {
    let L;
    try { L = await loadLeaflet(); } catch (e) {
      el.replaceChildren(h('div', { class: 'notice' }, 'The map could not load here. Stops and driver positions are listed on this page.', listPositions(data)));
      return;
    }
    if (el.__map) { el.__map.remove(); el.__map = null; }
    el.replaceChildren();
    const street = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' });
    const map = L.map(el, { layers: [street] }).setView([39.2014, -85.9214], 10);
    el.__map = map;
    satelliteLayer(L).then((sat) => { L.control.layers({ Street: street, Satellite: sat }, null, { collapsed: false }).addTo(map); });
    const pts = [];
    (data.stops || []).filter((s) => s.lat != null && s.lng != null).forEach((s) => {
      pts.push([s.lat, s.lng]);
      L.marker([s.lat, s.lng], { title: s.place_name, icon: L.divIcon({ className: '', html: '<div class="pin stop-pin">' + Number(s.seq) + '</div>', iconSize: [0, 0] }) }).addTo(map);
    });
    (data.drivers || []).filter((d) => d.lat != null && d.lng != null).forEach((d) => {
      pts.push([d.lat, d.lng]);
      const icon = document.createElement('div'); icon.className = 'pin'; icon.textContent = (d.name || '?').trim().slice(0, 1).toUpperCase();
      const m = L.marker([d.lat, d.lng], { title: d.name, icon: L.divIcon({ className: '', html: icon.outerHTML, iconSize: [0, 0] }) }).addTo(map);
      const tip = document.createElement('span'); tip.textContent = d.name; m.bindTooltip(tip);
    });
    if (pts.length > 1) map.fitBounds(pts, { padding: [40, 40], maxZoom: 13 });
    else if (pts.length === 1) map.setView(pts[0], 12);
  }
  function listPositions(data) {
    const rows = (data.drivers || []).filter((d) => d.lat != null);
    return rows.length ? h('ul', null, rows.map((d) => h('li', null, d.name + ': ' + d.lat.toFixed(3) + ', ' + d.lng.toFixed(3)))) : null;
  }
  async function viewMapPage() {
    const fleet = await backend.rpc('cc_fleet');
    const el = h('div', { class: 'map tall', 'data-map': '1' });
    const on = fleet.filter((d) => d.on_duty);
    const page = h('div', { class: 'stack' }, h('h1', null, 'Fleet'), el,
      h('section', { class: 'card' }, h('div', { class: 'scrollx' }, h('table', { class: 't' }, h('thead', null, h('tr', null, ['Driver', 'Status', 'Vehicle', 'Open jobs', 'Last GPS'].map((x) => h('th', null, x)))),
        h('tbody', null, fleet.map((d) => h('tr', null, h('td', null, d.name), h('td', null, d.on_duty ? 'On duty' : 'Off duty', d.nda_ok ? null : h('div', { class: 'small err' }, 'NDA not signed')), h('td', null, d.vehicle || ''), h('td', null, d.jobs.join(', ')), h('td', null, when(d.at)))))))));
    page.afterMount = () => drawMap(el, { drivers: on });
    return page;
  }
  function startGps() {
    if (!isInternal() || !me.on_duty) return stopGps();
    const send = (lat, lng, acc) => {
      lastPos = { lat, lng };
      if (Date.now() - lastPing < 20000) return;
      lastPing = Date.now();
      backend.rpc('cc_ping', { p_lat: lat, p_lng: lng, p_accuracy: acc == null ? null : acc, p_heading: null, p_speed: null }).catch(() => {});
    };
    if (DEMO) {
      if (simTimer) return;
      let lat = 39.2014, lng = -85.9214;
      lastPing = 0; send(lat, lng, 10);
      simTimer = setInterval(() => { lat += 0.0009; lng += 0.0006; lastPing = 0; if (me && me.on_duty) send(lat, lng, 10); }, 8000);
      return;
    }
    if (gpsWatch !== null || !navigator.geolocation) return;
    gpsWatch = navigator.geolocation.watchPosition((p) => send(p.coords.latitude, p.coords.longitude, p.coords.accuracy), () => { /* the driver view shows GPS status */ }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 });
  }
  function stopGps() {
    if (gpsWatch !== null && navigator.geolocation) navigator.geolocation.clearWatch(gpsWatch);
    gpsWatch = null; clearInterval(simTimer); simTimer = null; lastPos = null;
    if (wakeLock) { try { wakeLock.release(); } catch (e) { /* already gone */ } wakeLock = null; }
  }
  async function keepAwake() {
    if (wakeLock || !navigator.wakeLock) return;
    try { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } catch (e) { /* battery saver can refuse this */ }
  }

  /* ---------- driver home ---------- */
  async function viewDriver() {
    const rows = await backend.rpc('cc_list_orders');
    const open = rows.filter((o) => o.status === 'dispatching');
    const mine = rows.filter((o) => o.mine && ['assigned', 'in_progress'].includes(o.status));
    const past = rows.filter((o) => o.mine && !['assigned', 'in_progress'].includes(o.status));
    const vehicle = h('input', { value: me.vehicle || '', placeholder: 'White cargo van', 'aria-label': 'Vehicle' });
    return h('div', { class: 'stack' },
      h('section', { class: 'card duty' + (me.on_duty ? ' on' : '') },
        h('div', { style: 'flex:1;min-width:200px' }, h('h2', null, me.on_duty ? 'You are on duty' : 'You are off duty'),
          h('p', { class: 'small muted' }, me.on_duty ? 'Dispatch can see your location and you get job offers. Keep this screen open while driving, because phones stop sharing location when locked.' : 'Your location is not shared while you are off duty.')),
        me.on_duty ? null : h('label', { class: 'f', style: 'flex:1;min-width:180px' }, 'Vehicle', vehicle),
        act(me.on_duty ? 'Go off duty' : 'Go on duty', async () => { me = await backend.rpc('cc_set_duty', { p_on: !me.on_duty, p_vehicle: vehicle.value }); startGps(); reload(); }, me.on_duty ? '' : 'primary')),
      pushCard(),
      mine.length ? [h('h2', null, 'Your jobs'), mine.map(jobCard)] : null,
      h('h2', null, 'Open jobs'),
      me.on_duty ? (open.length ? open.map(jobCard) : h('p', { class: 'empty' }, 'Nothing open. You will get an alert when one comes in.')) : h('p', { class: 'empty' }, 'Go on duty to see open jobs.'),
      past.length ? [h('h2', null, 'Recent'), past.slice(0, 10).map(jobCard)] : null);
  }

  /* ---------- admin ---------- */
  async function viewAdmin() {
    const a = await backend.rpc('cc_admin_overview');
    const orgOpts = (sel) => [h('option', { value: '' }, 'No company')].concat(a.orgs.map((o) => h('option', { value: o.id, selected: sel === o.id }, o.name)));
    const ROLES = [['pending', 'Waiting'], ['owner', 'Owner'], ['dispatcher', 'Dispatcher'], ['driver', 'Driver'], ['client', 'Customer'], ['store', 'Store']];
    const roleSel = (cur) => h('select', { 'aria-label': 'Role' }, ROLES.map(([v, l]) => h('option', { value: v, selected: cur === v }, l)));
    const u = h('input', { autocapitalize: 'none', 'aria-label': 'Username' }), pw = h('input', { type: 'text', autocomplete: 'off', 'aria-label': 'Temporary password', minlength: 8 }), nm = h('input', { 'aria-label': 'Name' }), rs = roleSel('client'), os = h('select', { 'aria-label': 'Company' }, orgOpts(''));
    const on = h('input', { 'aria-label': 'Company name' }), ok = h('select', { 'aria-label': 'Company type' }, h('option', { value: 'client' }, 'Customer'), h('option', { value: 'store' }, 'Store in the network')), os2 = h('input', { 'aria-label': 'Heart of Columbus or catalog id', placeholder: 'Optional, like boyer-machine-and-tool-co-inc' });
    return h('div', { class: 'stack' }, h('h1', null, 'Admin'),
      a.requests.length ? h('section', { class: 'card' }, h('h2', null, 'Access requests'), a.requests.map((r) => h('div', { class: 'msg' },
        h('strong', null, r.company + ', ' + r.contact), h('div', { class: 'small' }, [r.kind, r.email, r.phone, r.note].filter(Boolean).join(', ')),
        h('div', { class: 'row' }, act('Mark handled', async () => { await backend.rpc('cc_admin_resolve_request', { p_id: r.id, p_status: 'approved' }); reload(); }), act('Decline', async () => { await backend.rpc('cc_admin_resolve_request', { p_id: r.id, p_status: 'declined' }); reload(); }))))) : null,
      h('section', { class: 'card' }, h('h2', null, 'Create a login'),
        h('div', { class: 'grid2' }, h('label', { class: 'f' }, 'Username', u), h('label', { class: 'f' }, 'Temporary password', pw), h('label', { class: 'f' }, 'Name', nm), h('label', { class: 'f' }, 'Role', rs)), h('label', { class: 'f' }, 'Company', os),
        act('Create login', async () => { await backend.createLogin({ username: u.value.trim().toLowerCase(), password: pw.value, display_name: nm.value.trim(), role: rs.value, org_id: os.value || null }); toast('Login created.'); reload(); }, 'primary')),
      h('section', { class: 'card' }, h('h2', null, 'People'), h('div', { class: 'scrollx' }, h('table', { class: 't' }, h('thead', null, h('tr', null, ['Name', 'Role', 'Company', 'NDA', 'Active', ''].map((x) => h('th', null, x)))),
        h('tbody', null, a.members.map((m) => {
          const r = roleSel(m.role), o = h('select', { 'aria-label': 'Company' }, orgOpts(m.org_id)), act2 = h('input', { type: 'checkbox', checked: m.active, 'aria-label': 'Active' });
          return h('tr', null, h('td', null, m.name, h('div', { class: 'small muted' }, m.username)), h('td', null, r), h('td', null, o), h('td', null, m.nda_ok ? 'Signed' : 'Not yet'), h('td', null, act2),
            h('td', null, act('Save', async () => { await backend.rpc('cc_admin_set_member', { p_user: m.id, p_role: r.value, p_org: o.value || null, p_active: act2.checked }); toast('Saved.'); reload(); })));
        }))))),
      h('section', { class: 'card' }, h('h2', null, 'Companies'), a.orgs.map((o) => h('div', { class: 'small' }, h('strong', null, o.name), ', ' + (o.kind === 'store' ? 'store in the network' : 'customer'))),
        h('div', { class: 'grid2' }, h('label', { class: 'f' }, 'Company name', on), h('label', { class: 'f' }, 'Type', ok)), h('label', { class: 'f' }, 'Catalog id', os2),
        act('Add company', async () => { await backend.rpc('cc_admin_save_org', { p: { name: on.value, kind: ok.value, supplier_slug: os2.value.trim() } }); toast('Added.'); reload(); }, 'primary')));
  }

  boot();
})();
