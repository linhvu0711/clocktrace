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
    let events = front.flatMap { browserEvents(bundleId: $0.bundleId ?? "") }
    if let events {
      read = urls.read(events, title: title, at: now)
    } else {
      read = .notBrowser
    }

    // A Private window sends no title and no URL; when the Helper cannot tell,
    // it sends no URL (ADR 0011).
    var isPrivate = false
    if case .granted(let output) = read, let events {
      let window: Window
      switch events.privateWindow {
      case .firstAnswer(let normal, let privateAnswer):
        window = flagWindow(output, normal: normal, private: privateAnswer)
      case .safariTitle:
        window = safariWindow(output, title: title, formats: r.safariPrivateFormats())
      }
      switch window {
      case .normal(let u):
        read = .granted(u)
      case .privateWindow:
        title = nil
        isPrivate = true
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
      screenHold: front.map { r.screenHoldPids()?.contains($0.pid) ?? false } ?? false,
      isPrivate: isPrivate
    )
  }

  private enum Window {
    case normal(String?)
    case privateWindow
    case unknown
  }

  /// Reads a `<flag>\n<url>` output, as Chrome's `<mode>` or Ardia's `<incognito>`.
  private static func flagWindow(
    _ output: String?, normal: String, private privateAnswer: String
  ) -> Window {
    guard let output, let newline = output.firstIndex(of: "\n") else {
      return .unknown
    }
    let flag = output[..<newline]
    let rest = String(output[output.index(after: newline)...])
    if flag == normal {
      return .normal(rest)
    }
    if flag == privateAnswer {
      return .privateWindow
    }
    return .unknown
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
