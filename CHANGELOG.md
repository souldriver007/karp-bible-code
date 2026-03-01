# Changelog

All notable changes to KARP Bible Code will be documented in this file.

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

**Web UI**
- Dark theme (SoulDriver aesthetic) at localhost:3457
- Scripture reader — browse all 66 books, chapter navigation, verse display
- Semantic scripture search from the browser
- Interactive D3 knowledge graph visualisation
- Node browser with filtering and search
- Type management with proposal approval
- Passphrase protection
- Responsive layout

**MCP Integration**
- 18 tools for Claude Desktop
- Enhanced tool descriptions with study companion personality
- Study flow hints — topical, devotional, deep dive, review, memorisation
- Presentation guidelines — reverent formatting, gentle follow-ups
- Study history continuity across conversations

**Infrastructure**
- Zero-config install via .mcpb bundle
- Pre-loaded database — no setup, no ingestion, no waiting
- Local-first — all data in ~/.karp-word-graph/graph.db
- SQLite via sql.js (no native dependencies)
- BGE-small-en-v1.5 embeddings via transformers.js (ONNX runtime)
- Express web server on configurable port (default 3457)

---

Built by [SoulDriver](https://souldriver.com.au) — Adelaide, Australia
