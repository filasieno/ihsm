# Changelog

All notable changes to `@ihsm/otel` are documented in this file.

## [0.1.21] - 2026-06-20

### Added

- Peer dependency floor `ihsm >= 0.1.21`.

## [0.1.20] - 2026-06-20

### Added

- First public npm release.

## [0.1.2] - 2026-06-20

### Added

- First public npm release — Node (`@ihsm/otel/node`), browser (`@ihsm/otel/browser`), and testing (`@ihsm/otel/testing`) entry points.
- OTLP trace and log bridge wired to ihsm `Instrumentation` callbacks (macrosteps, microsteps, port/outbound calls, transition hooks).
- Conformance specs under `src/spec/` (instrumentation seam, extended tracing, OTLP collector integration).
