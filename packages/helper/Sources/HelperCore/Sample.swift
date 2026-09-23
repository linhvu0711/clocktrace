import Foundation

public struct FrontApp: Equatable {
  public var name: String?
  public var bundleId: String?
  public var pid: pid_t

  public init(name: String?, bundleId: String?, pid: pid_t) {
    self.name = name
    self.bundleId = bundleId
    self.pid = pid
  }
}

public enum UrlRead: Equatable {
  case notBrowser
  case granted(String?)
  case missing(GrantState)
}

/// The finished reading: the Line without its time. Sampler makes it.
public struct Sample: Equatable {
  public var app: String?
  public var bundleId: String?
  public var grant: String?
  public var title: String?
  public var url: String?
  public var idleSeconds: Double
  public var missing: [String]

  public init(
    app: String?,
    bundleId: String?,
    grant: String? = nil,
    title: String?,
    url: String?,
    idleSeconds: Double,
    missing: [String]
  ) {
    self.app = app
    self.bundleId = bundleId
    self.grant = grant
    self.title = title
    self.url = url
    self.idleSeconds = idleSeconds
    self.missing = missing
  }
}
