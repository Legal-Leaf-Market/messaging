// The browser's QR encoder must make codes a real decoder reads, and match the Python one module for module.
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { test } from 'node:test';
globalThis.window = globalThis;
createRequire(import.meta.url)('../messaging/qr.js');
const dir = mkdtempSync(join(tmpdir(), 'qr-'));
const texts = ['PL-1004', 'https://crossroadsweddingco.shop/messaging/courier.html?order=6f1c2a9e-1111-4b2c-9d3e-123456789abc&tag=1', 'https://crossroadsweddingco.shop/messaging/courier.html?new'];
test('job tag QR codes decode and match the Python encoder', () => {
  for (const t of texts) {
    const m = window.CC_QR.matrix(t);
    const f = join(dir, 'm.json'); writeFileSync(f, JSON.stringify(m));
    const out = execFileSync('python3', ['-c', `
import json,sys,cv2
sys.path.insert(0, ${JSON.stringify(new URL('../marketing', import.meta.url).pathname)})
from PIL import Image
import qr
m=json.load(open(sys.argv[1])); n=len(m); px=10; q=4
img=Image.new('L',((n+2*q)*px,)*2,255)
for y in range(n):
  for x in range(n):
    if m[y][x]: img.paste(0,((x+q)*px,(y+q)*px,(x+q+1)*px,(y+q+1)*px))
img.save(sys.argv[1]+'.png')
d=cv2.QRCodeDetector().detectAndDecode(cv2.imread(sys.argv[1]+'.png'))[0]
_,py=qr.encode(sys.argv[2])
print(json.dumps({'decoded':d,'same':py==[[bool(c) for c in r] for r in m]}))
`, f, t], { encoding: 'utf8' });
    const r = JSON.parse(out.trim());
    assert.equal(r.decoded, t, 'decodes: ' + t);
    assert.equal(r.same, true, 'matches the Python encoder: ' + t);
  }
});
