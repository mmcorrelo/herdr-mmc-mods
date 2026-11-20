---
name: later
description: Keep and work the shared "later" list of to-dos, shared by every agent. Use when you and the user agree that something should be done later, not now (a follow-up, technical debt you flagged, a separate change, "let's do that next time", "add that to later"); when the user asks you to pick, take or do a to-do ("pick a to-do", "do later item 8a70"); when the user asks what is on the list; or when you finish an item you took.
---

# Later

`later` is one list of to-dos, shared by every agent in every herdr space. The user sees it live in the Later panel, so what you change appears for them at once.

Run it as:

```
{{LATER}} <command>
```

## Adding an item

Add an item when **you and the user agree** to leave something for later:

- the user says "later", "next time", "not now", "separate change", "remember this", "add it to later";
- you flagged technical debt or a follow-up and the user chose not to do it now.

Do not add an item twice for the same thing (run `list --here` first when unsure).

### This session or a new one

Decide who will do it:

- **This session**: you will do it yourself before this conversation ends ("after the tests", "at the end", "with you in a minute"). Add it with `--session`: it is reserved for you, other agents skip it, and it needs no context.
- **A new session**: another agent, or you on another day, will do it. It needs a context.

Decide by yourself when the user's words make it clear. **Ask** ("Should I do this later in this session, or put it in a new session?") only when they do not.

```
{{LATER}} add "Fix the typo in README > Series" --session
```

### The context for a new session

A new agent has none of this conversation, so write a handoff in a markdown file and pass it with `--context-file` (or `-` to read it from stdin). Use these sections, and leave out the ones that have nothing to say:

```markdown
## Goal
One sentence: what to do.

## Why
The reason, in one or two sentences.

## Background
- Decisions already taken in this conversation, and the options rejected.

## Where
- The files, classes, commands, endpoints.

## Done when
- How to know it is finished (tests, behaviour).

## Watch out
- Traps you found.
```

Write it yourself from what you know; do not ask the user to check it. **Ask** only for what is missing and would change the work, for example a decision you two did not make or a "done when" you cannot tell. Then save the item with the answer in the context.

```
{{LATER}} add "Cap JSON request bodies above 32 MB" --context-file /tmp/later-cap.md
```

For a small, obvious item a one-line `--brief "…"` is enough, and no context file is needed.

- The text is a short task that starts with a verb.
- The project is the git repository of the current folder. Use `--project <name>` when the item belongs to another repository.
- Use `--for <tab name>` only when the user says which agent should do it.
- After adding, tell the user in one line: `Added to later: <text> (<id>)`, and say "for this session" or "with a context for a new agent".

## Picking a to-do

When the user says "pick a to-do" (or similar) without an id:

1. Run `{{LATER}} list --here --available`: the open items of this repository that nobody has and that are not assigned to another agent. Run `{{LATER}} show <id>` to read an item's context.
2. Choose the one you can do best with what you know, and tell the user which one and why, in one or two lines. If none fits, say so. Do not take anything yet.
3. Take it only after the user says yes: `{{LATER}} take <id>`.

When the user names an item ("do later item 8a70"), take it at once: `{{LATER}} take 8a70`. The command prints the whole item with its brief and its context: read the context before you start, and follow its "Done when".

`take` is refused when another agent has the item. Then tell the user who has it, and offer another item. Never work on an item you did not take.

## Finishing

- Items you reserved with `--session` are yours: do them before the session ends, or unassign them so they become open items.
- When the work is done, run `{{LATER}} done <id>` and tell the user.
- When you stop before it is done (the user changes plans, you are blocked), run `{{LATER}} unassign <id>` so another agent can take it, and say so.

## Other commands

```
{{LATER}} show <id>          # the whole item, with its brief
{{LATER}} list --here        # this repository's items, in progress included
{{LATER}} list --all         # every project, done items too
{{LATER}} reopen <id>
{{LATER}} rm <id>            # only when the user asks
```
