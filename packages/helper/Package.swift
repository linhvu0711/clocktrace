// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "clocktrace-helper",
  platforms: [.macOS(.v13)],
  targets: [
    .target(name: "HelperCore"),
    .executableTarget(
      name: "clocktrace-helper",
      dependencies: ["HelperCore"]
    ),
    .testTarget(
      name: "HelperCoreTests",
      dependencies: ["HelperCore"],
      resources: [.copy("Fixtures")]
    ),
  ]
)
