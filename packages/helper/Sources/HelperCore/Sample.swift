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
  case missing
}

public struct Sample: Equatable {
  public var front: FrontApp?
  public var axTrusted: Bool
  public var title: String?
  public var url: UrlRead
  public var idleSeconds: Double

  public init(
    front: FrontApp?,
    axTrusted: Bool,
    title: String?,
    url: UrlRead,
    idleSeconds: Double
  ) {
    self.front = front
    self.axTrusted = axTrusted
    self.title = title
    self.url = url
    self.idleSeconds = idleSeconds
  }
}
