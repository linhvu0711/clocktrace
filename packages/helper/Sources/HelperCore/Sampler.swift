import Foundation

public enum Sampler {
  public static func sample(_ r: Reads, urls: UrlReader, at now: Date) -> Sample {
    // The login window is no usable front: nothing about it is sent.
    let front = r.frontmost().flatMap {
      $0.bundleId == "com.apple.loginwindow" ? nil : $0
    }
    let ax = r.axTrusted()
    var title = (ax && front != nil) ? r.focusedTitle(front!.pid) : nil

    var read: UrlRead
    if let front, let script = browserScript(bundleId: front.bundleId ?? "") {
      read = urls.read(bundleId: front.bundleId ?? "", script: script, at: now)
    } else {
      read = .notBrowser
    }

    // A Private window sends no title and no URL; when the Helper cannot tell,
    // it sends no URL (ADR 0011).
    if case .granted(let output) = read, let bundleId = front?.bundleId {
      let window: Window
      if isChromeFamily(bundleId) {
        window = chromeWindow(output)
      } else {
        window = safariWindow(output, title: title, formats: r.safariPrivateFormats())
      }
      switch window {
      case .normal(let u):
        read = .granted(u)
      case .privateWindow:
        title = nil
        read = .granted(nil)
      case .unknown:
        read = .granted(nil)
      }
    }

    var missing: [String] = []
    if !ax {
      missing.append("accessibility")
    }
    let grant: String?
    let url: String?
    switch read {
    case .granted(let u):
      url = u
      grant = "granted"
    case .missing(let state):
      url = nil
      grant = state.rawValue
      if let id = front?.bundleId {
        missing.append("automation:\(id)")
      }
    case .notBrowser:
      url = nil
      grant = nil
    }

    return Sample(
      app: front?.name,
      bundleId: front?.bundleId,
      grant: grant,
      title: title,
      url: url,
      idleSeconds: r.idleSeconds(),
      missing: missing,
      // Only a hold by the app in front is a Screen hold; a failed read is none.
      screenHold: front.map { r.screenHoldPids()?.contains($0.pid) ?? false } ?? false
    )
  }

  private enum Window {
    case normal(String?)
    case privateWindow
    case unknown
  }

  /// Reads the Chrome-family script output, `<mode>\n<url>`.
  private static func chromeWindow(_ output: String?) -> Window {
    guard let output, let newline = output.firstIndex(of: "\n") else {
      return .unknown
    }
    let mode = output[..<newline]
    let rest = String(output[output.index(after: newline)...])
    switch mode {
    case "normal":
      return .normal(rest)
    case "incognito":
      return .privateWindow
    default:
      return .unknown
    }
  }

  /// Safari's scripting has no mode, so its window is private when the
  /// Accessibility title matches Safari's own private-window text. No title
  /// (Accessibility off) or no text loaded: the Helper cannot tell.
  private static func safariWindow(
    _ output: String?, title: String?, formats: [String]
  ) -> Window {
    guard let title, !formats.isEmpty else { return .unknown }
    return isSafariPrivateTitle(title, formats: formats) ? .privateWindow : .normal(output)
  }
}
