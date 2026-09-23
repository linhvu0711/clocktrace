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
