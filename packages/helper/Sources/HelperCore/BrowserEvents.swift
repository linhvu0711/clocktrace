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

/// Where a browser's line takes its title from.
public enum TitleSource: Equatable {
  case accessibility
  /// The last event's answer, for a browser whose Accessibility title does not
  /// name the page.
  case lastAnswer
}

/// Which window each event reads.
public enum WindowTarget: Equatable {
  /// `window 1`, found again by each event.
  case front
  /// `window 1`'s `id`, read first, then named by each event, so a window
  /// switch between two events cannot mix two windows' answers.
  case frontById
}

/// The `get` Apple Events that read a browser's front window (ADR 0015).
/// Each entry of `properties` is one event: the four-letter property codes
/// from `window 1` down, as `["acTa", "URL "]` for the URL of the active tab.
public struct BrowserEvents: Equatable {
  public let bundleId: String
  public let properties: [[String]]
  public let privateWindow: PrivateWindowCheck
  public let title: TitleSource
  public let window: WindowTarget

  public init(
    bundleId: String, properties: [[String]], privateWindow: PrivateWindowCheck,
    title: TitleSource = .accessibility, window: WindowTarget = .front
  ) {
    self.bundleId = bundleId
    self.properties = properties
    self.privateWindow = privateWindow
    self.title = title
    self.window = window
  }
}

private let browsers: [String: BrowserEvents] = {
  var table: [String: BrowserEvents] = [
    "com.apple.Safari": BrowserEvents(
      bundleId: "com.apple.Safari", properties: [["cTab", "pURL"]], privateWindow: .safariTitle),
    // Ardia has no `mode`; its window's `incognito` flag answers `true` or `false`.
    // Its window's Accessibility title is always `Ardia`, so the title is the
    // active tab's `title`.
    "com.ardia.browser": BrowserEvents(
      bundleId: "com.ardia.browser",
      properties: [["NNin"], ["acTa", "URL "], ["acTa", "pnam"]],
      privateWindow: .firstAnswer(normal: "false", private: "true"), title: .lastAnswer,
      window: .frontById),
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
