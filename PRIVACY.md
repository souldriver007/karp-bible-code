# Privacy Policy — KARP Bible Code

**Last updated:** February 2026

## Summary

KARP Bible Code runs 100% locally on your machine. Your data never leaves your computer.

## What Data Is Stored

- **Scripture text** — The KJV Bible (public domain) stored in a local SQLite database
- **Semantic embeddings** — Vector representations of scripture passages for search, stored locally
- **Study notes** — Any notes, prayers, insights, or other entries you create through Claude
- **Knowledge graph** — Connections between your study notes
- **Snapshots** — Backups of your database (created manually or before major operations)

All data is stored in a single file:
```
~/.karp-bible-code/graph.db
```

## What Data Is NOT Collected

- No analytics or telemetry
- No usage tracking
- No crash reports sent anywhere
- No network requests to external servers
- No cookies or browser tracking in the web UI
- No account creation required

## Where Data Lives

Everything stays on your machine in `~/.karp-bible-code/`. The web UI runs on `localhost:3458` and is only accessible from your own computer.

## Embedding Model

The semantic search uses the BGE-small-en-v1.5 model via transformers.js. The model runs locally — no text is sent to any API for embedding. The model files are cached locally after first download.

## Web UI Security

The web UI at `localhost:3458` is protected by a passphrase you set on first visit. It only listens on `127.0.0.1` (localhost) and is not accessible from other devices on your network.

## Data Portability

Your data is yours. The `graph.db` file is a standard SQLite database that you can:
- Back up by copying the file
- Move to another machine
- Open with any SQLite browser
- Delete at any time to reset completely

## Third-Party Services

KARP Bible Code makes **zero** network requests during normal operation. The only external dependency is the initial `npm install` for Node.js packages, which happens once during development/build.

## Contact

Questions about privacy? Reach out at [souldriver.com.au](https://souldriver.com.au).

---

Built by SoulDriver — Adelaide, Australia
