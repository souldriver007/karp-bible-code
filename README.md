# KARP Bible Code

**ELS Bible code research engine for Claude Desktop.**

Search for hidden letter patterns encoded at equidistant spacing in the Bible's continuous text. Cross-reference terms, discover clusters, run statistical significance tests, and track your research in a persistent knowledge graph. Everything runs locally on your machine.

> *"It is the glory of God to conceal a thing: but the honour of kings is to search out a matter."* — Proverbs 25:2

---

## What's Inside

- **31,102 verses** — Complete KJV Bible, pre-loaded and ready
- **ELS search engine** — Scan for terms hidden at equidistant letter spacing across configurable streams (Genesis, Torah, Full Bible, or any book)
- **Proximity analysis** — Cross-reference two terms to find shared letter positions and closest approaches
- **Cluster detection** — Find dense regions where multiple terms converge
- **Monte Carlo statistics** — Test whether your findings are statistically significant or random noise
- **Research sessions** — Group related searches, track your journey over time
- **Sweep analysis** — Scan your entire research history for connections you never explicitly searched for
- **Full scripture tools** — Read, search, study, annotate (built on KARP Word Graph foundation)
- **Personal knowledge graph** — Save insights, cross-references, and study notes linked to passages
- **Web UI** — ELS Matrix visualiser at `localhost:3458`
- **Zero cloud dependencies** — All data stays on your machine

## Install

1. Open **Claude Desktop**
2. Go to **Settings → Extensions → Install Extension**
3. Select the `karp-bible-code.mcpb` file
4. **Done.** The KJV Bible is pre-loaded with the ELS engine ready.

No configuration needed. No data folder to pick. No setup steps.

## How It Works

On first startup, the server copies the pre-loaded scripture database to:

```
~/.karp-bible-code/graph.db
```

This is where your data lives — scripture, embeddings, ELS research history, study notes, everything. This file is **yours**. Back it up, move it, keep it safe.

- **Windows:** `C:\Users\YourName\.karp-bible-code\graph.db`
- **macOS:** `/Users/YourName/.karp-bible-code/graph.db`
- **Linux:** `/home/YourName/.karp-bible-code/graph.db`

**Note:** KARP Bible Code uses its own database, separate from KARP Word Graph. Both include the full KJV Bible and can run side by side without conflict.

## Dedicated Research Mode — Claude Projects

Out of the box, Claude treats Bible Code as one set of tools among many. To make ELS research the **focus**, create a Claude Project. This gives Claude a persistent set of instructions so every conversation opens in research mode — it will check your search history, remember your findings, and build on previous sessions.

### Setup (one time, takes 30 seconds)

1. **Create a new Project** — click **Projects → Create Project**. Give it a name like `KARP Bible Code` or `ELS Research`. In the "What do you want to achieve?" box, write a short note like `Bible code research` or `ELS analysis`.
2. **Click Create.**
3. **Add project instructions** — inside the project, click the **+ Project instructions** button and paste the example prompt below.
4. **Say hello!** Start a new conversation inside the project and greet Claude. It will check your research history and pick up where you left off.

### Example Project Prompt

Copy and paste this into your project instructions:

```
You are a Bible code research assistant. KARP Bible Code is your primary toolset
— the complete KJV Bible with ELS search, proximity analysis, cluster detection,
Monte Carlo statistics, and a personal knowledge graph.

At the start of each conversation, check els_research_stats and study_history
to pick up where the user left off. If no prior research exists, welcome them
and ask what terms or themes they'd like to explore.

When presenting ELS findings:
- Always read the verse context with read_scripture after a search
- Note when terms share exact letter positions (intersections)
- Highlight thematically relevant verse landings
- Use els_stats to test statistical significance of interesting findings
- Suggest related terms to cross-reference with els_proximity

Save important discoveries to the knowledge graph with remember (type: insight
or cross_ref) so they persist across sessions. Use connect to link related
findings into a research web.

Be honest about what the data shows. Present findings clearly and let the
user draw their own conclusions.
```

### Make It Yours

The prompt above is just a starting point. Add lines to customise:

- *"I'm researching Hebrew names and their ELS appearances. Focus on name searches and proximity analysis."*
- *"Run Monte Carlo on every finding with more than 2x expected hits. I want rigorous statistics."*
- *"I'm studying messianic prophecy patterns. Cross-reference terms like MESSIAH, YESHUA, LAMB against prophetic passages."*
- *"Keep a running log of every significant finding. Summarise connections at the end of each session."*

---

## Quick Start — What To Say To Claude

Once installed, just talk to Claude naturally:

