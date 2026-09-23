import Foundation

public enum Sampler {
  public static func sample(_ r: Reads, urls: UrlReader, at now: Date) -> Sample {
    let front = r.frontmost()
    let ax = r.axTrusted()
    var title = (ax && front != nil) ? r.focusedTitle(front!.pid) : nil

    var url: UrlRead
    if let front, let script = browserScript(bundleId: front.bundleId ?? "") {
      url = urls.read(bundleId: front.bundleId ?? "", script: script, at: now)
    } else {
      url = .notBrowser
    }

    // A Private window sends no title and no URL; when the Helper cannot tell,
    // it sends no URL (ADR 0011).
    if case .granted(let output) = url, let bundleId = front?.bundleId {
      let window: Window
      if isChromeFamily(bundleId) {
        window = chromeWindow(output)
      } else {
        window = safariWindow(output, title: title, formats: r.safariPrivateFormats())
      }
      switch window {
      case .normal(let u):
        url = .granted(u)
      case .privateWindow:
        title = nil
        url = .granted(nil)
      case .unknown:
        url = .granted(nil)
      }
    }

    return Sample(
      front: front,
      axTrusted: ax,
      title: title,
      url: url,
      idleSeconds: r.idleSeconds()
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
