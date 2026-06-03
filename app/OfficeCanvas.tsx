"use client";

import { useEffect, useRef, useState } from "react";
import { Application, Container, Graphics, Text, TextStyle } from "pixi.js";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";

const TILE = 48;
const COLS = 14;
const ROWS = 11;
const W = COLS * TILE;
const H = ROWS * TILE;

// Room cards in tile coords [x, y, w, h] + label, icon and floor tint.
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

// Cartoon accessory per role.
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
  avatar: Container; // bobbing group (shadow stays put)
  body: Graphics;
  ring: Graphics;
  accessory: Text;
  bubble: Container;
  bubbleText: Text;
  targetX: number;
  targetY: number;
  phase: number;
};

export function OfficeCanvas() {
  const agents = useQuery(api.agents.list);
  const hostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const spritesRef = useRef<Map<string, Sprite>>(new Map());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let disposed = false;
    const app = new Application();

    (async () => {
      await app.init({ width: W, height: H, background: 0x0b0d13, antialias: true });
      if (disposed) {
        app.destroy(true);
        return;
      }
      appRef.current = app;
      hostRef.current?.appendChild(app.canvas);

      drawFloor(app);
      setReady(true);

      // Move toward target tile + gentle idle bob.
      app.ticker.add((ticker) => {
        const t = (app.ticker.lastTime ?? 0) / 380;
        for (const s of spritesRef.current.values()) {
          s.container.x += (s.targetX - s.container.x) * 0.15;
          s.container.y += (s.targetY - s.container.y) * 0.15;
          s.avatar.y = Math.sin(t + s.phase) * 1.8;
          void ticker;
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
    if (!app || !agents) return;

    const seen = new Set<string>();
    for (const a of agents) {
      seen.add(a._id);
      const px = a.x * TILE + TILE / 2;
      const py = a.y * TILE + TILE / 2;
      let s = spritesRef.current.get(a._id);
      if (!s) {
        s = createSprite(a);
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

function drawFloor(app: Application) {
  const g = new Graphics();
  g.rect(0, 0, W, H).fill(0x12141c);

  // Soft tile dots instead of a harsh grid.
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      g.circle(c * TILE + TILE / 2, r * TILE + TILE / 2, 1.1);
    }
  }
  g.fill({ color: 0xffffff, alpha: 0.04 });

  // Rounded room cards.
  for (const room of ROOMS) {
    const [x, y, w, h] = room.rect;
    g.roundRect(x * TILE + 3, y * TILE + 3, w * TILE - 6, h * TILE - 6, 14)
      .fill({ color: room.color })
      .stroke({ color: 0xffffff, width: 1.5, alpha: 0.08 });
  }
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

function createSprite(a: Doc<"agents">): Sprite {
  const container = new Container();

  // Ground shadow (does not bob).
  const shadow = new Graphics();
  shadow.ellipse(0, 13, 12, 4).fill({ color: 0x000000, alpha: 0.35 });
  container.addChild(shadow);

  // Status ring under the feet (does not bob).
  const ring = new Graphics();
  container.addChild(ring);

  // Bobbing avatar group.
  const avatar = new Container();
  const body = new Graphics();
  avatar.addChild(body);

  const accessory = new Text({
    text: "",
    style: new TextStyle({ fontSize: 13, fontFamily: "Tahoma, sans-serif" }),
  });
  accessory.anchor.set(0.5);
  accessory.position.set(9, -22);
  avatar.addChild(accessory);
  container.addChild(avatar);

  // Name plate.
  const name = new Text({
    text: a.name,
    style: new TextStyle({ fill: 0xe5e9f0, fontSize: 11, fontFamily: "Tahoma, sans-serif" }),
  });
  name.anchor.set(0.5, 0);
  name.y = 18;
  const namePlate = new Graphics();
  namePlate
    .roundRect(-name.width / 2 - 5, 17, name.width + 10, 15, 7)
    .fill({ color: 0x000000, alpha: 0.4 });
  container.addChild(namePlate);
  container.addChild(name);

  // Speech bubble.
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
  bubble.y = -42;
  container.addChild(bubble);

  return {
    container,
    avatar,
    body,
    ring,
    accessory,
    bubble,
    bubbleText,
    targetX: 0,
    targetY: 0,
    phase: Math.random() * Math.PI * 2,
  };
}

function lighten(hex: number, amt: number): number {
  const r = Math.min(255, ((hex >> 16) & 0xff) + amt);
  const g = Math.min(255, ((hex >> 8) & 0xff) + amt);
  const b = Math.min(255, (hex & 0xff) + amt);
  return (r << 16) | (g << 8) | b;
}

function paintStatus(s: Sprite, a: Doc<"agents">) {
  const color = parseInt(a.color.replace("#", "0x"));
  const ringColor = STATUS_RING[a.status] ?? 0x64748b;

  // Status ring on the floor.
  s.ring.clear();
  s.ring.ellipse(0, 13, 13, 5).stroke({ color: ringColor, width: 2, alpha: 0.9 });

  // Cartoon body: torso + head + eyes + smile.
  const b = s.body;
  b.clear();
  // torso
  b.roundRect(-9, -3, 18, 17, 7).fill({ color });
  b.roundRect(-9, -3, 18, 17, 7).stroke({ color: lighten(color, 30), width: 1 });
  // head
  b.circle(0, -13, 8).fill({ color: 0xffe0bd });
  b.circle(0, -13, 8).stroke({ color: 0xe8c8a0, width: 1 });
  // hair cap (tinted by role color)
  b.arc(0, -13, 8, Math.PI, 0).fill({ color: lighten(color, -10) });
  // eyes
  b.circle(-3, -13, 1.4).fill({ color: 0x222222 });
  b.circle(3, -13, 1.4).fill({ color: 0x222222 });
  // smile
  b.arc(0, -11, 3.2, 0.15 * Math.PI, 0.85 * Math.PI).stroke({ color: 0x9a6a4a, width: 1 });

  // Role accessory emoji.
  s.accessory.text = ROLE_ICON[a.role] ?? "🙂";

  // Speech bubble.
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
    s.bubble.y = -(h + 20);
    s.bubble.visible = true;
  } else {
    s.bubble.visible = false;
  }
}
