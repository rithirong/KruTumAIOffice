# Deploy to Vercel

The Next.js frontend goes on **Vercel**, but the backend is **Convex** — which must
move from your local machine to **Convex Cloud** first. The two Python bridges
(MT5, IoT) stay local and are *not* part of the deploy.

## Prerequisites (need YOUR accounts — interactive logins)

- A free **Convex** account → https://convex.dev
- A **Vercel** account → https://vercel.com
- A **GitHub** repo (push this project), or use the `vercel` CLI.

---

## 1. Put Convex on the cloud

The app currently runs an *anonymous local* Convex backend. Move it to a real
cloud project:

```powershell
cd C:\Users\Rithirong\gemification
npx convex login                 # opens a browser
npx convex deploy                # creates/links a Convex project, pushes functions
```

Note the **Production URL** it prints (looks like `https://xxxx.convex.cloud`).

### Set the LLM keys on the cloud deployment

The keys currently live on the local deployment — copy them to production
(Convex dashboard → your project → Settings → Environment Variables, or):

```powershell
npx convex env set DEEPSEEK_API_KEY <key> --prod
npx convex env set ANTHROPIC_API_KEY <key> --prod   # optional (worksheets prefer Claude)
npx convex env set GOOGLE_GENERATIVE_AI_API_KEY <key> --prod   # optional
npx convex env set GEMINI_MODEL gemini-2.5-flash --prod        # optional
```

> Leave out `MT5_BRIDGE_URL` / `IOT_BRIDGE_URL` — those point at your local
> machine and won't be reachable from the cloud (see "What won't work" below).

### Seed the cast on production (once)

```powershell
npx convex run seed:seedAgents --prod
```
(or just click **สร้างพนักงาน** in the deployed app.)

---

## 2. Deploy the frontend on Vercel (official Convex + Vercel flow)

1. Push this repo to GitHub and **Import** it in Vercel (New Project).
2. In Convex dashboard → Settings → **Generate Production Deploy Key**.
3. In Vercel → Project → Settings → **Environment Variables**, add:
   - `CONVEX_DEPLOY_KEY` = the production deploy key.
4. In Vercel → Settings → Build & Output, **override the Build Command** with:
   ```
   npx convex deploy --cmd 'next build'
   ```
   This deploys the Convex functions **and** automatically injects the correct
   `NEXT_PUBLIC_CONVEX_URL` into the Next.js build — no manual URL copying.
5. Deploy. 🎉

(Alternatively, set `NEXT_PUBLIC_CONVEX_URL` manually in Vercel env to the
production URL from step 1, and leave the build command as the default.)

---

## What works vs. what won't on Vercel

✅ **Works** (runs in Convex cloud actions, which have internet):
- All agents, tasks, the game loop, HITL approval gate
- Tariq's gold signals (Yahoo `GC=F`) + paper trading + equity chart
- ครูตั้ม GAS material generation (DeepSeek / Claude)
- Hire-from-catalog, Thai UI, everything visual

⚠️ **Won't work from the cloud** (they call `http://127.0.0.1` on *your* machine):
- Tariq's **"ส่งคำสั่งจริง"** (MT5 bridge) — local only
- แม่บ้านนวล's **device on/off** (IoT bridge) — local only

These are local-hardware features by design; they show a graceful "can't connect"
message when used from the hosted site. To use them, run the app locally (the
bridges + `npx convex dev`) as during development.
