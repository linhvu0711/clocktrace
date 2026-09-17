---
status: accepted
---

# Local-first storage with a swappable storage interface

Clocktrace is shared with friends, so a hosted service was the obvious shape. We chose local only for v0: one database file per Mac, no server, no account. This costs nothing to run, keeps window titles and URLs on the user's own machine, and still covers iPhone and iPad because Apple's own sync already puts each device's app usage on the Mac, readable with Full Disk Access (see ADR 0004 for the route). The core package talks to storage through one interface so a cloud backend can be added later without touching the domain code.

## Considered options

- Cloud from day one: rejected, it needs login, hosting money, and custody of friends' private activity data before the product has proven itself.
