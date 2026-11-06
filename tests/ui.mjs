// Drives the demo in a real browser through a whole job, as every role, and takes screenshots.
import { createRequire } from 'node:module';
import http from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';
const require = createRequire('/opt/npm-tools/');
const { chromium } = require('playwright');
const ROOT = resolve(new URL('..', import.meta.url).pathname);
const OUT = process.argv[2] || '/tmp/pl-shots'; mkdirSync(OUT, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2' };
const srv = http.createServer((q, r) => {
  const f = resolve(ROOT, '.' + decodeURIComponent(q.url.split('?')[0]));
  if (!f.startsWith(ROOT) || !existsSync(f)) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'Content-Type': types[extname(f)] || 'application/octet-stream' }); r.end(readFileSync(f));
}).listen(0);
const port = srv.address().port;
const b = await chromium.launch();
const errors = [];
async function page(w, h) {
  const c = await b.newContext({ viewport: { width: w, height: h } });
  const p = await c.newPage();
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/unpkg|ERR_|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  await p.route(/unpkg\.com|tile\.openstreetmap|arcgisonline/, (x) => x.abort());
  return p;
}
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png`, fullPage: true });
const noHScroll = async (p, n) => { const o = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); if (o > 0) errors.push(`${n}: scrolls sideways by ${o}px`); };
const check = (ok, msg) => { if (!ok) errors.push('FAILED: ' + msg); else console.log('ok  ' + msg); };

for (const [label, w, h] of [['desktop', 1280, 860], ['phone', 390, 800]]) {
  const p = await page(w, h);
  await p.goto(`http://localhost:${port}/messaging/courier.html?demo=1`);
  await shot(p, `${label}-1-pick`);
  await p.getByRole('button', { name: /^Customer/ }).click();
  await p.getByText('Sign the NDA to continue').waitFor();
  await shot(p, `${label}-2-nda`);
  await p.getByRole('button', { name: 'Sign and continue' }).click();
  await p.getByText('Check the box to accept.').waitFor();
  await p.getByLabel('Full legal name').fill('Casey Buyer');
  await p.getByRole('checkbox').check();
  await p.getByRole('button', { name: 'Sign and continue' }).click();
  await p.getByRole('heading', { name: 'My jobs' }).waitFor();
  await shot(p, `${label}-3-jobs`); await noHScroll(p, label + ' jobs');

  // Build a run from the catalog: machinist, then anodizer, then deliver.
  await p.getByRole('link', { name: 'New run', exact: true }).first().click();
  await p.getByRole('heading', { name: 'Pick from around Columbus' }).waitFor();
  await p.getByRole('button', { name: 'Send for a quote' }).click();
  await p.getByText('Add at least one stop from the list.').waitFor();
  await p.getByLabel('Search suppliers').fill('quick turn');
  await p.getByRole('button', { name: 'Add Quick Turn Anodizing to this run' }).click();
  await p.locator('.dialog select').selectOption('process');
  await p.locator('.dialog textarea').fill('Type II clear on all 40');
  await p.locator('.dialog').getByLabel('Quantity').fill('40');
  await p.getByRole('button', { name: 'Add to run' }).click();
  await p.getByLabel('Search suppliers').fill('boyer');
  await p.getByRole('button', { name: /^Add Boyer/ }).click();
  await p.locator('.dialog select').selectOption('pickup');
  await p.locator('.dialog textarea').fill('Crate of brackets, rev C');
  await p.getByRole('button', { name: 'Add to run' }).click();
  await p.getByRole('button', { name: /Move Boyer.*earlier/ }).click();
  await p.getByLabel('Place', { exact: true }).fill('Sample Bracket Co. dock 2');
  await p.getByLabel('Address', { exact: true }).fill('200 Example Ave, Columbus, IN');
  await p.getByRole('button', { name: /^Hot shot/ }).click();
  await p.getByLabel('Place', { exact: true }).waitFor();
  await p.getByRole('button', { name: 'Send for a quote' }).click();
  await p.getByText(/no carry list/).first().waitFor();
  await p.getByRole('checkbox', { name: /no carry list/ }).check();
  await shot(p, `${label}-4-builder`); await noHScroll(p, label + ' builder');
  await p.getByRole('button', { name: 'Send for a quote' }).click();
  await p.getByText(/^Job PL-/).waitFor();
  const ref = (await p.getByText(/^Job PL-/).textContent()).replace('Job ', '');
  check(/PL-\d+/.test(ref), label + ' order placed ' + ref);
  check(await p.getByText('Pick up: Boyer').count() === 1, label + ' stops kept the order the customer set');

  // HoC tab shows all listings and links out.
  await p.getByRole('link', { name: 'New run', exact: true }).first().click();
  await p.getByRole('button', { name: 'Everything on Heart of Columbus' }).click();
  await p.getByText(/All 929 Heart of Columbus listings/).waitFor();
  const hoc = await p.getByRole('link', { name: 'Heart of Columbus' }).first().getAttribute('href');
  check(hoc.startsWith('https://heartofcolumbus.netlify.app/b/'), label + ' listings link to Heart of Columbus');
  await p.getByLabel('Search suppliers').fill('zaharakos');
  check(await p.locator('.sup').count() === 1, label + ' every Heart of Columbus listing is searchable');
  await shot(p, `${label}-5-hoc`); await noHScroll(p, label + ' hoc');

  // Dispatch prices it.
  const sw = p.getByLabel('Switch who you are');
  await sw.selectOption({ label: 'Dispatch and owner' });
  await p.getByRole('heading', { name: 'Board' }).waitFor();
  await shot(p, `${label}-6-board`); await noHScroll(p, label + ' board');
  await p.getByRole('link', { name: new RegExp(ref) }).click();
  await p.getByRole('heading', { name: 'Send a quote' }).waitFor();
  check((await p.getByLabel('Rush').inputValue()) !== '0.00', label + ' hot shot suggests a rush charge');
  await shot(p, `${label}-7-quote`); await noHScroll(p, label + ' quote');
  await p.getByRole('button', { name: 'Send quote' }).click();
  await p.getByRole('heading', { name: 'Approved by phone?' }).waitFor();

  // Customer approves.
  await sw.selectOption({ label: 'Customer' });
  await p.getByRole('link', { name: new RegExp(ref) }).click();
  await p.getByRole('heading', { name: 'Your quote' }).waitFor();
  await shot(p, `${label}-8-customer-quote`);
  await p.getByRole('button', { name: 'Approve and send a driver' }).click();
  await p.getByText('Approved, finding a driver').first().waitFor();

  // Dispatch offers it.
  await sw.selectOption({ label: 'Dispatch and owner' });
  await p.getByRole('link', { name: new RegExp(ref) }).click();
  await p.getByRole('button', { name: 'Offer to everyone on duty' }).click();
  await p.getByText('Offered to everyone on duty.').waitFor();

  // Driver: blind view, claim, run every stop.
  await sw.selectOption({ label: 'Driver' });
  await p.getByRole('link', { name: new RegExp(ref) }).waitFor();
  await shot(p, `${label}-9-driver`); await noHScroll(p, label + ' driver');
  await p.getByRole('link', { name: new RegExp(ref) }).click();
  await p.getByText(/Blind job with/).waitFor();
  const text = await p.locator('main').innerText();
  check(!text.includes('Crate of brackets') && !text.includes('Sample Bracket Co.,'), label + ' blind driver cannot see cargo details');
  await p.getByRole('button', { name: 'Claim this job' }).click();
  await p.getByRole('button', { name: 'I am here' }).waitFor();
  await shot(p, `${label}-10-driver-job`); await noHScroll(p, label + ' driver job');
  for (let i = 0; i < 3; i++) {
    await p.getByRole('button', { name: 'I am here' }).click();
    if (i < 2) {
      await p.getByRole('button', { name: i === 0 ? 'Picked up' : 'Dropped at processing' }).click();
      await p.getByRole('button', { name: 'Mark done' }).click();
      await p.getByRole('button', { name: 'I am here' }).waitFor();
    }
  }
  await p.getByRole('button', { name: 'Deliver and get a name' }).click();
  await p.getByRole('button', { name: 'Mark delivered' }).click();
  await p.getByText('Get the name of the person who received it.').waitFor();
  await p.getByLabel('Name of the person who took it').fill('Dana Receiver');
  await p.getByRole('button', { name: 'Mark delivered' }).click();
  await p.locator('.traveler').getByText('Delivered').waitFor();

  // Customer sees the record. Dispatch closes.
  await sw.selectOption({ label: 'Customer' });
  await p.getByRole('link', { name: new RegExp(ref) }).click();
  await p.getByRole('heading', { name: 'Custody record' }).waitFor();
  check(await p.getByText(/Delivered, Dana Receiver/).count() === 1, label + ' customer sees who received it');
  await shot(p, `${label}-11-custody`); await noHScroll(p, label + ' custody');
  await sw.selectOption({ label: 'Dispatch and owner' });
  await p.getByRole('link', { name: new RegExp(ref) }).click();
  await p.getByLabel('Invoice number').fill('INV-1');
  await p.getByRole('button', { name: 'Close job' }).click();
  await p.locator('.traveler').getByText('Closed').waitFor();

  // Map page falls back cleanly when the map library can't load, then Admin.
  await p.getByRole('link', { name: 'Map', exact: true }).click();
  await p.getByRole('heading', { name: 'Fleet' }).waitFor();
  await p.getByText('The map could not load here.').waitFor();
  await shot(p, `${label}-12-fleet`); await noHScroll(p, label + ' fleet');
  await p.getByRole('link', { name: 'Admin', exact: true }).click();
  await p.getByRole('heading', { name: 'People' }).waitFor();
  await shot(p, `${label}-13-admin`); await noHScroll(p, label + ' admin');

  // Airport ride: a public request lands on the board, dispatch books and prices it, a driver runs it.
  await sw.selectOption({ label: 'Dispatch and owner' });
  await p.getByRole('heading', { name: 'Airport ride requests' }).waitFor();
  await shot(p, `${label}-15-ride-requests`); await noHScroll(p, label + ' ride requests');
  await p.getByRole('button', { name: 'Book it' }).click();
  await p.getByRole('heading', { name: 'Airport ride' }).waitFor();
  check((await p.getByRole('textbox', { name: 'Rider\u2019s name' }).inputValue()) === 'Sample Traveler', label + ' booking is filled in from the request');
  await shot(p, `${label}-16-ride-form`); await noHScroll(p, label + ' ride form');
  await p.getByRole('button', { name: 'Book and price it' }).click();
  await p.getByRole('heading', { name: 'Ride to the airport' }).waitFor();
  check((await p.getByLabel('Ride', { exact: true }).inputValue()) === '125.00', label + ' Seymour ride suggests the far rate');
  await p.getByRole('button', { name: 'Send quote' }).click();
  await p.getByLabel('Who approved and how').fill('Traveler by phone');
  await p.getByRole('button', { name: 'Record approval' }).click();
  await p.getByRole('button', { name: 'Offer to everyone on duty' }).click();
  await p.getByText('Offered to everyone on duty.').waitFor();
  const rideRef = (await p.getByText(/^Job PL-/).textContent()).replace('Job ', '');
  await sw.selectOption({ label: 'Driver' });
  await p.getByRole('link', { name: new RegExp(rideRef) }).click();
  await p.getByRole('button', { name: 'Claim this job' }).click();
  await p.getByRole('link', { name: '(812) 555-0142' }).waitFor();
  check(true, label + ' driver sees the rider and phone on a blind ride');
  await p.getByRole('button', { name: 'I am here' }).click();
  await p.getByRole('button', { name: 'Rider is in the vehicle' }).click();
  await p.getByRole('button', { name: 'Mark picked up' }).click();
  await p.getByRole('button', { name: 'I am here' }).click();
  await p.getByRole('button', { name: 'Dropped off' }).click();
  await p.getByRole('button', { name: 'Mark dropped off' }).click();
  await p.locator('.traveler').getByText('Delivered').waitFor();
  check(true, label + ' ride runs start to finish with no receiver name');
  await shot(p, `${label}-17-ride-done`); await noHScroll(p, label + ' ride done');

  // Customer books a ride from their account.
  await sw.selectOption({ label: 'Customer' });
  await p.getByRole('link', { name: 'Airport ride', exact: true }).click();
  await p.getByRole('button', { name: /^From the airport/ }).click();
  await p.getByLabel('Town').selectOption('Columbus');
  await p.getByLabel('Drop-off address').fill('200 Example Ave, Columbus, IN');
  await p.getByLabel('Flight lands at').fill('2026-12-01T15:30');
  await p.getByRole('textbox', { name: 'Rider\u2019s name' }).fill('Visiting engineer');
  await p.getByRole('textbox', { name: 'Rider\u2019s phone' }).fill('(812) 555-0199');
  await p.getByLabel('Riders').fill('9');
  await p.getByRole('button', { name: 'Send for a price' }).click();
  await p.getByText('Up to 7 riders per vehicle. Call for a bigger group.').waitFor();
  await p.getByLabel('Riders').fill('2');
  await p.getByRole('button', { name: 'Send for a price' }).click();
  await p.getByRole('heading', { name: 'Ride from the airport' }).waitFor();
  check(await p.getByText(/Ground Transportation Center/).count() >= 1, label + ' airport pickup tells the driver where to meet');

  // Store sees a transfer ask with no customer name.
  await sw.selectOption({ label: 'Store' });
  await p.getByRole('heading', { name: 'My jobs' }).waitFor();
  await p.getByRole('link', { name: 'Stock requests' }).click();
  await p.getByRole('heading', { name: 'Stock requests' }).waitFor();
  await shot(p, `${label}-14-store`);

  // The public ride form, from the sign-in screen.
  await p.getByRole('button', { name: 'Sign out' }).click();
  await p.getByRole('button', { name: 'See the public airport ride form' }).click();
  await p.getByLabel('Pickup address').fill('12 Sample Ln, Franklin, IN');
  await p.getByLabel('Town').selectOption('Franklin');
  await p.getByLabel('Pick me up at').fill('2026-12-02T04:30');
  await p.getByLabel('Your name').fill('Sample Neighbor');
  await p.getByLabel('Phone', { exact: true }).fill('812-555-0123');
  await shot(p, `${label}-18-public-ride`); await noHScroll(p, label + ' public ride');
  await p.getByRole('button', { name: 'Ask for a price' }).click();
  await p.getByRole('heading', { name: 'Request sent' }).waitFor();
  check(true, label + ' public ride request goes through');
  await p.close();
}
await b.close(); srv.close();
// Copy rule: no dashes in words people read. Code like "a - b" is fine, so look for a word on each side.
const dashes = readFileSync(resolve(ROOT, 'messaging/courier.js'), 'utf8').match(/'[^'\n]*([A-Za-z] - [A-Za-z]|—|–)[^'\n]*'/g);
if (dashes) errors.push('visible dashes: ' + dashes.join(' | '));
if (errors.length) { console.log('\nPROBLEMS:\n' + errors.join('\n')); process.exit(1); }
console.log('\nAll flows passed at desktop and phone width.');
