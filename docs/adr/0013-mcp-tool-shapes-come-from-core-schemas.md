---
status: accepted
---

# MCP tool shapes come from the core schemas

Every MCP tool had a zod input and output shape written by hand next to the
core Effect Schema it copied (`RuleOut` beside `Rule`, `RangeIn` beside
`Range`). Nothing tied the two together, so a field added in core passed the
type check and failed only when the server checked its own reply. Each tool now
takes its input and output shapes from one core schema. `JSONSchema.make`
writes the schema as JSON Schema, and `z.fromJSONSchema` turns that into the
zod shape the MCP SDK takes. Core checks the input and words its errors, so the
CLI Twin and the Host get the same text. Not built yet.

The JSON Schema must use the 2019-09 target
(`JSONSchema.make(schema, { target: "jsonSchema2019-09" })`). Effect's default
draft-07 output puts shared parts under `$defs`, and zod 4.6 cannot resolve
those references (`Reference not found: #/$defs/Int`). Checked with effect
3.22.2 and zod 4.6.5 on 2026-09-23.

## Considered options

- Keep the hand-written zod shapes and add a test that compares each pair:
  rejected, the test is a third copy of every shape.
- Pass JSON Schema to the SDK directly: rejected, `registerTool` in
  `@modelcontextprotocol/sdk` 1.30 takes only zod shapes, so this means
  dropping `McpServer` for the low-level `Server`.
- Output shapes only, inputs by hand: rejected, bad input would still get
  different error text in the terminal and in the Host.
