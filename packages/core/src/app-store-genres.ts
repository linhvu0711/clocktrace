// App Store primaryGenreName → starter Category name. Covers the genres a
// personal tracker is likely to see; anything else stays Uncategorized.
// Entries stay tuples: the genre names are external strings, not camelCase.
export const genreCategories: Record<string, string> = Object.fromEntries([
  ["Social Networking", "Social"],
  ["Photo & Video", "Social"],
  ["Games", "Entertainment"],
  ["Entertainment", "Entertainment"],
  ["Music", "Entertainment"],
  ["Kids", "Entertainment"],
  ["Books", "Entertainment"],
  ["News", "Entertainment"],
  ["Magazines & Newspapers", "Entertainment"],
  ["Developer Tools", "Coding"],
  ["Graphics & Design", "Design"],
]);
