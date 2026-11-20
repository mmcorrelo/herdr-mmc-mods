---
name: later
description: Keep the shared "later" list of deferred work. Use when you and the user agree that something should be done later, not now (a follow-up, technical debt you flagged, a separate change, "let's do that next time", "add that to later", "remember this for later"), when the user asks what is on the later list, or when you finish an item that is on it.
---

# Later

`later` is one list of deferred work, shared by every agent in every herdr workspace. The user sees it live in a herdr pane, so an item you add appears for them at once.

Run it as:

```
{{LATER}} <command>
```

## When to add

Add an item when **you and the user agree** to leave something for later:

- the user says "later", "next time", "not now", "separate change", "remember this", "add it to later";
- you flagged technical debt or a follow-up and the user chose not to do it now.

Do not add an item for something you are about to do in this session, for a guess the user did not agree to, or twice for the same thing (run `list --here` first when unsure).

```
{{LATER}} add "Write the migration for the orders table" --note "the orders table has no created_at yet"
```

- Write the text as a short task a person can act on cold, starting with a verb. Put the reason in `--note` when it is not obvious.
- The project is the git repository of the current folder. Use `--project <name>` when the item belongs to another repository.
- After adding, tell the user in one line: `Added to later: <text> (<id>)`.

## Other commands

```
{{LATER}} list --here     # open items of this repository
{{LATER}} list --all      # every project, done items too
{{LATER}} done <id>       # when you finish an item in this session; tell the user
{{LATER}} reopen <id>
{{LATER}} rm <id>         # only when the user asks
```
