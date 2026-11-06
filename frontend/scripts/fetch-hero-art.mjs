#!/usr/bin/env node
/**
 * Build the high-resolution hero wallpaper pack.
 *
 * The app ships 240×390 portraits so it works offline out of the box. On large
 * or high-DPI screens the wallpaper prefers `/heroes/hi/<slug>.webp` when it
 * exists, which is what this script produces from the official catalogue
 * paintings the Intel proxy already serves.
 *
 * It is opt-in and never runs during a build or deploy:
 *
 *   # from a machine that can reach your running hub
 *   CLOVER_APP_URL=https://hub.example.com \
 *   CLOVER_TOKEN=<a signed-in member's bearer token> \
 *   node frontend/scripts/fetch-hero-art.mjs
 *
 *   # or point straight at an Intel JSON dump you already saved
 *   node frontend/scripts/fetch-hero-art.mjs --catalog ./catalog.json
 *
 * Only `frontend/public/heroes/hi/*.webp` is written; existing files are kept
 * unless --force is passed. Every download is validated as WebP and must be
 * larger than the bundled portrait before it replaces anything.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(HERE, "../public/heroes");
const OUT_DIR = resolve(PUBLIC_DIR, "hi");
const MIN_WIDTH = 720;

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}
const force = process.argv.includes("--force");
const appUrl = (process.env.CLOVER_APP_URL ?? arg("app") ?? "").replace(/\/$/, "");
const token = process.env.CLOVER_TOKEN ?? "";
const catalogPath = arg("catalog");

/** Same slug rule as src/lib/mlbb.ts (`heroSlug`) so files line up with the app. */
function slugify(name) {
  return name
    .toLowerCase()
    .replace(/['’]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join("-");
}

function webpSize(bytes) {
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") return null;
  const chunk = bytes.toString("ascii", 12, 16);
  if (chunk === "VP8 ") {
    const bits = bytes.readUInt16LE(26) & 0x3fff;
    return { width: bits, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === "VP8L") {
    const b = bytes.subarray(21, 26);
    return {
      width: 1 + (((b[1] & 0x3f) << 8) | b[0]),
      height: 1 + (((b[4] & 0xf) << 10) | (b[3] << 2) | ((b[2] & 0xc0) >> 6)),
    };
  }
  if (chunk === "VP8X") {
    return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
  }
  return null;
}

function pickPicture(pictures = []) {
  const ranked = [...pictures].sort((a, b) => Number(b?.width ?? 0) - Number(a?.width ?? 0));
  const preferred = pictures.find((p) => p?.resolution === "1080x1920") ?? pictures.find((p) => String(p?.resolution ?? "").startsWith("1080"));
  const chosen = preferred ?? ranked[0];
  return typeof chosen?.url === "string" && chosen.url.startsWith("https://") ? chosen.url : null;
}

async function loadCatalog() {
  if (catalogPath) {
    const raw = JSON.parse(await readFile(catalogPath, "utf8"));
    return Array.isArray(raw) ? raw : raw.records ?? [];
  }
  if (!appUrl || !token) {
    throw new Error("Set CLOVER_APP_URL and CLOVER_TOKEN, or pass --catalog <file.json>.");
  }
  const headers = { authorization: `Bearer ${token}`, accept: "application/json" };
  const get = async (path) => {
    const response = await fetch(`${appUrl}/api/intel/${path}`, { headers });
    if (!response.ok) throw new Error(`${path} responded ${response.status}`);
    return response.json();
  };
  const [catalog, wallpapers] = await Promise.all([
    get("academy/heroes/catalog?size=300&index=1"),
    get("heroes/wallpapers?device=mobile&size=300&index=1").catch(() => null),
  ]);
  const byHeroId = new Map();
  for (const row of wallpapers?.data?.records ?? []) {
    const id = row?.data?.heroid?.[0];
    if (!id || byHeroId.has(id)) continue;
    const url = pickPicture(row?.data?.pictures);
    if (url) byHeroId.set(id, url);
  }
  return (catalog?.data?.records ?? []).map((row) => {
    const data = row?.data ?? {};
    return {
      name: data.hero_name ?? data.name,
      hero_id: data.hero_id,
      painting: data.painting ?? byHeroId.get(data.hero_id),
    };
  });
}

async function main() {
  const rows = await loadCatalog();
  await mkdir(OUT_DIR, { recursive: true });
  let saved = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of rows) {
    const name = row?.name;
    if (!name) continue;
    const slug = slugify(name);
    const target = resolve(OUT_DIR, `${slug}.webp`);
    if (!force && existsSync(target)) { skipped++; continue; }
    const url = typeof row.painting === "string" && row.painting.startsWith("https://") ? row.painting : null;
    if (!url) { skipped++; continue; }
    try {
      const response = await fetch(url, { headers: { accept: "image/webp,image/*" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const size = webpSize(bytes);
      // Refuse HTML error pages and anything no sharper than what we already ship.
      if (!size || size.width < MIN_WIDTH) {
        skipped++;
        continue;
      }
      await writeFile(target, bytes);
      saved++;
      console.log(`saved ${slug} ${size.width}×${size.height} (${Math.round(bytes.length / 1024)} kB)`);
    } catch (error) {
      failed++;
      console.warn(`skip ${slug}: ${error.message}`);
    }
  }
  // The app checks this manifest instead of guessing which files exist.
  const files = readdirSync(OUT_DIR).filter((name) => name.endsWith(".webp")).sort();
  await writeFile(resolve(OUT_DIR, "manifest.json"), `${JSON.stringify({ files }, null, 2)}\n`);
  console.log(`\n${saved} saved · ${skipped} skipped · ${failed} failed → ${OUT_DIR}`);
  console.log(`manifest lists ${files.length} high-resolution portraits`);
  if (saved) console.log("Commit frontend/public/heroes/hi and redeploy; the wallpaper picks it up automatically.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
