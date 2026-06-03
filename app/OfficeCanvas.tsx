"use client";

import { useEffect, useRef, useState } from "react";
import {
  Application,
  Container,
  Graphics,
  Text,
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

// Room rectangles in tile coordinates [x, y, w, h] + label + floor tint.
const ROOMS: { key: string; rect: [number, number, number, number]; label: string; color: number }[] = [
  { key: "meeting_room", rect: [4, 1, 6, 3], label: "ห้องประชุม", color: 0x2a2440 },
  { key: "classroom", rect: [11, 1, 3, 3], label: "ห้องเรียน", color: 0x3a2433 },
  { key: "dev_room", rect: [1, 6, 5, 4], label: "ห้องพัฒนา", color: 0x16263a },
  { key: "trading_floor", rect: [8, 6, 5, 4], label: "ห้องเทรด", color: 0x16302a },
];

// One visual unit per agent: a container we lerp toward its target tile.
type Sprite = {
  container: Container;
  body: Graphics;
  bubble: Container;
  bubbleText: Text;
  targetX: number;
  targetY: number;
};

export function OfficeCanvas() {
  const agents = useQuery(api.agents.list);
  const hostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const spritesRef = useRef<Map<string, Sprite>>(new Map());
  // Flips true once Pixi's async init finishes, so the reconcile effect re-runs
  // even if the agents query resolved before the canvas was ready.
  const [ready, setReady] = useState(false);

  // Boot Pixi once.
  useEffect(() => {
    let disposed = false;
    const app = new Application();

    (async () => {
      await app.init({ width: W, height: H, background: 0x0e1016, antialias: true });
      if (disposed) {
        app.destroy(true);
        return;
      }
      appRef.current = app;
      hostRef.current?.appendChild(app.canvas);

      drawFloor(app);
      setReady(true);

      // Smoothly move every sprite toward its target tile each frame.
      app.ticker.add(() => {
        for (const s of spritesRef.current.values()) {
          s.container.x += (s.targetX - s.container.x) * 0.15;
          s.container.y += (s.targetY - s.container.y) * 0.15;
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

  // Reconcile sprites whenever the agents query updates.
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

    // Remove sprites for agents that disappeared.
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
      className="rounded-lg overflow-hidden shadow-2xl ring-1 ring-white/10"
    />
  );
}

function drawFloor(app: Application) {
  const floor = new Graphics();
  // Base floor.
  floor.rect(0, 0, W, H).fill(0x1a1d27);

  // Rooms.
  for (const r of ROOMS) {
    const [x, y, w, h] = r.rect;
    floor
      .rect(x * TILE, y * TILE, w * TILE, h * TILE)
      .fill({ color: r.color })
      .stroke({ color: 0x3a3f55, width: 2 });
  }

  // Grid lines.
  for (let c = 0; c <= COLS; c++) {
    floor.moveTo(c * TILE, 0).lineTo(c * TILE, H);
  }
  for (let rr = 0; rr <= ROWS; rr++) {
    floor.moveTo(0, rr * TILE).lineTo(W, rr * TILE);
  }
  floor.stroke({ color: 0xffffff, width: 1, alpha: 0.04 });
  app.stage.addChild(floor);

  // Room labels.
  for (const r of ROOMS) {
    const [x, y] = r.rect;
    const label = new Text({
      text: r.label,
      style: new TextStyle({ fill: 0x8b93a7, fontSize: 12, fontFamily: "Tahoma, sans-serif" }),
    });
    label.x = x * TILE + 6;
    label.y = y * TILE + 4;
    app.stage.addChild(label);
  }
}

function createSprite(a: Doc<"agents">): Sprite {
  const container = new Container();

  const body = new Graphics();
  container.addChild(body);

  const name = new Text({
    text: a.name,
    style: new TextStyle({ fill: 0xffffff, fontSize: 11, fontFamily: "Tahoma, sans-serif" }),
  });
  name.anchor.set(0.5, 0);
  name.y = 14;
  container.addChild(name);

  // Speech bubble (hidden until there is speech).
  const bubble = new Container();
  const bubbleBg = new Graphics();
  const bubbleText = new Text({
    text: "",
    // breakWords is essential for Thai: there are no spaces between words, so
    // the default whitespace word-wrap never breaks the line.
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
  bubble.y = -40;
  container.addChild(bubble);

  return { container, body, bubble, bubbleText, targetX: 0, targetY: 0 };
}

// Status ring colors.
const STATUS_RING: Record<string, number> = {
  idle: 0x4b5366,
  thinking: 0xfbbf24,
  working: 0x34d399,
  in_meeting: 0x60a5fa,
};

function paintStatus(s: Sprite, a: Doc<"agents">) {
  const color = parseInt(a.color.replace("#", "0x"));
  const ring = STATUS_RING[a.status] ?? 0x4b5366;

  s.body.clear();
  s.body.circle(0, 0, 13).fill({ color: ring }); // status ring
  s.body.circle(0, 0, 10).fill({ color });        // body

  // Speech bubble.
  if (a.speech && a.speech.length > 0) {
    // Cap length so a chatty LLM line doesn't produce a giant bubble.
    const text = a.speech.length > 100 ? a.speech.slice(0, 99) + "…" : a.speech;
    s.bubbleText.text = text;

    const padX = 8;
    const padY = 6;
    const w = s.bubbleText.width + padX * 2;
    const h = s.bubbleText.height + padY * 2;

    // Center the text horizontally inside the bubble.
    s.bubbleText.x = -w / 2 + padX;

    const bg = s.bubble.getChildAt(0) as Graphics;
    bg.clear();
    bg.roundRect(-w / 2, 0, w, h, 6).fill(0xffffff);
    // Little tail pointing down toward the agent.
    bg.moveTo(-4, h).lineTo(4, h).lineTo(0, h + 6).fill(0xffffff);

    // Float the whole bubble above the head, scaling with its height.
    s.bubble.y = -(h + 18);
    s.bubble.visible = true;
  } else {
    s.bubble.visible = false;
  }
}
