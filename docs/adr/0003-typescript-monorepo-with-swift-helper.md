---
status: accepted
---

# TypeScript monorepo with Effect, plus one Swift helper binary

The core (activities, categories, projects, rules, queries, storage), the MCP server, and the CLI are TypeScript in one monorepo, written with Effect for typed errors, services, and the storage interface that a cloud backend will later implement. Plain TypeScript is used only at the edges where the MCP SDK or a native binding wants it. Only the native helper that reads macOS state is Swift. TypeScript has the reference MCP SDK, and any later web or desktop app imports the same core package. All-Swift was rejected because the author has no Apple experience and every future app would have to be Swift too. Rust or Go was rejected for the learning curve and the smaller MCP ecosystem. Plain TypeScript without Effect was considered and set aside by the author, who works with Effect elsewhere and wants one style across projects.
