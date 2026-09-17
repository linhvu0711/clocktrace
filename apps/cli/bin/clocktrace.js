#!/usr/bin/env node
// Committed shim so pnpm can link the bin on a clean clone, before `dist` exists.
await import("../dist/main.js");
