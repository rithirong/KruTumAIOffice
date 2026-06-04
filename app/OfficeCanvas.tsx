"use client";

import { useEffect, useRef, useState } from "react";
import {
  Application,
  AnimatedSprite,
  Assets,
  Container,
  Graphics,
  Rectangle,
  Text,
  Texture,
  TextStyle,
} from "pixi.js";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";

const TILE = 48;
const COLS = 14;
const ROWS = 11;
const W = COLS * TILE;
const H = ROWS * TILE;
const F = 64; // sprite frame size in the sheets
const DIRS = ["down", "up", "left", "right"] as const;
type Dir = (typeof DIRS)[number];
type Frames = { base: Record<Dir, Texture[]>; shirt: Record<Dir, Texture[]> };

const ROOMS: {
  key: string;
  rect: [number, number, number, number];
  label: string;
  icon: string;
  color: number;
}[] = [
  { key: "meeting_room", rect: [4, 1, 6, 3], label: "ห้องประชุม", icon: "🤝", color: 0x2c2647 },
  { key: "classroom", rect: [11, 1, 3, 3], label: "ห้องเรียน", icon: "🎓", color: 0x3c2640 },
  { key: "dev_room", rect: [1, 6, 5, 4], label: "ห้องพัฒนา", icon: "💻", color: 0x16293f },
  { key: "trading_floor", rect: [8, 6, 5, 4], label: "ห้องเทรด", icon: "📈", color: 0x163528 },
];

const ROLE_ICON: Record<string, string> = {
  CEO: "👑",
  Developer: "💻",
  Trader: "📈",
  Analyst: "📊",
  Educator: "📚",
  Housekeeper: "🧹",
  Staff: "💼",
};

const STATUS_RING: Record<string, number> = {
  idle: 0x64748b,
  thinking: 0xfbbf24,
  working: 0x34d399,
  in_meeting: 0x60a5fa,
};

type Sprite = {
  container: Container;
  base: AnimatedSprite;
  shirt: AnimatedSprite;
  ring: Graphics;
  accessory: Text;
  bubble: Container;
  bubbleText: Text;
  targetX: number;
  targetY: number;
  dir: Dir;
};

function sliceDirs(tex: Texture): Record<Dir, Texture[]> {
  tex.source.scaleMode = "nearest";
  const out = {} as Record<Dir, Texture[]>;
  DIRS.forEach((d, r) => {
    out[d] = [0, 1, 2, 3].map(
      (c) => new Texture({ source: tex.source, frame: new Rectangle(c * F, r * F, F, F) }),
    );
  });
  return out;
}

