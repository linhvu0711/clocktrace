private let chromeFamily: Set<String> = [
  "com.google.Chrome",
  "org.chromium.Chromium",
  "com.microsoft.edgemac",
  "com.brave.Browser",
  "com.vivaldi.Vivaldi",
  "com.operasoftware.Opera",
]

/// How the Helper tells a Private window from a normal one (ADR 0011).
public enum PrivateWindowCheck: Equatable {
  /// The first event's answer is `normal` for a normal window and `private`
  /// for a Private one; any other answer means the Helper cannot tell.
  case firstAnswer(normal: String, private: String)
  /// Safari's scripting has no private flag: its Accessibility title is read.
  case safariTitle
}

/// The `get` Apple Events that read a browser's front window (ADR 0015).
/// Each entry of `properties` is one event: the four-letter property codes
/// from `window 1` down, as `["acTa", "URL "]` for the URL of the active tab.
public struct BrowserEvents: Equatable {
  public let bundleId: String
  public let properties: [[String]]
  public let privateWindow: PrivateWindowCheck

  public init(bundleId: String, properties: [[String]], privateWindow: PrivateWindowCheck) {
    self.bundleId = bundleId
    self.properties = properties
    self.privateWindow = privateWindow
  }
}

private let browsers: [String: BrowserEvents] = {
  var table: [String: BrowserEvents] = [
    "com.apple.Safari": BrowserEvents(
      bundleId: "com.apple.Safari", properties: [["cTab", "pURL"]], privateWindow: .safariTitle),
    // Ardia has no `mode`; its window's `incognito` flag answers `true` or `false`.
    "com.ardia.browser": BrowserEvents(
      bundleId: "com.ardia.browser", properties: [["NNin"], ["acTa", "URL "]],
      privateWindow: .firstAnswer(normal: "false", private: "true")),
  ]
  for bundleId in chromeFamily {
    table[bundleId] = BrowserEvents(
      bundleId: bundleId, properties: [["mode"], ["acTa", "URL "]],
      privateWindow: .firstAnswer(normal: "normal", private: "incognito"))
  }
  return table
}()

public let supportedBrowsers: [String] = browsers.keys.sorted()

public func browserEvents(bundleId: String) -> BrowserEvents? {
  browsers[bundleId]
}
