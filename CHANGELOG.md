# Changelog

All notable changes to KARP Bible Code will be documented in this file.

## [1.0.1] — 2026-03-01

### 🐛 Bug Fixes
- **Fixed: ELS Matrix features (hover, verse context, letters) only worked for Genesis** — Root cause was a race condition in stream loading where the cache check used the already-updated `streamId` instead of tracking what was actually loaded in memory. Added separate `loadedStreamId` tracker. Matrix now works correctly for Torah, Full Bible, and all individual books.
- **Fixed: Reset All properly clears stream data** — `matrixClearAll()` now resets `streamLetters`, `verseIndex`, `loadedStreamId`, and `streamData` so the next search loads fresh.

### 🛡️ Safety Guards
- **Minimum term length enforced (3 letters)** — 2-letter terms like "AI" caused combinatorial explosion (hundreds of thousands of hits), overloading the stdio MCP server and crashing Claude Desktop. Guard enforced at engine level (worker threads + sync/parallel search), MCP tool handler, web API endpoint, and UI input validation.
- **Hit cap with early termination (10,000 max)** — If any search exceeds 10,000 hits, workers terminate early and return what they have with a `hits_capped: true` flag. Prevents memory exhaustion and stdio buffer overflow. Cap distributed across worker threads proportionally.
- **Capped warning in Matrix UI** — Toast notification warns user when hit cap is reached and suggests narrower skip range or longer term.
- **Crash-resilient stdio server** — Global `uncaughtException` and `unhandledRejection` handlers prevent process exit. `safeWrite()` function catches serialization errors and oversized responses (>10MB) before they hit stdout. Stdio loop returns error responses on failure instead of crashing, so Claude Desktop stays connected. Memory monitoring warns at 500MB+ heap usage. On stdin close (Desktop disconnect), server stays alive for web UI.

### ✨ New Features
- **Per-book search dropdown** — Stream selector now includes all 66 individual books organised by testament (Old Testament / New Testament optgroups), plus OT and NT composite streams. Books populated dynamically from scripture API. Backend already supported on-demand book streams — this was a UI-only addition.

### 📝 Changelog fixes
- Corrected Web UI port references (3458, not 3457)
- Corrected data path references (~/.karp-bible-code, not ~/.karp-word-graph)

## [1.0.0] — 2026-03-01

### 🏷️ First Tagged Release
- Tagged and pushed to GitHub as v1.0.0
- Clean database prepared for distribution
- Repository configured with topic tags

## [0.1.0] — 2026-02-28

### 🎉 Initial Release

**Scripture**
- Complete KJV Bible loaded — 31,102 verses across 66 books
- 15,857 semantic passage embeddings (3-verse sliding windows)
- Natural reference parsing — "John 3:16", "Genesis 1:1-5", "Psalm 23"
- Semantic search — find passages by meaning, not just keywords
- Deep study mode — verse text with surrounding context and linked notes
- Testament filtering (OT/NT) for focused searches

**Knowledge Graph**
- 12 built-in study types: study_note, prayer, teaching, cross_ref, question, memory_verse, insight, memory, decision, todo, changelog, dev_session
- Custom node types via proposal system (approved in web UI)
- Semantic search across personal notes
- Named relationships between nodes (fulfills, echoes, contrasts, inspired_by, etc.)
- Database snapshots for backup
- Full JSON export

**ELS Research Engine**
- Equidistant Letter Spacing search across genesis, torah, and full Bible streams
- Parallel multi-threaded search using worker_threads
- Position-to-verse binary search mapping
- Session management for grouped research
- Persistent research ledger — every search auto-saved
- Proximity analysis — cross-reference any two terms
- Cluster detection — find dense regions of convergence
- Sweep — scan entire history for unexpected connections
- Statistical significance testing — expected frequency, Poisson p-value, Monte Carlo simulation

**ELS Matrix Web UI**
- Interactive canvas letter grid with zoom, scroll, and pan
- Multi-term overlay with colour-coded hit highlighting
- Constellation lines for non-aligned terms
- Intersection detection with pulsing glow animation
- Click-to-focus with auto verse context loading
- Spin animation when aligning grid to a term's skip interval
- Load searches from MCP history into the matrix
- Statistics panel with Poisson and Monte Carlo analysis

**Web UI**
- Dark theme (SoulDriver aesthetic) at localhost:3458
- Scripture reader — browse all 66 books, chapter navigation, verse display
- Semantic scripture search from the browser
- Interactive D3 knowledge graph visualisation
- Node browser with filtering and search
- Type management with proposal approval
- Passphrase protection with first-run setup
- Responsive layout

**MCP Integration**
- 27 tools for Claude Desktop
- Enhanced tool descriptions with research companion personality
- Study flow hints — topical, devotional, deep dive, review, memorisation
- Presentation guidelines — reverent formatting, gentle follow-ups
- Study history continuity across conversations

**Infrastructure**
- Zero-config install via .mcpb bundle
- Pre-loaded database — no setup, no ingestion, no waiting
- Local-first — all data in ~/.karp-bible-code/graph.db
- SQLite via sql.js (no native dependencies)
- BGE-small-en-v1.5 embeddings via transformers.js (ONNX runtime)
- Express web server on configurable port (default 3458)

---

Built by [SoulDriver](https://souldriver.com.au) — Adelaide, Australia
