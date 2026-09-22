# Where does iPhone and iPad screen time land on a Mac running macOS 26?

Date: 2026-09-17
For: Clocktrace v0, iOS and iPadOS import

Checked on the author's Mac: macOS 26.6.2 (25G83), Timing 2026.4.1 installed and running, iPhone and iPad on the same Apple Account with Screen Time "Share Across Devices" on.

## Findings

- Timing's documented route is a Screen Time database read with Full Disk Access. Source: https://timingapp.com/help/screen-time
- That database lives in the Screen Time agent's store under the per-user temp folder (`$(getconf DARWIN_USER_DIR)com.apple.ScreenTimeAgent/Store/`). On macOS 26.6.2 it is a data vault: `stat` and `ls` on the folder return "Operation not permitted" even for a process that holds Full Disk Access. Apple states data vaults need Apple-only entitlements. Source: https://developer.apple.com/forums/thread/114452 and a local test on 2026-09-17.
- Timing's own cached help text says: "As of iOS 18.4, Screen Time data is no longer stored in a location where Timing can access it." Source: `defaults read info.eurocomp.Timing-setapp`, help entry cached on this Mac.
- Yet Timing's database on this Mac holds iPhone rows from 2026-09-17 01:15 UTC and iPad rows from 2026-09-16, per session with second precision, in `AppActivity` joined to `Device` rows flagged `_imported_via_screen_time`. Source: `~/Library/Application Support/info.eurocomp.Timing2/SQLite.db`, read 2026-09-17.
- The `knowledgeC.db` database (`~/Library/Application Support/Knowledge/knowledgeC.db`) holds only this Mac's app usage in its `/app/usage` stream, about eleven days of it, with no device ID on any row. It is not the iOS route. Source: local read 2026-09-17.
- The iOS data is in Biome. `~/Library/Biome/streams/restricted/App.InFocus/remote/<device-uuid>/` holds one folder per synced device with 512 KiB segment files. The iPhone folder was updated 2026-09-17 08:22 local and its newest file names the same apps Timing shows for that hour (Beeper, X, Safari, Perplexity). The iPad folder holds Instagram, Notes, Safari, and a game. `App.WebUsage` and `App.Activity` have no `remote` folder, so no iOS web URLs arrive, which matches Timing's stated limit. Source: local read 2026-09-17.
- Those files are readable by a process with Full Disk Access. This session read them after Full Disk Access was granted to the terminal's parent binary. Source: local test 2026-09-17.
- Each segment file starts with the magic bytes `SEGB` and records carry protobuf payloads with the bundle ID as a string. Format is undocumented by Apple. Source: `xxd` on a segment file, 2026-09-17.
- Device UUIDs map to a platform in `~/Library/Biome/sync/sync.db`, table `DevicePeer`: columns `device_identifier`, `me`, `name` (empty here), `model` (an OS build such as 23G90), `platform`, `last_sync_date`. On this Mac platform 2 is the iPhone, platform 1 the iPads, platform 3 the Macs, inferred by matching the app names in each folder. Source: local read 2026-09-17.
- The oldest remote segment file still on disk is from 2024-12-16 (an old iPad), so retention of the synced stream is longer than the few weeks Timing warns about for the Screen Time database. Source: `ls` on the remote folders, 2026-09-17.

- The segment files parse with the open-source ccl-segb reader (SEGB v2). Each record's payload is one protobuf message. Fields seen: 1 transition reason (string, optional), 3 focus flag (1 start, 0 end), 4 timestamp (double, seconds since 2001-01-01 UTC), 6 bundle ID (string), 9 app version, 10 app build. A session is a start record followed by the end record for the same bundle ID. Source: https://github.com/cclgroupltd/ccl-segb and a local decode on 2026-09-17.
- Reconciled against Timing for 2026-09-16 UTC. iPad: every app matches to the tenth of a minute (largest, a game, 208.0 min in both). iPhone: every real app matches within a minute; Biome also carries iOS system screens (`com.apple.springboard.*`, `com.apple.SleepLockScreen`, `com.apple.control-center`, `com.apple.ClockAngel`) that Timing drops, about 8 min that day. Timing also maps `com.apple.Preferences` to `com.apple.systempreferences`. Source: local reconciliation script, 2026-09-17.
- Re-checked on macOS 27.0 (26A428) on 2026-09-22: same layout (`remote/<device-uuid>/` with 15-digit segment files of 512 KiB and a `tombstone/` subfolder), same SEGB v2 layout (magic at offset 0, 32-byte header, 8-byte entry header with a CRC32, 16-byte trailer slots of end offset, state, timestamp; states 1 written, 3 deleted, 4 empty), same record fields (1, 3, 4, 6, 9, 10 as above; 9 and 10 absent in about half of the records; 2 and 13 are varints of unknown meaning). Source: the check script in PR #98, 2026-09-22.
- The entry header is 8 bytes: bytes 0-3 are the zlib CRC32 of the payload (little-endian; every one of 14,563 entries in one file and all entries in every top-level file matched), bytes 4-7 are a kind: 10 for a focus record. The `tombstone/` files are SEGB too but hold deletion markers, not focus records: every entry has kind 2 and a different protobuf whose field 1 is a 15-digit segment file name. Reading them as focus records gives about 327,000 `parse` lines and no record, so the helper skips that folder. Source: the branch of #103 run on this Mac, 2026-09-22.

## Open

- Whether Timing reads these Biome files or something else. The match above makes it very likely. Not verified with a file trace.
- The exact list of iOS system bundle IDs to drop. Start with the ones seen above and grow it.
- Whether the platform numbers (1 iPad, 2 iPhone, 3 Mac) hold on other Macs. Inferred from one machine.
- How much delay the Biome sync has. The iPhone folder was written 08:22 local and the newest event was 08:15 local, so minutes on this day, but Timing warns of hours.
