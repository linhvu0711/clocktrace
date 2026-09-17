private let chromeFamily: Set<String> = [
  "com.google.Chrome",
  "org.chromium.Chromium",
  "com.microsoft.edgemac",
  "com.brave.Browser",
  "com.vivaldi.Vivaldi",
  "com.operasoftware.Opera",
]

public func browserScript(bundleId: String) -> String? {
  if bundleId == "com.apple.Safari" {
    return "tell application \"Safari\" to get URL of current tab of front window"
  }
  if chromeFamily.contains(bundleId) {
    return
      "tell application id \"\(bundleId)\" to get URL of active tab of front window"
  }
  return nil
}
