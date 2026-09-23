import Foundation

/// True when `title` is Safari's private-window title in any of `formats`,
/// Safari's own `%@, Private Browsing` string in each language it ships.
func isSafariPrivateTitle(_ title: String, formats: [String]) -> Bool {
  let title = withoutDirectionMarks(title)
  return formats.contains { format in
    let format = withoutDirectionMarks(format)
    guard
      let placeholder = format.range(
        of: #"%(\[[^\]]*\])?@"#, options: .regularExpression)
    else { return false }
    let before = String(format[..<placeholder.lowerBound])
    let after = String(format[placeholder.upperBound...])
    return title.count >= before.count + after.count
      && title.hasPrefix(before) && title.hasSuffix(after)
  }
}

private func withoutDirectionMarks(_ s: String) -> String {
  s.replacingOccurrences(of: "\u{200E}", with: "")
    .replacingOccurrences(of: "\u{200F}", with: "")
}

let safariResourcesPath =
  "/System/Library/PrivateFrameworks/Safari.framework/Versions/A/Resources"

/// Safari's private-window text in every language under `resources`: the
/// value of key `%@, Private Browsing` in each `<lang>.lproj/Localizable.strings`.
/// A missing folder, file, or key adds nothing.
func safariPrivateFormats(resources: String) -> [String] {
  guard let names = try? FileManager.default.contentsOfDirectory(atPath: resources)
  else { return [] }
  let formats = names.filter { $0.hasSuffix(".lproj") }.compactMap { name -> String? in
    guard
      let data = FileManager.default.contents(
        atPath: resources + "/" + name + "/Localizable.strings"),
      let strings = try? PropertyListSerialization.propertyList(from: data, format: nil)
        as? [String: Any]
    else { return nil }
    return strings["%@, Private Browsing"] as? String
  }
  return Set(formats).sorted()
}
