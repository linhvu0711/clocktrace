---
status: accepted
---

# Browser URLs are read with raw Apple Events

The Helper read browser URLs with `NSAppleScript` on the background queue
`clocktrace.url-read`. Apple lists `NSAppleScript` as main-thread only
(https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/Multithreading/ThreadSafetySummary/ThreadSafetySummary.html).
Off the main thread, a read sometimes waited 2 to 4 s for a reply that the
browser had already sent. While the Helper hung, a second process read the
same Brave in about 30 ms. The read hit its 2 s limit, the line went out with the
title and no URL, and one visit split into extra Activities (#222).

The Helper now sends the Apple Events itself with `AESendMessage`, on the same
background queue and under the same 2 s limit. Apple documents it as
thread-safe: "you could, for example, set up a thread to send an Apple event and
wait for a reply"
(https://developer.apple.com/documentation/coreservices/1442994-aesendmessage).
Chromium browsers get two events, `mode` of the front window and `URL` of its
active tab; Safari gets one, `URL` of the current tab. Built in #231.

## Considered options

- `NSAppleScript` on the main thread: rejected. It is the use Apple supports,
  but a browser or `appleeventsd` that never answers stops the Watcher and all
  recording, the hang #155 fixed (ADR 0009).
- `/usr/bin/osascript` as a child process for each read: rejected. It starts a
  new process every second while a browser is in front.

## Consequences

- The Helper carries the four-letter Apple Event codes for each browser family.
  A browser that renames them in its scripting dictionary loses its URL, as a
  failed script did before.
- When a read is still slow or busy and the app and window title have not
  changed since the last read that answered, the Helper sends that read's URL
  again, with no time limit. A changed title sends no URL (ADR 0011).
