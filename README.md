# herdr-mmc-mods

My mods for [herdr](https://github.com/herdrdev/herdr), the workspace for coding agents. Each mod comes in two forms: one for the Herdr desktop app (Herdr.app) and one for the herdr terminal app (`herdr`). They run on macOS, Linux and Windows.

| Mod | What it does | Desktop app | Terminal app |
|---|---|---|---|
| later | One shared list of the work you and your agents agreed to do later. Any agent in any workspace adds to it, and the list updates live. | [`mods/later/`](mods/later/) | [`later/`](later/) |

Both forms of a mod use the same data, so if you use both apps you see one list.

![The Later panel in the Herdr desktop app](mods/later/preview.png)

## Install in the desktop app

```sh
git clone https://github.com/mmcorrelo/herdr-mmc-mods.git
cd herdr-mmc-mods
node install-desktop.mjs
```

With the Herdr app open, the panel appears on the right. The installer copies each mod into `~/.config/herdr-app/mods/`, adds its shortcut to `keys.json` (never replacing a key you already use, backup in `keys.json.bak-herdr-mmc-mods`) and gives the panel its name in your layout so the shortcut finds it. Run it again after `git pull` to update; it only replaces copies it installed.

Or ask the agent in your Herdr app: *"install the later mod from github.com/mmcorrelo/herdr-mmc-mods"*. Each mod has a `RECIPE.md` that tells it how.

## Install in the terminal app

The terminal app installs mods with its `plugin` command:

```sh
herdr plugin install mmcorrelo/herdr-mmc-mods/later
```

Then restart herdr. Update with `herdr plugin update`. To work on the mod from a clone, link its folder instead: `herdr plugin link /path/to/herdr-mmc-mods/later`.

## Requirements

- herdr 0.9 or later, or the Herdr desktop app
- Node.js 18 or later (no packages to install). The desktop mod also finds a Node installed with nvm, Volta or Homebrew.

## Working on this repository

The `later` command and its agent skill live in `later/`. The desktop mod needs its own copy, because each mod folder must stand alone: after changing `later/bin/later.mjs` or `later/skill/SKILL.md`, run `node tools/sync.mjs` (`--check` fails when the copies differ).

## License

MIT
