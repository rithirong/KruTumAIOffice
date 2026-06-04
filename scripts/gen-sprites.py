"""Generate detailed 64px characters as FOUR tintable layers so every agent can
have a different skin tone, hair colour and shirt colour:
  public/sprites/agent-base.png    legs / pants / shoes (fixed, NOT tinted)
  public/sprites/agent-skin.png    head + hands (white, tinted to a skin tone)
  public/sprites/agent-hair.png    hair (white, tinted to a hair colour)
  public/sprites/agent-shirt.png   shirt + sleeves (white, tinted to agent colour)
Dark outlines/eyes are baked into each layer and stay dark under tint.

Layout: 4 rows (down, up, left, right) x 4 walk frames. Logical 32x32, x2 -> 64.
Run: py scripts/gen-sprites.py
"""
from PIL import Image, ImageDraw
import os

L, S = 32, 2
F = L * S
DIRS = ["down", "up", "left", "right"]
NF = 4

OUT = (28, 28, 38, 255)
WHITE = (255, 255, 255, 255)
LSH = (224, 224, 230, 255)     # light shade (stays a slightly darker tint)
PANTS = (58, 64, 86, 255)
PANTS_SH = (44, 49, 68, 255)
SHOE = (36, 36, 46, 255)
NONE = (0, 0, 0, 0)


def canvas():
    img = Image.new("RGBA", (L, L), NONE)
    return img, ImageDraw.Draw(img), (lambda v, f: v + (-1 if f in (1, 3) else 0))


def legs(f):
    ll = [12, 23, 15, 31]
    rl = [17, 23, 20, 31]
    if f == 1:
        rl[1] = 25
    elif f == 3:
        ll[1] = 25
    return ll, rl


def draw_base(d, f):
    img, g, _ = canvas()
    ll, rl = legs(f)
    for box in (ll, rl):
        g.rectangle([box[0], box[1], box[2], box[3] - 2], fill=PANTS, outline=OUT)
        g.rectangle([box[0], box[3] - 2, box[2], box[3]], fill=SHOE, outline=OUT)
    g.rectangle([rl[0] + 1, rl[1], rl[2], rl[3] - 2], fill=PANTS_SH)
    return img.resize((F, F), Image.NEAREST)


def draw_skin(d, f):
    img, g, y = canvas()
    g.rectangle([8, y(17, f), 10, y(21, f)], fill=WHITE, outline=OUT)   # hands
    g.rectangle([22, y(17, f), 24, y(21, f)], fill=WHITE, outline=OUT)
    g.ellipse([10, y(4, f), 22, y(15, f)], fill=WHITE, outline=OUT)     # head
    g.ellipse([17, y(6, f), 22, y(14, f)], fill=LSH)                    # cheek shade
    if d == "down":
        g.rectangle([13, y(9, f), 14, y(10, f)], fill=OUT)
        g.rectangle([18, y(9, f), 19, y(10, f)], fill=OUT)
    elif d == "left":
        g.rectangle([12, y(9, f), 13, y(10, f)], fill=OUT)
    elif d == "right":
        g.rectangle([19, y(9, f), 20, y(10, f)], fill=OUT)
    return img.resize((F, F), Image.NEAREST)


def draw_hair(d, f):
    img, g, y = canvas()
    if d == "up":
        g.ellipse([10, y(3, f), 22, y(14, f)], fill=WHITE, outline=OUT)  # full back of head
        g.ellipse([12, y(5, f), 20, y(12, f)], fill=LSH)
    else:
        g.pieslice([10, y(3, f), 22, y(15, f)], 180, 360, fill=WHITE, outline=OUT)
        g.ellipse([10, y(3, f), 22, y(9, f)], fill=WHITE, outline=OUT)
        g.rectangle([19, y(5, f), 21, y(8, f)], fill=LSH)
    return img.resize((F, F), Image.NEAREST)


def draw_shirt(d, f):
    img, g, y = canvas()
    g.rectangle([11, y(14, f), 21, y(23, f)], fill=WHITE, outline=OUT)   # torso
    g.rectangle([8, y(14, f), 11, y(18, f)], fill=WHITE, outline=OUT)    # sleeves
    g.rectangle([21, y(14, f), 24, y(18, f)], fill=WHITE, outline=OUT)
    g.rectangle([18, y(15, f), 20, y(22, f)], fill=LSH)                  # shade
    return img.resize((F, F), Image.NEAREST)


def build(drawer):
    sheet = Image.new("RGBA", (F * NF, F * len(DIRS)), NONE)
    for r, d in enumerate(DIRS):
        for c in range(NF):
            sheet.paste(drawer(d, c), (c * F, r * F))
    return sheet


def main():
    out_dir = os.path.join(os.path.dirname(__file__), "..", "public", "sprites")
    os.makedirs(out_dir, exist_ok=True)
    for name, drawer in [
        ("agent-base", draw_base),
        ("agent-skin", draw_skin),
        ("agent-hair", draw_hair),
        ("agent-shirt", draw_shirt),
    ]:
        build(drawer).save(os.path.join(out_dir, f"{name}.png"))
    print(f"wrote 4 layers ({F*NF}x{F*len(DIRS)}, frame={F})")


if __name__ == "__main__":
    main()
