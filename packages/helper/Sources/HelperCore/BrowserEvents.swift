private let chromeFamily: Set<String> = [
  "com.google.Chrome",
  "org.chromium.Chromium",
  "com.microsoft.edgemac",
  "com.brave.Browser",
  "com.vivaldi.Vivaldi",
  "com.operasoftware.Opera",
]

public let supportedBrowsers: [String] = ["com.apple.Safari"] + chromeFamily.sorted()

/// The `get` Apple Events that read a browser's front window (ADR 0015).
/// Each entry of `properties` is one event: the four-letter property codes
/// from `window 1` down, as `["acTa", "URL "]` for the URL of the active tab.
public struct BrowserEvents: Equatable {
  public let bundleId: String
  public let properties: [[String]]

  public init(bundleId: String, properties: [[String]]) {
    self.bundleId = bundleId
    self.properties = properties
  }
}

public func browserEvents(bundleId: String) -> BrowserEvents? {
  if bundleId == "com.apple.Safari" {
    return BrowserEvents(bundleId: bundleId, properties: [["cTab", "pURL"]])
  }
  if chromeFamily.contains(bundleId) {
    return BrowserEvents(bundleId: bundleId, properties: [["mode"], ["acTa", "URL "]])
  }
  return nil
}

func isChromeFamily(_ bundleId: String) -> Bool {
  chromeFamily.contains(bundleId)
}