| You say | Claude uses |
|---------|-----------|
| "Search for JESUS in the Torah" | `els_search` |
| "Search for MESSIAH across the full Bible" | `els_search` |
| "How close are JESUS and LAMB in Genesis?" | `els_proximity` |
| "Where do all my searched terms cluster together?" | `els_cluster` |
| "Is this statistically significant?" | `els_stats` |
| "Scan my research history for hidden connections" | `els_sweep` |
| "Create a session called Messianic Study" | `els_session` |
| "What have I searched for so far?" | `els_history` |
| "Show me my research stats" | `els_research_stats` |
| "Read Genesis 14:18" | `read_scripture` |
| "Find verses about the suffering servant" | `search_scripture` |
| "Let's study Romans 8:28 in depth" | `study_passage` |
| "Save this as an insight" | `remember` |
| "What did I find last session?" | `study_history` / `recall` |

## Tools Reference

### ELS Research Tools (9)

| Tool | What it does |
|------|-------------|
| `els_search` | Search for a term at equidistant letter spacing. Configure stream (Genesis, Torah, Full Bible, any book), skip range, and direction |
| `els_session` | Create, view, or list research sessions to group related searches |
| `els_history` | Browse past searches — filter by term, stream, or session |
| `els_streams` | List available letter streams with statistics and letter frequency analysis |
| `els_research_stats` | Aggregate stats — total sessions, searches, hits, top terms |
| `els_proximity` | Cross-reference two terms for shared positions and closest approaches |
| `els_cluster` | Find dense regions where multiple terms converge in a sliding window |
| `els_sweep` | Scan entire research history for unexpected connections between any terms |
| `els_stats` | Statistical significance — expected frequency, Poisson p-value, Monte Carlo simulation |

### Scripture Tools (7)

| Tool | What it does |
|------|-------------|
| `read_scripture` | Read verses by reference — "John 3:16", "Genesis 1:1-5", "Psalm 23" |
| `search_scripture` | Semantic search — finds passages by meaning across all 31,102 verses |
| `study_passage` | Deep study — verse text, surrounding context, your linked notes |
| `study_history` | Review your study activity — notes, prayers, questions, memory verses |
| `scripture_status` | Health check — verse counts, embedding coverage, study stats |
| `list_books` | All 66 books with chapter/verse counts. Filter by OT or NT |
| `re_embed_scriptures` | Rebuild passage embeddings (only needed if you modify the database) |

### Knowledge Graph Tools (8)

| Tool | What it does |
|------|-------------|
| `remember` | Save insights, cross-references, study notes, prayers linked to passages or ELS findings |
| `recall` | Semantic search across your personal notes and research history |
| `search` | Keyword search across your notes |
| `list` | Browse notes by type, date, or importance |
| `update` | Edit an existing note |
| `connect` | Link two notes together (e.g. ELS finding "discovered_in" a session) |
| `forget` | Delete a note |
| `snapshot` | Backup your entire database |

## ELS Streams

| Stream | Letters | Best for |
|--------|---------|----------|
| `genesis` | 151K | Fast exploration, initial searches |
| `torah` | 634K | Traditional Bible code research scope |
| `full` | 3.2M | Most comprehensive, slower |
| Any book (e.g. `rev`, `isa`) | Varies | Built on demand for focused study |

## Web UI

Open `http://localhost:3458` in your browser for the ELS Matrix visualiser. Protected by passphrase on first visit.

The port can be changed during installation if 3458 is already in use.

## Troubleshooting

### "Scripture not loaded" or 0 verses showing

The pre-loaded database may not have copied correctly. Check if the file exists:

```
~/.karp-bible-code/graph.db
```

If the file is missing or very small (< 1MB), the bundled database didn't copy. Re-install the extension or manually copy the bundled `data/graph.db` to `~/.karp-bible-code/graph.db`.

### Port conflict (localhost:3458 not loading)

Another server is using port 3458. Change it in Claude Desktop extension settings — look for the "Web UI Port" option.

### Database location

All your data is in a single file:

```
~/.karp-bible-code/graph.db
```

To back up: copy this file somewhere safe.
To reset: delete this file and restart — the pre-loaded Bible will be copied fresh (research history will be lost).
To move: copy the file to the new location and set `DATA_PATH` environment variable.

## Technical Details

- **Translation:** King James Version (public domain)
- **ELS engine:** Parallel skip-interval scanner with configurable streams and direction
- **Statistics:** Expected frequency, Poisson p-value, Monte Carlo shuffle simulation
- **Embedding model:** BGE-small-en-v1.5 via transformers.js (384 dimensions, ONNX runtime)
- **Database:** SQLite via sql.js (no native dependencies)
- **Server:** Node.js MCP server + Express web UI
- **Data path:** `~/.karp-bible-code/`
- **Web UI port:** 3458 (configurable)

---

Built by [SoulDriver](https://souldriver.com.au) — *"Search out a matter."*