export function OfficeCanvas() {
  const agents = useQuery(api.agents.list);
  const hostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const framesRef = useRef<Frames | null>(null);
  const spritesRef = useRef<Map<string, Sprite>>(new Map());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    const app = new Application();

    (async () => {
      await app.init({ width: W, height: H, background: 0x0b0d13, antialias: false });
      const [baseTex, shirtTex] = await Promise.all([
        Assets.load<Texture>("/sprites/agent-base.png"),
        Assets.load<Texture>("/sprites/agent-shirt.png"),
      ]);
      if (disposed) {
        app.destroy(true);
        return;
      }
      framesRef.current = { base: sliceDirs(baseTex), shirt: sliceDirs(shirtTex) };

      appRef.current = app;
      hostRef.current?.appendChild(app.canvas);
      drawFloor(app);
      setReady(true);

      app.ticker.add(() => {
        for (const s of spritesRef.current.values()) {
          const dx = s.targetX - s.container.x;
          const dy = s.targetY - s.container.y;
          s.container.x += dx * 0.14;
          s.container.y += dy * 0.14;
          const moving = Math.hypot(dx, dy) > 0.6;
          if (moving) {
            const dir: Dir =
              Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
            if (dir !== s.dir && framesRef.current) {
              s.dir = dir;
              s.base.textures = framesRef.current.base[dir];
              s.shirt.textures = framesRef.current.shirt[dir];
              s.base.gotoAndPlay(0);
              s.shirt.gotoAndPlay(0);
            }
            if (!s.base.playing) {
              s.base.play();
              s.shirt.play();
            }
          } else if (s.base.playing) {
            s.base.gotoAndStop(0);
            s.shirt.gotoAndStop(0);
          }
        }
      });
    })();

    return () => {
      disposed = true;
      spritesRef.current.clear();
      setReady(false);
      if (appRef.current) {
        appRef.current.destroy(true, { children: true });
        appRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const app = appRef.current;
    const frames = framesRef.current;
    if (!app || !frames || !agents) return;

    const seen = new Set<string>();
    for (const a of agents) {
      seen.add(a._id);
      const px = a.x * TILE + TILE / 2;
      const py = a.y * TILE + TILE / 2;
      let s = spritesRef.current.get(a._id);
      if (!s) {
        s = createSprite(a, frames);
        s.container.x = px;
        s.container.y = py;
        app.stage.addChild(s.container);
        spritesRef.current.set(a._id, s);
      }
      s.targetX = px;
      s.targetY = py;
      paintStatus(s, a);
    }

    for (const [id, s] of spritesRef.current) {
      if (!seen.has(id)) {
        s.container.destroy({ children: true });
        spritesRef.current.delete(id);
      }
    }
  }, [agents, ready]);

  return (
    <div
      ref={hostRef}
      style={{ width: W, height: H }}
      className="rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/10"
    />
  );
}

function deskWithMonitor(g: Graphics, cx: number, cy: number, screen: number) {
  g.roundRect(cx - 17, cy - 6, 34, 13, 3).fill({ color: 0x2a2f44 }).stroke({ color: 0x3c4258, width: 1, alpha: 0.6 });
  g.roundRect(cx - 8, cy - 16, 16, 11, 2).fill({ color: 0x0e121c });
  g.roundRect(cx - 6, cy - 14, 12, 7, 1).fill({ color: screen, alpha: 0.85 });
  g.circle(cx, cy + 11, 3).fill({ color: 0x242a3c });
}

function drawFloor(app: Application) {
  const g = new Graphics();
  g.rect(0, 0, W, H).fill(0x12141c);
  for (let c = 0; c < COLS; c++)
    for (let r = 0; r < ROWS; r++) g.circle(c * TILE + TILE / 2, r * TILE + TILE / 2, 1.1);
  g.fill({ color: 0xffffff, alpha: 0.04 });

  for (const room of ROOMS) {
    const [x, y, w, h] = room.rect;
    g.roundRect(x * TILE + 3, y * TILE + 3, w * TILE - 6, h * TILE - 6, 14)
      .fill({ color: room.color })
      .stroke({ color: 0xffffff, width: 1.5, alpha: 0.08 });
  }

  g.roundRect(5.2 * TILE, 1.9 * TILE, 3.6 * TILE, 1.1 * TILE, 8).fill({ color: 0x39314f });
  for (let i = 0; i < 4; i++) {
    g.circle((5.6 + i * 0.9) * TILE, 1.6 * TILE, 5).fill({ color: 0x2a2440 });
    g.circle((5.6 + i * 0.9) * TILE, 3.3 * TILE, 5).fill({ color: 0x2a2440 });
  }
  g.roundRect(11.3 * TILE, 1.3 * TILE, 2.4 * TILE, 0.45 * TILE, 3).fill({ color: 0xe8edf5 }).stroke({ color: 0x9aa3b5, width: 1 });
  deskWithMonitor(g, 12.5 * TILE, 3.1 * TILE, 0xec4899);
  deskWithMonitor(g, 2.3 * TILE, 7.4 * TILE, 0x3b82f6);
  deskWithMonitor(g, 4.4 * TILE, 7.4 * TILE, 0x22c55e);
  deskWithMonitor(g, 2.3 * TILE, 9.2 * TILE, 0x8b5cf6);
  deskWithMonitor(g, 9.4 * TILE, 7.4 * TILE, 0x16a34a);
  deskWithMonitor(g, 11.6 * TILE, 7.4 * TILE, 0xef4444);
  deskWithMonitor(g, 10.5 * TILE, 9.2 * TILE, 0xeab308);

  app.stage.addChild(g);

  for (const room of ROOMS) {
    const [x, y] = room.rect;
    const label = new Text({
      text: `${room.icon} ${room.label}`,
      style: new TextStyle({ fill: 0xaab2c5, fontSize: 12, fontFamily: "Tahoma, sans-serif" }),
    });
    label.x = x * TILE + 10;
    label.y = y * TILE + 9;
    app.stage.addChild(label);
  }
}

