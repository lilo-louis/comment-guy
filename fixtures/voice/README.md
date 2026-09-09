# Voice corpus

Drop `*.md` files here containing your own writing. `cg voice build` reads all
of them and generates `data/voice/current.json`.

**This directory is gitignored** apart from this README. The plan calls for
including messages you have written, which is private writing, and the repo is
public.

## Format

One sample per paragraph, separated by blank lines. Anything under 15 characters
is skipped.

Mark a sample as an example of writing you dislike by prefixing it with `!!`:

```
This is a normal sample. It goes in as good writing.

!! This one is off-voice and will be recorded as a weak example.
```

## What to include

- Your own X posts and replies (the more the better — 50+ is where it gets good)
- Messages and emails you have written
- Anything you would point at and say "this is how I actually sound"

Include some bad examples too. Knowing what you do *not* sound like measurably
improves the drafts.
