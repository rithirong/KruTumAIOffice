// Parses the agency-agents repo's persona markdown frontmatter into a compact
// catalog JSON the app bundles for the "hire" feature.
// Run: node scripts/build-persona-catalog.mjs <path-to-agency-agents>
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = process.argv[2] ?? "C:/Users/Rithirong/agency-agents";
const outFile = join(dirname(fileURLToPath(import.meta.url)), "..", "app", "personaCatalog.json");

const COLOR = {
  red: "#ef4444", orange: "#f97316", amber: "#f59e0b", yellow: "#eab308",
  green: "#22c55e", emerald: "#10b981", teal: "#14b8a6", cyan: "#06b6d4",
  blue: "#3b82f6", indigo: "#6366f1", violet: "#8b5cf6", purple: "#a855f7",
  pink: "#ec4899", rose: "#f43f5e", gray: "#64748b", grey: "#64748b",
};

// Folders that are agent divisions (skip docs/scripts).
const SKIP = new Set(["scripts", "examples", "integrations", ".git", ".github"]);

function parseFrontmatter(md) {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim().replace(/^["']|["']$/g, "");
    out[kv[1]] = v;
  }
  return out;
}

const catalog = [];
for (const div of readdirSync(repo)) {
  const dir = join(repo, div);
  if (SKIP.has(div) || !statSync(dir).isDirectory()) continue;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".md")) continue;
    const fm = parseFrontmatter(readFileSync(join(dir, file), "utf8"));
    if (!fm?.name) continue;
    catalog.push({
      name: fm.name,
      division: div,
      emoji: fm.emoji || "🧑‍💼",
      color: COLOR[(fm.color || "").toLowerCase()] || "#64748b",
      vibe: (fm.vibe || fm.description || "").slice(0, 160),
    });
  }
}

catalog.sort((a, b) => a.division.localeCompare(b.division) || a.name.localeCompare(b.name));
writeFileSync(outFile, JSON.stringify(catalog, null, 2));
console.log(`wrote ${catalog.length} personas across divisions to ${outFile}`);
