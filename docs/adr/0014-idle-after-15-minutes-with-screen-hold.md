---
status: accepted
---

# Idle after 15 minutes, and a Screen hold keeps time

The Collector called the user Idle after 5 minutes with no keyboard or mouse
input, and ended the Activity at the last input. That dropped time the user
spent at the Mac: reading, watching an agent work in a terminal, or watching a
video. On 2026-09-24 it dropped three stretches of 6, 9 and 10 minutes (#223).

Idle now starts after 15 minutes with no input and no Screen hold. A Screen
hold is the app in front asking macOS to keep the screen on
(`PreventUserIdleDisplaySleep`), as a video, a video call, or a slideshow
does. The Activity still ends at the last input, or at the end of the Screen
hold when that came later, and a Screen hold keeps time for at most 3 hours
after the last input.

- 15 minutes, not the 3 to 5 that other trackers use: Timing uses 3
  (https://timingapp.com/help/faq), Rize 5
  (https://docs.rize.io/breaks/create-break-sessions), and ActivityWatch 3
  (https://github.com/ActivityWatch/aw-watcher-afk/blob/master/aw_watcher_afk/afk.py).
  Those limits cut the reading and agent-watching time this tool must count.
  The cost is that a break shorter than 15 minutes counts as work.
- Only the app in front counts. On the first user's Mac, One Switch holds the
  screen on through `caffeinate` for days at a time. A hold by any app would
  mean the user is never Idle.
- 3 hours, because many films run longer than 2. A forgotten autoplay adds no
  more than that.
- The end stays at the last input, not the last input plus 15 minutes, so a
  real break adds no time.

## Considered options

- Only a longer limit: rejected. A film longer than the limit is still cut.
- Store the quiet stretches and let each query decide: rejected. It loses
  nothing, but it needs new data and a change to every query, for a problem a
  better rule at write time solves.
- Ask the user on return what they did: rejected. Clocktrace has no window to
  ask in; it is used through an agent or the terminal.

## Consequences

- Activities are never edited, so time dropped under the 5-minute rule stays
  dropped.
- A Screen hold that the Helper cannot read counts as no hold, so the rule
  falls back to input alone.
