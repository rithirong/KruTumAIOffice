"""Generate detailed 64px pixel-art character sprites as TWO aligned sheets:
  - public/sprites/agent-base.png   skin/hair/face/pants/shoes/outline (NOT tinted)
  - public/sprites/agent-shirt.png  the shirt only, white (tinted per agent)
Stacking base + tinted shirt gives a real little person whose shirt is each
agent's colour while skin/hair stay natural.

Layout: 4 rows (down, up, left, right) x 4 walk frames. Logical 32x32, x2 -> 64.
Run: py scripts/gen-sprites.py
"""
from PIL import Image, ImageDraw
import os

L = 32          # logical frame
S = 2           # upscale
F = L * S       # 64
DIRS = ["down", "up", "left", "right"]
NF = 4

OUT = (28, 28, 38, 255)
SKIN = (242, 198, 140, 255)
SKIN_SH = (214, 165, 112, 255)
HAIR = (70, 48, 34, 255)
HAIR_SH = (52, 34, 24, 255)
PANTS = (58, 64, 86, 255)
PANTS_SH = (44, 49, 68, 255)
SHOE = (36, 36, 46, 255)
SHIRT = (255, 255, 255, 255)
SHIRT_SH = (222, 222, 230, 255)
NONE = (0, 0, 0, 0)


def new():
    img = Image.new("RGBA", (L, L), NONE)
    return img, ImageDraw.Draw(img)


def legs(d, f):
    # returns (left_leg_box, right_leg_box) y-extent varies to fake a step
    base_top = 23
    ll = [12, base_top, 15, 31]
    rl = [17, base_top, 20, 31]
    if f == 1:
        rl[1] = base_top + 2  # right leg lifted
    elif f == 3:
        ll[1] = base_top + 2  # left leg lifted
    return ll, rl


def draw_base(d, f):
    img, g = new()
    bob = -1 if f in (1, 3) else 0
    y = lambda v: v + bob

    ll, rl = legs(d, f)
    # legs (pants) + shoes
    for box in (ll, rl):
        g.rectangle([box[0], box[1], box[2], box[3] - 2], fill=PANTS, outline=OUT)
        g.rectangle([box[0], box[3] - 2, box[2], box[3]], fill=SHOE, outline=OUT)
    g.rectangle([rl[0] + 1, rl[1], rl[2], rl[3] - 2], fill=PANTS_SH)  # subtle leg shade

    # hands (skin) — arms hang beside the torso; sleeves are on the shirt sheet
    g.rectangle([8, y(17), 10, y(21)], fill=SKIN, outline=OUT)
    g.rectangle([22, y(17), 24, y(21)], fill=SKIN, outline=OUT)

    # head
    g.ellipse([10, y(4), 22, y(15)], fill=SKIN, outline=OUT)
    g.ellipse([17, y(6), 22, y(14)], fill=SKIN_SH)  # cheek shade
    # hair
    if d == "up":
        g.chord([10, y(3), 22, y(16)], 200, 340, fill=HAIR, outline=OUT)  # full back of head
        g.ellipse([10, y(4), 22, y(12)], fill=HAIR)
    else:
        g.pieslice([10, y(3), 22, y(15)], 180, 360, fill=HAIR, outline=OUT)
        g.ellipse([10, y(3), 22, y(9)], fill=HAIR)
        g.rectangle([19, y(5), 21, y(9)], fill=HAIR_SH)

    # face
    if d == "down":
        g.rectangle([13, y(9), 14, y(10)], fill=OUT)
        g.rectangle([18, y(9), 19, y(10)], fill=OUT)
        g.line([15, y(12), 17, y(12)], fill=SKIN_SH)
    elif d == "left":
        g.rectangle([12, y(9), 13, y(10)], fill=OUT)
    elif d == "right":
        g.rectangle([19, y(9), 20, y(10)], fill=OUT)

    return img.resize((F, F), Image.NEAREST)


def draw_shirt(d, f):
    img, g = new()
    bob = -1 if f in (1, 3) else 0
    y = lambda v: v + bob
    # torso
    g.rectangle([11, y(14), 21, y(23)], fill=SHIRT, outline=OUT)
    # sleeves over the upper arms
    g.rectangle([8, y(14), 11, y(18)], fill=SHIRT, outline=OUT)
    g.rectangle([21, y(14), 24, y(18)], fill=SHIRT, outline=OUT)
    # subtle right-side shade so the tint reads as 3D
    g.rectangle([18, y(15), 20, y(22)], fill=SHIRT_SH)
    g.rectangle([22, y(15), 23, y(17)], fill=SHIRT_SH)
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
    build(draw_base).save(os.path.join(out_dir, "agent-base.png"))
    build(draw_shirt).save(os.path.join(out_dir, "agent-shirt.png"))
    print(f"wrote agent-base.png + agent-shirt.png ({F*NF}x{F*len(DIRS)}, frame={F})")


if __name__ == "__main__":
    main()
