private let chromeFamily: Set<String> = [
  "com.google.Chrome",
  "org.chromium.Chromium",
  "com.microsoft.edgemac",
  "com.brave.Browser",
  "com.vivaldi.Vivaldi",
  "com.operasoftware.Opera",
]

public let supportedBrowsers: [String] = ["com.apple.Safari"] + chromeFamily.sorted()

public func browserScript(bundleId: String) -> String? {
  if bundleId == "com.apple.Safari" {
    return "tell application \"Safari\" to get URL of current tab of front window"
  }
  if chromeFamily.contains(bundleId) {
    return
      "tell application id \"\(bundleId)\" to tell front window to return mode & linefeed & URL of active tab"
  }
  return nil
}

func isChromeFamily(_ bundleId: String) -> Bool {
  chromeFamily.contains(bundleId)
}
