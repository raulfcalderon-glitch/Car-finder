import sys
from PIL import Image, ImageFilter, ImageDraw
import numpy as np
from collections import deque
SP = sys.argv[1]
src = Image.open('brand/logo-transparent.png').convert('RGBA'); arr = np.asarray(src); a = arr[..., 3] > 20
H, W = a.shape
def component(seed):
    seen = np.zeros_like(a); q = deque([seed]); seen[seed] = True
    while q:
        y, x = q.popleft()
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                ny, nx = y + dy, x + dx
                if 0 <= ny < H and 0 <= nx < W and a[ny, nx] and not seen[ny, nx]: seen[ny, nx] = True; q.append((ny, nx))
    return seen
# Every letter is its own blob between y≈200 and 368; anything else is the car.
letters = np.zeros_like(a)
for y in range(200, 369, 3):
    for x in np.where(a[y] & ~letters[y])[0]:
        if not letters[y, x]:
            comp = component((y, x)); ys = np.where(comp)[0]
            if ys.min() >= 195: letters |= comp
C = component((290, 113)); F = component((290, 716))
car = a & ~letters
def layer(mask):
    out = arr.copy(); out[..., 3] = np.where(mask, arr[..., 3], 0)
    im = Image.fromarray(out, 'RGBA'); return im.crop(im.getbbox())
carIm, cIm, fIm = layer(car), layer(C), layer(F)
print('car', carIm.size, 'C', cIm.size, 'F', fIm.size)
def thicken(im, size):
    return Image.merge('RGBA', [ch.filter(ImageFilter.MaxFilter(size)) for ch in im.split()])
def canvas(n=1024): return Image.new('RGBA', (n, n), (0, 0, 0, 255))
def cf(base, cap, top, cx=512, gap=0.16):
    s = cap / cIm.height
    c2 = cIm.resize((round(cIm.width * s), round(cIm.height * s)), Image.LANCZOS)
    f2 = fIm.resize((round(fIm.width * s), round(fIm.height * s)), Image.LANCZOS)
    total = c2.width + cap * gap + f2.width; x = cx - total / 2
    base.alpha_composite(c2, (round(x), round(top)))
    base.alpha_composite(f2, (round(x + c2.width + cap * gap), round(top + 3 * s)))
def car_on(base, width, top, thick):
    t = thicken(carIm, thick); s = width / t.width
    c = t.resize((round(t.width * s), round(t.height * s)), Image.LANCZOS)
    base.alpha_composite(c, (round(512 - c.width / 2), round(top)))
    return c.height
# A: the car over "CF"
A = canvas(); h = car_on(A, 860, 250, 9); cf(A, 330, 250 + h + 50)
# B: "CF" alone, as big as fits
B = canvas(); cf(B, 500, 262)
# C: the car alone, filling the width
Cc = canvas(); h = car_on(Cc, 940, 0, 11)
Cc = canvas(); car_on(Cc, 940, 512 - h / 2, 11)
for name, im in [('A', A), ('B', B), ('C', Cc)]: im.save(f'{SP}/icon-{name}.png')
sheet = Image.new('RGBA', (1500, 640), (222, 219, 212, 255)); d = ImageDraw.Draw(sheet)
for i, (name, im) in enumerate([('A  car + CF', A), ('B  CF only', B), ('C  car only', Cc)]):
    x0 = 90 + i * 470
    big = im.resize((300, 300), Image.LANCZOS); m = Image.new('L', (300, 300), 0); ImageDraw.Draw(m).rounded_rectangle((0, 0, 299, 299), 66, fill=255)
    sheet.paste(big, (x0, 50), m)
    d.rounded_rectangle((x0 - 20, 410, x0 + 320, 470), 12, fill=(53, 54, 58, 255))
    for j, sz in enumerate([16, 32]):
        sheet.alpha_composite(im.resize((sz, sz), Image.LANCZOS), (x0 + j * 60, 440 - sz // 2))
    sheet.alpha_composite(im.resize((64, 64), Image.LANCZOS), (x0 + 150, 500))
    d.text((x0, 372), name, fill=(20, 20, 20, 255))
sheet.save(f'{SP}/icon-options.png')