function createSprite(a: Doc<"agents">, frames: Frames): Sprite {
  const container = new Container();

  const shadow = new Graphics();
  shadow.ellipse(0, 3, 12, 4).fill({ color: 0x000000, alpha: 0.35 });
  container.addChild(shadow);

  const ring = new Graphics();
  container.addChild(ring);

  const base = new AnimatedSprite(frames.base.down);
  const shirt = new AnimatedSprite(frames.shirt.down);
  for (const sp of [base, shirt]) {
    sp.anchor.set(0.5, 0.95);
    sp.scale.set(0.62);
    sp.animationSpeed = 0.16;
    container.addChild(sp);
  }

  const accessory = new Text({
    text: "",
    style: new TextStyle({ fontSize: 13, fontFamily: "Tahoma, sans-serif" }),
  });
  accessory.anchor.set(0.5);
  accessory.position.set(12, -34);
  container.addChild(accessory);

  const name = new Text({
    text: a.name,
    style: new TextStyle({ fill: 0xe5e9f0, fontSize: 11, fontFamily: "Tahoma, sans-serif" }),
  });
  name.anchor.set(0.5, 0);
  name.y = 8;
  const namePlate = new Graphics();
  namePlate.roundRect(-name.width / 2 - 5, 7, name.width + 10, 15, 7).fill({ color: 0x000000, alpha: 0.45 });
  container.addChild(namePlate);
  container.addChild(name);

  const bubble = new Container();
  const bubbleBg = new Graphics();
  const bubbleText = new Text({
    text: "",
    style: new TextStyle({
      fill: 0x111111,
      fontSize: 10,
      fontFamily: "Tahoma, sans-serif",
      wordWrap: true,
      wordWrapWidth: 150,
      breakWords: true,
      lineHeight: 14,
    }),
  });
  bubbleText.y = 6;
  bubble.addChild(bubbleBg);
  bubble.addChild(bubbleText);
  bubble.visible = false;
  container.addChild(bubble);

  return { container, base, shirt, ring, accessory, bubble, bubbleText, targetX: 0, targetY: 0, dir: "down" };
}

function paintStatus(s: Sprite, a: Doc<"agents">) {
  s.shirt.tint = parseInt(a.color.replace("#", "0x")); // only the shirt is tinted
  const ringColor = STATUS_RING[a.status] ?? 0x64748b;
  s.ring.clear();
  s.ring.ellipse(0, 3, 13, 5).stroke({ color: ringColor, width: 2, alpha: 0.9 });

  s.accessory.text = ROLE_ICON[a.role] ?? "🙂";

  if (a.speech && a.speech.length > 0) {
    const text = a.speech.length > 100 ? a.speech.slice(0, 99) + "…" : a.speech;
    s.bubbleText.text = text;
    const padX = 8;
    const padY = 6;
    const w = s.bubbleText.width + padX * 2;
    const h = s.bubbleText.height + padY * 2;
    s.bubbleText.x = -w / 2 + padX;
    const bg = s.bubble.getChildAt(0) as Graphics;
    bg.clear();
    bg.roundRect(-w / 2, 0, w, h, 8).fill(0xffffff);
    bg.moveTo(-4, h).lineTo(4, h).lineTo(0, h + 6).fill(0xffffff);
    s.bubble.y = -(h + 44);
    s.bubble.visible = true;
  } else {
    s.bubble.visible = false;
  }
}
