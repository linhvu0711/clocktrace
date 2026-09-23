import Foundation

public enum Sampler {
  public static func sample(_ r: Reads, urls: UrlReader, at now: Date) -> Sample {
    let front = r.frontmost()
    let ax = r.axTrusted()
    let title = (ax && front != nil) ? r.focusedTitle(front!.pid) : nil

    let url: UrlRead
    if let front, let script = browserScript(bundleId: front.bundleId ?? "") {
      url = urls.read(bundleId: front.bundleId ?? "", script: script, at: now)
    } else {
      url = .notBrowser
    }

    return Sample(
      front: front,
      axTrusted: ax,
      title: title,
      url: url,
      idleSeconds: r.idleSeconds()
    )
  }
}
