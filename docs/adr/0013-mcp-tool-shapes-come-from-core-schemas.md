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
CLI Twin and the Host get the same text. Planned in #185, not built.

The SDK checks a tool's input against its zod shape before the handler runs,
and rejects with its own `Input validation error: …` text. So the input shape
comes from `Schema.encodedSchema(input)`, which keeps the types and the fixed
choice lists and drops the rules (a date pattern, a positive limit). A value
that breaks a rule, such as `from: "today"` or `limit: 0`, reaches core, which
words the error the same way as for the CLI. A wrong type, or a value outside a
fixed choice list such as `groupBy: "week"`, is stopped at the edge on both
sides: by the SDK over MCP, and by `Options.choice` in the CLI (ADR 0006). Both
errors name the allowed values. The choice lists stay in the shape because
they tell the Host's model which values it may send. The output shape keeps
the full schema, because it checks our own reply.

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
- Full input shapes, with the SDK's errors mapped to core's wording in the
  tool wrapper: rejected, it is a second error mapper that can drift from core.
- Choice lists widened to plain strings, so core words a bad choice over MCP:
  rejected, the tool schema would stop listing the allowed values, and the CLI
  still stops a bad choice itself.
