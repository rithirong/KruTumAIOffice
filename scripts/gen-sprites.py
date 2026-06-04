"""Generate a tiny pixel-art character spritesheet (white + outline so it can be
tinted per agent). 4 rows = down/up/left/right, 4 cols = walk frames.
Logical 16x16 per frame, upscaled x3 (nearest) -> 48x48. Output: public/sprites/agent.png
Run: py scripts/gen-sprites.py
"""
from PIL import Image, ImageDraw
import os

LOGICAL = 16
SCALE = 3
FRAME = LOGICAL * SCALE  # 48
DIRS = ["down", "up", "left", "right"]
FRAMES = 4

W = (255, 255, 255, 255)   # body — gets tinted
K = (24, 24, 32, 255)      # outline / eyes — stays dark under tint
SH = (210, 210, 220, 255)  # subtle shade


def leg_boxes(frame):
    # alternate a "spread" stance to read as walking
    if frame == 1:
        return [(4, 13, 5, 15), (10, 13, 11, 15)]
    if frame == 3:
        return [(6, 13, 7, 15), (8, 13, 9, 15)]
    return [(5, 13, 6, 15), (9, 13, 10, 15)]


def draw_frame(dirn, frame):
    img = Image.new("RGBA", (LOGICAL, LOGICAL), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # arms
    d.rectangle([3, 7, 4, 11], fill=W, outline=K)
    d.rectangle([11, 7, 12, 11], fill=W, outline=K)
    # body
    d.rectangle([5, 7, 10, 12], fill=W, outline=K)
    d.line([6, 12, 9, 12], fill=SH)
    # legs
    for box in leg_boxes(frame):
        d.rectangle(box, fill=W, outline=K)
    # head
    d.ellipse([4, 1, 11, 7], fill=W, outline=K)

    # face by direction
    if dirn == "down":
        img.putpixel((6, 4), K)
        img.putpixel((9, 4), K)
    elif dirn == "left":
        img.putpixel((6, 4), K)
    elif dirn == "right":
        img.putpixel((9, 4), K)
    # up: back of head, no eyes

    return img.resize((FRAME, FRAME), Image.NEAREST)


def main():
    sheet = Image.new("RGBA", (FRAME * FRAMES, FRAME * len(DIRS)), (0, 0, 0, 0))
    for r, dirn in enumerate(DIRS):
        for c in range(FRAMES):
            sheet.paste(draw_frame(dirn, c), (c * FRAME, r * FRAME))
    out_dir = os.path.join(os.path.dirname(__file__), "..", "public", "sprites")
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, "agent.png")
    sheet.save(out)
    print(f"wrote {out}  ({sheet.width}x{sheet.height}, frame={FRAME})")


if __name__ == "__main__":
    main()
