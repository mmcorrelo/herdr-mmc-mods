#!/usr/bin/env node
// Installs the desktop mods of this repository into the Herdr app:
//   node install-desktop.mjs [mod...]    (default: every mod in mods/)
// Copies each mods/<name>/ folder into the app's mods/ folder, replacing only a
// copy this script installed before, and adds the mod's keys.json to the app's
// keys.json without replacing a key that is already in use.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const APP = process.env.HERDR_APP_HOME || path.join(os.homedir(), ".config", "herdr-app");
const STAMP = ".herdr-mmc-mods";

if (!fs.existsSync(APP)) {
  console.error(`The Herdr app folder was not found (${APP}). Start the Herdr app once, or set HERDR_APP_HOME.`);
  process.exit(1);
}

const wanted = process.argv.slice(2);
const mods = fs.readdirSync(path.join(ROOT, "mods")).filter((m) => !wanted.length || wanted.includes(m));

function mergeKeys(file, add) {
  const keys = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  let changed = false;
  for (const [section, entries] of Object.entries(add)) {
    keys[section] ??= {};
    for (const [key, command] of Object.entries(entries)) {
      if (keys[section][key] === command) continue;
      if (key in keys[section]) {
        console.log(`  ${key} is already "${keys[section][key]}": add "${command}" to another key in ${file}`);
        continue;
      }
      keys[section][key] = command;
      changed = true;
      console.log(`  key: ${key} → ${command}`);
    }
  }
  if (!changed) return;
  fs.copyFileSync(file, `${file}.bak-herdr-mmc-mods`);
  fs.writeFileSync(file, JSON.stringify(keys, null, 2) + "\n");
}

// The app docks a new mod with a random node id, but keys show and hide a panel
// by id. Once the app has docked it, give that node the mod's own name, so a key
// such as "layout.toggle:later" finds it. Waits up to 8 seconds for the dock.
function nameDockedNode(name) {
  const dir = path.join(APP, "layouts");
  const until = Date.now() + 8000;
  for (;;) {
    let found = false;
    for (const file of fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")) : []) {
      const full = path.join(dir, file);
      let tree;
      try { tree = JSON.parse(fs.readFileSync(full, "utf8")); } catch { continue; }
      let renamed = 0;
      (function walk(node) {
        if (node?.content?.mod === name) {
          found = true;
          if (node.id !== name) { node.id = name; renamed++; }
        }
        (node?.children ?? []).forEach(walk);
      })(tree);
      if (renamed) {
        fs.copyFileSync(full, `${full}.bak-herdr-mmc-mods`);
        fs.writeFileSync(full, JSON.stringify(tree, null, 2) + "\n");
        console.log(`  panel id set to "${name}" in layouts/${file}`);
      }
    }
    if (found) return;
    if (Date.now() > until) {
      console.log("  the app has not docked the panel yet: start the Herdr app, then run this script again");
      return;
    }
    spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 500)"]);
  }
}

for (const name of mods) {
  const from = path.join(ROOT, "mods", name);
  const to = path.join(APP, "mods", name);
  console.log(`== ${name}`);

  if (fs.existsSync(to) && !fs.existsSync(path.join(to, STAMP))) {
    console.log(`  ${to} already exists and is not from this repository: skipped`);
    continue;
  }
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true, filter: (p) => !["keys.json", "RECIPE.md", "preview.png"].includes(path.basename(p)) || path.dirname(p) !== from });
  fs.writeFileSync(path.join(to, STAMP), "");
  console.log(`  copied to ${to}`);

  const keys = path.join(from, "keys.json");
  if (fs.existsSync(keys)) mergeKeys(path.join(APP, "keys.json"), JSON.parse(fs.readFileSync(keys, "utf8")));

  const check = spawnSync("herdr-app", ["check", to], { encoding: "utf8" });
  if (check.error) console.log("  herdr-app was not found on PATH, so the mod was not checked");
  else console.log(`  ${(check.stdout || check.stderr).trim()}`);

  if (fs.existsSync(path.join(from, "mod.json")) && JSON.parse(fs.readFileSync(path.join(from, "mod.json"), "utf8")).place !== "none") {
    nameDockedNode(name);
  }
}
