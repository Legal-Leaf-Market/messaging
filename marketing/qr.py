"""Minimal QR Code encoder: byte mode, error correction level M, versions 1 to 6.
Follows the ISO 18004 construction (same steps as Nayuki's reference encoder).
Usage: python3 qr.py "<text>" out.png [module_px]"""
import sys
from PIL import Image

ECC_PER_BLOCK_M = [None, 10, 16, 26, 18, 24, 16]
NUM_BLOCKS_M = [None, 1, 1, 1, 2, 2, 4]


def raw_modules(ver):
    r = (16 * ver + 128) * ver + 64
    if ver >= 2:
        n = ver // 7 + 2
        r -= (25 * n - 10) * n - 55
    return r


def data_codewords(ver):
    return raw_modules(ver) // 8 - ECC_PER_BLOCK_M[ver] * NUM_BLOCKS_M[ver]


def gf_mul(x, y):
    z = 0
    for i in reversed(range(8)):
        z = (z << 1) ^ ((z >> 7) * 0x11D)
        z ^= ((y >> i) & 1) * x
    return z & 0xFF


def rs_divisor(degree):
    res = [0] * (degree - 1) + [1]
    root = 1
    for _ in range(degree):
        for j in range(len(res)):
            res[j] = gf_mul(res[j], root)
            if j + 1 < len(res):
                res[j] ^= res[j + 1]
        root = gf_mul(root, 0x02)
    return res


def rs_remainder(data, div):
    res = [0] * len(div)
    for b in data:
        factor = b ^ res.pop(0)
        res.append(0)
        for i, coef in enumerate(div):
            res[i] ^= gf_mul(coef, factor)
    return res


def align_positions(ver, size):
    if ver == 1:
        return []
    n = ver // 7 + 2
    step = (ver * 4 + n * 2 + 1) // (n * 2 - 2) * 2
    res = [size - 7 - i * step for i in range(n - 1)] + [6]
    return list(reversed(res))


