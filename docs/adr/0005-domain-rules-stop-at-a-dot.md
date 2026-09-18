---
status: accepted
---

# Domain rules stop at a dot instead of getting their own compare

A Rule on the domain field with `ends with github.com` matched `evilgithub.com`, because `ends with` was a plain string check on the host (issue #40). We keep the five compares and make `starts with` and `ends with` label-aware on the domain field only: the host must equal the value, or the match must end (or start) at a dot. Title and url keep the plain check. The natural rule a user writes, "domain ends with github.com", now does what it says, and the seed no longer needs an `is` exception for `x.com` to keep `netflix.com` out of Social.

## Considered options

- A sixth compare such as `is or under`: rejected, it leaves the plain `ends with` trap open for every user-written domain rule and adds a word to the schema, the glossary, and every rule surface.
- Seed values of `.github.com` plus an `is` rule per site: rejected, it doubles the seed list and fixes nothing for user rules.
