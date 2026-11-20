#!/usr/bin/env node
// Copies the shared later command and skill from the TUI plugin into the
// desktop mod, which must be a self-contained folder too. Run after changing
// later/bin/later.mjs or later/skill/SKILL.md; "--check" fails when they differ.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = ["bin/later.mjs", "skill/SKILL.md"];
const check = process.argv.includes("--check");
let stale = 0;

for (const file of files) {
  const from = path.join(root, "later", file);
  const to = path.join(root, "mods", "later", file);
  const same = fs.existsSync(to) && fs.readFileSync(from, "utf8") === fs.readFileSync(to, "utf8");
  if (same) continue;
  if (check) { console.log(`out of date: mods/later/${file}`); stale++; continue; }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  console.log(`copied ${file}`);
}
process.exit(stale ? 1 : 0);