def encode(text):
    data = text.encode('utf-8')
    for ver in range(1, 7):
        if len(data) * 8 + 4 + 8 <= data_codewords(ver) * 8:
            break
    else:
        raise ValueError('text too long for this encoder')
    cap = data_codewords(ver) * 8
    bits = [0, 1, 0, 0] + [(len(data) >> i) & 1 for i in reversed(range(8))]
    for b in data:
        bits += [(b >> i) & 1 for i in reversed(range(8))]
    bits += [0] * min(4, cap - len(bits))
    bits += [0] * (-len(bits) % 8)
    pad = 0xEC
    while len(bits) < cap:
        bits += [(pad >> i) & 1 for i in reversed(range(8))]
        pad ^= 0xEC ^ 0x11
    codewords = [int(''.join(map(str, bits[i:i + 8])), 2) for i in range(0, len(bits), 8)]

    # Split into blocks, add Reed-Solomon codewords, interleave.
    nb, ecl = NUM_BLOCKS_M[ver], ECC_PER_BLOCK_M[ver]
    raw = raw_modules(ver) // 8
    nshort = nb - raw % nb
    shortlen = raw // nb
    div = rs_divisor(ecl)
    blocks, k = [], 0
    for i in range(nb):
        dat = codewords[k:k + shortlen - ecl + (0 if i < nshort else 1)]
        k += len(dat)
        ecc = rs_remainder(dat, div)
        if i < nshort:
            dat = dat + [0]
        blocks.append(dat + ecc)
    final = []
    for i in range(len(blocks[0])):
        for j, blk in enumerate(blocks):
            if i != shortlen - ecl or j >= nshort:
                final.append(blk[i])
    assert len(final) == raw

    size = ver * 4 + 17
    mod = [[False] * size for _ in range(size)]
    fn = [[False] * size for _ in range(size)]

    def setf(x, y, dark):
        mod[y][x] = dark
        fn[y][x] = True

    for i in range(size):
        setf(6, i, i % 2 == 0)
        setf(i, 6, i % 2 == 0)
    for cx, cy in ((3, 3), (size - 4, 3), (3, size - 4)):
        for dy in range(-4, 5):
            for dx in range(-4, 5):
                x, y = cx + dx, cy + dy
                if 0 <= x < size and 0 <= y < size:
                    setf(x, y, max(abs(dx), abs(dy)) not in (2, 4))
    pos = align_positions(ver, size)
    last = len(pos) - 1
    for i, ax in enumerate(pos):
        for j, ay in enumerate(pos):
            if (i == 0 and j == 0) or (i == 0 and j == last) or (i == last and j == 0):
                continue
            for dy in range(-2, 3):
                for dx in range(-2, 3):
                    setf(ax + dx, ay + dy, max(abs(dx), abs(dy)) != 1)

    def draw_format(mask):
        data5 = (0 << 3) | mask  # level M is 00
        rem = data5
        for _ in range(10):
            rem = (rem << 1) ^ ((rem >> 9) * 0x537)
        b = (data5 << 10 | rem) ^ 0x5412
        bit = lambda i: (b >> i) & 1 == 1
        for i in range(0, 6):
            setf(8, i, bit(i))
        setf(8, 7, bit(6))
        setf(8, 8, bit(7))
        setf(7, 8, bit(8))
        for i in range(9, 15):
            setf(14 - i, 8, bit(i))
        for i in range(0, 8):
            setf(size - 1 - i, 8, bit(i))
        for i in range(8, 15):
            setf(8, size - 15 + i, bit(i))
        setf(8, size - 8, True)

    draw_format(0)  # reserve the area before placing data

    i, right = 0, size - 1
    while right >= 1:
        if right == 6:
            right = 5
        for vert in range(size):
            for j in range(2):
                x = right - j
                upward = ((right + 1) & 2) == 0
                y = size - 1 - vert if upward else vert
                if not fn[y][x] and i < len(final) * 8:
                    mod[y][x] = (final[i >> 3] >> (7 - (i & 7))) & 1 == 1
                    i += 1
        right -= 2

    masks = [
        lambda x, y: (x + y) % 2 == 0, lambda x, y: y % 2 == 0, lambda x, y: x % 3 == 0,
        lambda x, y: (x + y) % 3 == 0, lambda x, y: (x // 3 + y // 2) % 2 == 0,
        lambda x, y: x * y % 2 + x * y % 3 == 0, lambda x, y: (x * y % 2 + x * y % 3) % 2 == 0,
        lambda x, y: ((x + y) % 2 + x * y % 3) % 2 == 0,
    ]

    def apply(m):
        for y in range(size):
            for x in range(size):
                if not fn[y][x] and masks[m](x, y):
                    mod[y][x] = not mod[y][x]

    def penalty():
        p = 0
        lines = [mod[y] for y in range(size)] + [[mod[y][x] for y in range(size)] for x in range(size)]
        for line in lines:
            run, prev = 0, None
            for c in line + [None]:
                if c == prev:
                    run += 1
                else:
                    if run >= 5:
                        p += 3 + run - 5
                    run, prev = 1, c
            s = ''.join('1' if c else '0' for c in line)
            p += 40 * (s.count('10111010000') + s.count('00001011101'))
        for y in range(size - 1):
            for x in range(size - 1):
                c = mod[y][x]
                if c == mod[y][x + 1] == mod[y + 1][x] == mod[y + 1][x + 1]:
                    p += 3
        dark = sum(sum(r) for r in mod)
        p += 10 * (abs(dark * 20 - size * size * 10) // (size * size))
        return p

    best = None
    for m in range(8):
        apply(m)
        draw_format(m)
        score = penalty()
        if best is None or score < best[0]:
            best = (score, m)
        apply(m)  # undo
    apply(best[1])
    draw_format(best[1])
    return ver, mod


def save_png(mod, path, px=20, quiet=4):
    n = len(mod)
    img = Image.new('L', ((n + 2 * quiet) * px,) * 2, 255)
    for y in range(n):
        for x in range(n):
            if mod[y][x]:
                img.paste(0, ((x + quiet) * px, (y + quiet) * px, (x + quiet + 1) * px, (y + quiet + 1) * px))
    img.convert('1').save(path)


if __name__ == '__main__':
    text, out = sys.argv[1], sys.argv[2]
    px = int(sys.argv[3]) if len(sys.argv) > 3 else 20
    ver, mod = encode(text)
    save_png(mod, out, px)
    print(f'version {ver}, {len(mod)}x{len(mod)} modules -> {out}')
