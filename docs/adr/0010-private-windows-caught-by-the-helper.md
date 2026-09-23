---
status: accepted
---

# Private windows are caught by the Helper

A Private window's title and URL must never reach the Store, with or without
Accessibility. Private rules test the title, and without Accessibility there is
no title, so the URL was written (#165). The Helper decides before it emits a
line. For a Private window it sends no title and no URL. When it cannot tell, it
sends no URL. Built in #167.

- In Chromium browsers (Chrome, Brave, Edge, Vivaldi, Opera, Chromium) the URL
  script also reads `mode of front window`, which is `incognito` for a private
  window in every one of them, Edge included. It runs through the Automation
  Grant, so it needs no Accessibility. If the script fails, no URL is sent.
- Safari has no private flag in its scripting dictionary. With Accessibility, a
  private window's title ends with Safari's own `%@, Private Browsing` string
  (`Example Domain, Private Browsing` on Safari 27). The Helper loads that string
  in every language Safari ships from
  `/System/Library/PrivateFrameworks/Safari.framework` and checks the title
  against each one. If no string can be loaded, or Accessibility is off, no
  Safari URL is sent.

The starter Private rules stay. Real titles still carry `(Incognito)` (Chrome)
and `(Private)` (Brave), and `Private Browsing` covers Firefox, whose URL is not
read.

## Considered options

- No URL for any browser while Accessibility is off: rejected, Chromium
  browsers can be checked without it, and domain rules would lose every URL.
- A `private` field on the Line, with the Collector blanking: rejected, the URL
  would still cross the pipe, and three layers change instead of one.
- Matching the English `Private Browsing` suffix only: rejected, it leaks on a
  Mac in any other language (`navigation privée`, `Duyệt riêng tư`).
- Only Safari's own language: rejected, a wrong or failed language read leaks
  the URL.
- A Safari App Extension with `SFSafariPageProperties.usesPrivateBrowsing`: the
  only check Apple supports, rejected as a new component the user has to turn on.
- A marker in Safari's accessibility tree: the only one that is not text,
  `SidebarLibraryItemTabGroup?isPrivate=true`, is gone when the sidebar is hidden.
- Safari's Window menu (`Move Tab to New Private Window`): rejected, it is
  display text and changes with the language.

## Consequences

- Safari without Accessibility records no URLs, only app and time.
- The Safari check rests on a string key inside a private framework. A Safari
  update that renames it makes the Helper send no Safari URL; it never leaks.
- A normal page whose own title matches the private text of any language loses
  its URL.
