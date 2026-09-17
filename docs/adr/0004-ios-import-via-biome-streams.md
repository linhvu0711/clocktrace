---
status: accepted
---

# iPhone and iPad time comes from Biome App.InFocus streams, isolated and version-gated

Timing's documented route, the Screen Time database read with Full Disk Access, is a data vault on macOS 26 and cannot be opened by third parties (https://developer.apple.com/forums/thread/114452). The data still reaches the Mac: Apple's sync writes each device's app focus events to `~/Library/Biome/streams/restricted/App.InFocus/remote/<device>/` as SEGB v2 segments with protobuf records, readable with Full Disk Access. Our own decoder was checked once, on 2026-09-17, against a known-good source (the Timing app's rows for the same day): iPad matched to the tenth of a minute, iPhone within a minute per app. Clocktrace does not depend on Timing or any other app at runtime; the data comes from Apple's files. No web URLs arrive from iOS.

Apple documents none of this and can move it in any release, so the importer lives in its own module that cannot break the Mac tracker, carries a list of macOS versions it was verified on and reports "not tested" on any other, exposes a health line with three separate signals, and is covered by a golden test on one real sample file. The signals: the last import result (a missing folder, an unreadable file, or a parse failure means "import broken"), the last sync time per device from Apple's own Biome sync table (`~/Library/Biome/sync/sync.db`, table `DevicePeer`, which says "device not syncing" when it is old), and the last event time per device, which is information only ("no iPhone activity since Friday") and never a failure on its own, because a phone that is off or unused produces no events. Each June the Apple beta is installed on a second volume and the day-check script is rerun; v0 ships only after that check passes on macOS 26 and 27. This is the same yearly chore Timing carries (https://timingapp.com/help/screen-time).

## Considered options

- Apple's DeviceActivity and FamilyControls frameworks: rejected, they exist for iOS and Mac Catalyst only and give no historical data (https://developer.apple.com/documentation/deviceactivity).
- Skip iOS in v0: rejected once the route was verified in an afternoon.
