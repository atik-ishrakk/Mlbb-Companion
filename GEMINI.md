# MLBB Companion — Engineering & Architecture Standards

All development, modifications, and enhancements in this codebase must strictly adhere to the following 17 engineering principles across 4 core pillars:

---

## 1. Code-Level Quality & Design
- **Reusability**: Use existing shared modules, constants, and utilities (`heroes-items.js`, `recommender.js`, `patch-notes.js`, `matcher.py`) instead of duplicate implementations.
- **Modularity**: Maintain independent, single-responsibility components with clean interfaces. Keep Backend CV logic, Extension service workers, and UI controllers completely decoupled.
- **Readability**: Write self-documenting code with clear variable naming, concise comments, and clean structure. Avoid obscure hacks or convoluted nested logic.
- **Testability**: Ensure every module can be tested in isolation (e.g., pure-function hero recommendation engine, isolated template matching benchmarks).
- **Composability**: Build composable functions and UI elements that assemble seamlessly into new views or features without tight coupling.

---

## 2. System Evolution & Longevity
- **Scalability**: Design pipelines (ZNCC matcher, batch tensor normalization, WebSocket/polling feeds) capable of handling higher throughput and additional hero datasets effortlessly.
- **Maintainability**: Maintain clean, single-source-of-truth asset stores (`src/shared/assets/`) and unified styles (`navbar.css`, `main.css`). Eliminate redundant files and legacy bloat.
- **Extensibility**: Add support for new heroes, patches, equipment items, and game modes via declarative data structures without modifying core algorithm engines.
- **Flexibility**: Support both automatic live CV screen-capture auto-sync and manual interactive draft experimentation seamlessly.

---

## 3. Operations & Performance
- **Performance**: High-speed, low-latency execution (sub-10ms ZNCC matching, pure in-memory framebuffer processing, zero disk writes during live gameplay).
- **Reliability**: Deterministic state transitions for background daemons, switch toggles, and process controllers without polling race conditions.
- **Availability**: Keep web dashboards active, persistent, and accessible even when the emulator or backend server is in standby or restarting.
- **Robustness**: Graceful error handling across all network fetch requests, socket disconnects, missing emulator frames, and unexpected phase states.

---

## 4. Security, Monitoring & Governance
- **Observability**: Clear telemetry consoles, frame inference timing breakdowns, and structured JSON logs for real-time monitoring.
- **Interoperability**: Standard REST JSON endpoints (`/status`, `/cv/draft-scan`, `/launch`, `/shutdown`, `/api/close-bluestacks`) for seamless client-server integration.
- **Auditability**: Track draft state changes, patch balance versions, and system lifecycle events deterministically.
- **Security & Safety**: Loopback `127.0.0.1` socket binding, native Windows execution without unsafe script wrappers, and 100% Manifest V3 CSP compliance (no `eval`, no inline handlers).

---

## 5. Autonomous Execution & Direct Action
- **Zero Interactive Blocking**: Execute code changes, refactors, and tool runs immediately without pausing for interactive confirmation modals or multiple-choice questions.
- **Direct Execution**: Avoid blocking plan review gates when user intent is clear; inspect, implement, and verify tasks end-to-end autonomously.

