---
status: accepted
---

# Apps with no bundle id get a Stand-in id

Some Mac apps have a name but no bundle id. For a Windows game run through
CrossOver (Wine), macOS reports `QSanguosha.exe` with no bundle id. The
Collector drops every line with no bundle id, so that time is never tracked.
The Collector will save such an Activity with a Stand-in id, `noid:` and the
app name, as `noid:QSanguosha.exe`. The Helper still sends only what macOS
reports; the Collector makes the Stand-in id before the write. Planned in
#171, not built yet.

Apple's rule for `CFBundleIdentifier` allows only letters, digits, `-` and `.`,
so a Stand-in id, which holds a colon, never matches a real bundle id. Code
tells the two apart by the `noid:` prefix.

- The app name is kept as macOS reports it. Nothing is trimmed, not even `.exe`.
- A line with no app name, or an empty one, is still dropped. The login window
  sends neither a name nor a bundle id, so it stays untracked.
- Two apps with one name share one Stand-in id and add up as one app. Wine runs
  each game from a temp folder that changes on every start, so the path cannot
  tell them apart.

## Considered options

- A nullable `bundle_id` column, empty for these apps: rejected. It states the
  fact most exactly, but SQLite must rebuild the table, and every place that
  groups or filters by bundle id must handle the empty case.
- The plain app name as the bundle id: rejected. Nothing would show that the id
  is not real.
- The Helper makes the Stand-in id: rejected. The Helper would send an id that
  macOS never gave, and the wire format would change.
- The executable path in the id: rejected. Wine runs the `.exe` from a new temp
  folder on every start.

## Consequences

- Activities are never edited, so every `noid:` row stays as written. A later
  change of the format must read both forms.
- A Wine window gives no title to Accessibility, so these Activities have an
  app and a time only.
