# Vendored `axi-sdk-js`

This is a **committed build** of [`axi-sdk-js`](https://github.com/kunchenguid/axi/tree/main/packages/axi-sdk-js)
(v0.1.8), the shared SDK the real AXI project ships. The demo depends on it via
`"axi-sdk-js": "file:./vendor/axi-sdk-js"` so the repo is fully self-contained:
it installs, builds, and runs offline, and CI needs no sibling checkout. The SDK
is not published to npm, which is why it's vendored rather than pulled from a
registry.

## Provenance — how this build was produced

Built from a local clone of `kunchenguid/axi` with **one** source change:
`packages/axi-sdk-js/src/index.ts` gained `export * from "./output.js";` so that
`renderOutput` (and the other output helpers) are reachable from the package
entry point. Upstream imports `renderOutput` internally but does not re-export
it, so `import { renderOutput } from "axi-sdk-js"` — the form the talk's slides
and `src/axi.ts` use — does not resolve against an unmodified 0.1.8. The one-line
export makes the genuine SDK API public; everything else is the stock build.

To refresh: rebuild the SDK in the axi repo (`tsc -p tsconfig.json` inside
`packages/axi-sdk-js`) and copy its `dist/` here.
