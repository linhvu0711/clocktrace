---
status: accepted
---

# Build our own collector instead of reusing ActivityWatch or get-windows

ActivityWatch (MPL-2.0) already records app, title, and URL on macOS, and the get-windows npm package does the same in one install. We build our own small Swift helper anyway. ActivityWatch means two installs and two running processes for every friend, its last stable release is from October 2024 (https://api.github.com/repos/ActivityWatch/activitywatch/releases/latest), and its API is documented as subject to change (https://docs.activitywatch.net/en/latest/api/rest.html). get-windows reads window titles through CoreGraphics, which since macOS 10.15 needs the Screen Recording permission (https://developer.apple.com/videos/play/wwdc2019/701/), so friends see a prompt saying the app wants to record their screen. Our helper uses NSWorkspace for the app, the Accessibility API for the title, Apple Events for browser URLs, and CGEventSource for idle time. That needs only the Accessibility and Automation prompts, the same ones Timing and Rize show.

## Considered options

- ActivityWatch as the data source: rejected for the install and maintenance reasons above.
- get-windows: rejected for the Screen Recording prompt and the unowned native binary.
- screenpipe: rejected, its license requires a paid deal for commercial use (https://github.com/screenpipe/screenpipe/blob/main/LICENSE.md) and it records screenshots we do not need.
