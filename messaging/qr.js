/* Small QR Code encoder for job tags: byte mode, error correction level M, versions 1 to 6.
   Same construction as marketing/qr.py, which tests/qr.test.mjs checks it against.
   window.CC_QR.matrix(text) returns rows of booleans; window.CC_QR.dataUrl(text, px) a PNG data URL. */
(function (root) {
  'use strict';
  const ECC = [0, 10, 16, 26, 18, 24, 16];
  const BLOCKS = [0, 1, 1, 1, 2, 2, 4];
  const rawModules = (v) => { let r = (16 * v + 128) * v + 64; if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; } return r; };
  const dataCodewords = (v) => Math.floor(rawModules(v) / 8) - ECC[v] * BLOCKS[v];
  function mul(x, y) { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z & 0xff; }
  function divisor(d) {
    const r = new Array(d - 1).fill(0).concat([1]); let rt = 1;
    for (let k = 0; k < d; k++) { for (let j = 0; j < r.length; j++) { r[j] = mul(r[j], rt); if (j + 1 < r.length) r[j] ^= r[j + 1]; } rt = mul(rt, 2); }
    return r;
  }
  function remainder(data, div) {
    const r = new Array(div.length).fill(0);
    for (const b of data) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= mul(c, f); }); }
    return r;
  }
  function alignPos(v, size) {
    if (v === 1) return [];
    const n = Math.floor(v / 7) + 2, step = Math.floor((v * 4 + n * 2 + 1) / (n * 2 - 2)) * 2;
    const r = [];
    for (let i = 0; i < n - 1; i++) r.push(size - 7 - i * step);
    r.push(6);
    return r.reverse();
  }
  function matrix(text) {
    const data = Array.from(new TextEncoder().encode(text));
    let v = 1;
    while (v <= 6 && data.length * 8 + 12 > dataCodewords(v) * 8) v++;
    if (v > 6) throw new Error('Text too long for a job tag.');
    const cap = dataCodewords(v) * 8;
    const bits = [0, 1, 0, 0];
    const push = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    push(data.length, 8); data.forEach((b) => push(b, 8));
    for (let i = 0; i < 4 && bits.length < cap; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) push(pad, 8);
    const cw = [];
    for (let i = 0; i < bits.length; i += 8) cw.push(parseInt(bits.slice(i, i + 8).join(''), 2));

    const nb = BLOCKS[v], ecl = ECC[v], raw = Math.floor(rawModules(v) / 8), nshort = nb - (raw % nb), shortlen = Math.floor(raw / nb), div = divisor(ecl);
    const blocks = [];
    for (let i = 0, k = 0; i < nb; i++) {
      const dat = cw.slice(k, k + shortlen - ecl + (i < nshort ? 0 : 1)); k += dat.length;
      const ecc = remainder(dat, div);
      if (i < nshort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    const fin = [];
    for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortlen - ecl || j >= nshort) fin.push(b[i]); });

    const size = v * 4 + 17;
    const mod = Array.from({ length: size }, () => new Array(size).fill(false));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const setf = (x, y, d) => { mod[y][x] = d; fn[y][x] = true; };
    for (let i = 0; i < size; i++) { setf(6, i, i % 2 === 0); setf(i, 6, i % 2 === 0); }
    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(([cx, cy]) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) { const d = Math.max(Math.abs(dx), Math.abs(dy)); setf(x, y, d !== 2 && d !== 4); }
      }
    });
    const pos = alignPos(v, size), last = pos.length - 1;
    pos.forEach((ax, i) => pos.forEach((ay, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setf(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));
    function format(mask) {
      const d5 = mask; let rem = d5;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const b = ((d5 << 10) | rem) ^ 0x5412, bit = (i) => ((b >>> i) & 1) === 1;
      for (let i = 0; i < 6; i++) setf(8, i, bit(i));
      setf(8, 7, bit(6)); setf(8, 8, bit(7)); setf(7, 8, bit(8));
      for (let i = 9; i < 15; i++) setf(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) setf(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) setf(8, size - 15 + i, bit(i));
      setf(8, size - 8, true);
    }
    format(0);
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
        if (!fn[y][x] && i < fin.length * 8) { mod[y][x] = ((fin[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; }
      }
    }
    const masks = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
      (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0];
    const apply = (m) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && masks[m](x, y)) mod[y][x] = !mod[y][x]; };
    function penalty() {
      let p = 0;
      const lines = mod.map((r) => r).concat(mod[0].map((_, x) => mod.map((r) => r[x])));
      for (const line of lines) {
        let run = 0, prev = null;
        for (const c of line.concat([null])) { if (c === prev) run++; else { if (run >= 5) p += 3 + run - 5; run = 1; prev = c; } }
        const s = line.map((c) => (c ? '1' : '0')).join('');
        p += 40 * ((s.split('10111010000').length - 1) + (s.split('00001011101').length - 1));
      }
      for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) { const c = mod[y][x]; if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) p += 3; }
      const dark = mod.reduce((n, r) => n + r.filter(Boolean).length, 0);
      return p + 10 * Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size));
    }
    let best = null;
    for (let m = 0; m < 8; m++) { apply(m); format(m); const sc = penalty(); if (!best || sc < best[0]) best = [sc, m]; apply(m); }
    apply(best[1]); format(best[1]);
    return mod;
  }
  function dataUrl(text, px) {
    const m = matrix(text), q = 4, s = px || 8, n = m.length + q * 2;
    const c = document.createElement('canvas'); c.width = c.height = n * s;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#000';
    m.forEach((row, y) => row.forEach((d, x) => { if (d) g.fillRect((x + q) * s, (y + q) * s, s, s); }));
    return c.toDataURL('image/png');
  }
  root.CC_QR = { matrix, dataUrl };
})(typeof window !== 'undefined' ? window : globalThis);
