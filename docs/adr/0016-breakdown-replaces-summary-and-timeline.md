---
status: accepted
---

# Breakdown replaces summary and timeline

The daily review needs time summed as a tree (Device, then app, then Domain,
then title) for each hour and each quarter-hour of a 24-hour window. `summary`
gave one flat level for the whole window, `timeline` gave app runs with no
titles or URLs, and `activities` gave about 3,000 raw rows for one day on the
first user's Mac. Summed into a title tree, 9 in 10 lines were under a minute.
The user did that summing by hand each night.

One query, Breakdown, does it. An ordered list of levels makes the tree,
the window is cut into Blocks that follow the clock, and lines under `--min`
merge into one "small items" line whose time still counts in every total above
it. A one-level Breakdown over the whole window is the old `summary`, so
`summary` and `timeline` are removed, from core, MCP and the CLI.

This records the decision; the work is epic #236. `breakdown` does not
exist until #237 lands, and `summary` and `timeline` still ship until #243.

## Considered options

- A new `report` tool next to `summary`: rejected. Two queries that sum time
  would overlap, a Host's model would have to pick between them, and their
  totals could drift apart as each changes.
- Grow `summary` and keep its name: rejected. The name no longer says what the
  tree with Blocks is, and every caller changes its reply shape anyway.
- Keep `timeline`: rejected. Its only answer that Breakdown lacks is the exact
  start and end of one app run, and on real data most runs are under a minute,
  so it prints hundreds of lines. Quarter-hour Blocks with their first and last
  activity time cover the review. If exact runs are needed again, add first and
  last times to Breakdown lines, not a second tool.

## Consequences

- Hosts and scripts that call `summary` or `timeline` break and must move to
  `breakdown`.
- There is no cap on Blocks: a year in quarter-hours gives a year of Blocks.
- Telling private browsing apart from an unread title needs a private mark on
  each Activity, stored with no title and no URL.
