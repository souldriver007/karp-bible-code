// ============================================================================
// KARP Bible Code — MCP Server + Web UI
// Version: 1.0.0
// Author: SoulDriver (Adelaide, Australia)
// Description: AI-assisted ELS Bible code research with semantic-code
//              correlation. Fork of KARP Word Graph — same scripture DB,
//              new cryptographic research engine.
//              "It is the glory of God to conceal a thing: but the honour
//               of kings is to search out a matter." — Proverbs 25:2
// License: MIT
// ============================================================================

const readline = require('readline');
const path = require('path');
const fs = require('fs');
const express = require('express');

// Import modules
const database = require('./database');
const embeddings = require('./embeddings');
const search = require('./search');
const auth = require('./auth');
const elsEngine = require('./els_engine');
const elsSessions = require('./els_sessions');
const elsProximity = require('./els_proximity');
const elsStats = require('./els_stats');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const VERSION = '1.0.1';
const SERVER_NAME = 'karp-bible-code';
const DATA_PATH = path.join(require('os').homedir(), '.karp-bible-code');
const BUNDLE_PATH = process.env.BUNDLE_PATH || path.join(__dirname, '..');
const UI_PORT = parseInt(process.env.UI_PORT || '3458', 10);
const UI_PASSWORD = process.env.UI_PASSWORD || '';

// Logging to stderr (stdout reserved for MCP protocol)
function log(level, msg) {
    process.stderr.write(`${new Date().toISOString()} [${level}] ${msg}\n`);
}

// ---------------------------------------------------------------------------
// First-Run: Copy bundled database if no local DB exists
// ---------------------------------------------------------------------------

function ensureDataPath() {
    if (!fs.existsSync(DATA_PATH)) {
        fs.mkdirSync(DATA_PATH, { recursive: true });
        log('INFO', `Created data directory: ${DATA_PATH}`);
    }

    const localDB = path.join(DATA_PATH, 'graph.db');
    if (!fs.existsSync(localDB)) {
        const bundledDB = path.join(BUNDLE_PATH, 'data', 'graph.db');
        if (fs.existsSync(bundledDB)) {
            log('INFO', 'First run — copying pre-loaded scripture database...');
            fs.copyFileSync(bundledDB, localDB);
            const sizeMB = (fs.statSync(localDB).size / 1024 / 1024).toFixed(1);
            log('INFO', `Database ready (${sizeMB} MB) — 31,102 verses + semantic embeddings`);
        } else {
            log('INFO', 'No bundled database found — starting fresh (run npm run ingest to load scripture)');
        }
    } else {
        log('INFO', `Using existing database: ${localDB}`);
    }
}

// ---------------------------------------------------------------------------
// Tool Definitions
// ---------------------------------------------------------------------------

const TOOLS = [

    // ===================================================================
    // KARP BIBLE CODE — ELS RESEARCH COMPANION TOOL SYSTEM
    // ===================================================================
    //
    // You are equipped with an Equidistant Letter Spacing (ELS) research
    // engine backed by the complete KJV Bible (31,102 verses, 66 books).
    // You can search for hidden letter patterns encoded at skip intervals,
    // map their positions to verse references, cross-reference multiple
    // terms for proximity and clustering, and run statistical significance
    // tests. Every search is auto-saved to a persistent research ledger.
    //
    // RESEARCH COMPANION GUIDELINES:
    // - This is a research tool, not a fortune-telling machine. Present
    //   findings with statistical rigour and intellectual honesty.
    // - When patterns appear, describe them factually. Let the data speak.
    // - Always map hits to verse references — context matters immensely.
    //   A hidden word landing in a thematically related passage is far
    //   more interesting than a random hit in an unrelated chapter.
    // - Suggest related terms to search based on theological knowledge.
    //   If they search JESUS, suggest MESSIAH, CHRIST, YESHUA.
    //   If they search a family name, suggest alternate spellings.
    // - Use sessions to group related research (e.g. "Sharman Family",
    //   "Messianic Study", "Genesis Patterns").
    // - After finding hits, suggest proximity analysis between terms.
    //   The real discoveries come from clusters, not isolated finds.
    //
    // RESEARCH FLOWS (chain tools in this order):
    // 1. Quick find:  els_search → review hits + verse context
    // 2. Comparison:  els_search (term A) → els_search (term B) → els_proximity
    // 3. Family study: els_session (create) → multiple els_search → els_cluster
    // 4. Significance: els_search → els_stats (Poisson + Monte Carlo)
    // 5. Deep dive:    els_sweep (find unexpected connections in history)
    //
    // MINIMUM TERM LENGTH: 4+ letters recommended for meaningful results.
    //   3-letter terms can produce hundreds of thousands of hits (noise).
    //   If someone searches a 3-letter term, warn them and suggest longer.
    //
    // STREAM OPTIONS:
    //   genesis  — Genesis only (151,843 letters) — fast, focused
    //   torah    — Pentateuch/Torah (634,378 letters) — traditional ELS scope
    //   full     — Full KJV Bible (3,222,423 letters) — comprehensive
    //   ot/nt    — Old/New Testament subsets
    //   Any book abbreviation (gen, exo, rev, etc.) — built on demand
    //
    // ===================================================================

    // ---------------------------------------------------------------
    // ELS Core Search
    // ---------------------------------------------------------------

    {
        name: 'els_search',
        description: `Search for a term encoded at equidistant letter spacing (ELS) in the Bible's continuous letter stream. This is the core research tool — it finds hidden words spelled out at regular skip intervals across the text.

HOW IT WORKS: The Bible text is stripped to uppercase A-Z letters to form a continuous stream. The engine checks every possible starting position and skip interval to find where the letters of your term appear at equal spacing. For example, "JESUS" at skip 186 means the letters J-E-S-U-S appear every 186th letter in the stream.

EVERY SEARCH IS AUTO-SAVED with all hit positions and verse mappings. This builds your research ledger over time — searches from today can be cross-referenced against searches from weeks ago via els_sweep.

CHOOSING A STREAM:
- "genesis" (151K letters) — fastest, great for initial exploration
- "torah" (634K letters) — traditional Bible code research scope
- "full" (3.2M letters) — most comprehensive but slower
- Any book abbreviation (e.g. "rev", "isa") — built on demand

SKIP RANGE: Default 1-3000. For Torah, 1-5000 is common. Wider ranges find more hits but take longer. For quick checks, 1-1000 is fast.

RESULTS include: hit count, skip intervals, and verse references for each hit's start, midpoint, and end positions. After searching, suggest checking proximity with other terms or running stats.

TIPS:
- 4+ letter terms give meaningful results. 3-letter terms produce noise.
- Use session_id to group related searches (e.g. family name study).
- Direction "both" searches forward AND reverse — doubles the search space.
- After multiple searches, use els_proximity or els_cluster on cached data.`,
        annotations: { title: 'ELS Search', readOnlyHint: false },
        inputSchema: {
            type: 'object',
            properties: {
                term: { type: 'string', description: 'Term to search for (letters only, 3+ chars required, 4+ recommended)' },
                stream: { type: 'string', description: 'Letter stream scope: genesis, torah, full, ot, nt, or any book abbreviation (default: torah)', default: 'torah' },
                skip_min: { type: 'integer', description: 'Minimum skip interval (default: 1)', default: 1 },
                skip_max: { type: 'integer', description: 'Maximum skip interval (default: 3000)', default: 3000 },
                direction: { type: 'string', enum: ['forward', 'reverse', 'both'], description: 'Search direction (default: both)', default: 'both' },
                session_id: { type: 'string', description: 'Session to attach this search to (optional — auto-creates default session if not specified)' }
            },
            required: ['term']
        }
    },

    // ---------------------------------------------------------------
    // ELS Session Management
    // ---------------------------------------------------------------

    {
        name: 'els_session',
        description: `Create, view, or list ELS research sessions. Sessions group related searches together — for example, "Sharman Family" groups all family name searches, "Messianic Study" groups searches for messianic terms.

ACTIONS:
- create: Start a new session with a name and optional notes
- view: Get a session's details and all its searches
- list: Browse all sessions with search counts
- update: Change a session's name or add notes
- delete: Remove a session and all its searches/hits (destructive!)

When starting a new research topic, create a named session first, then pass its session_id to each els_search call. This keeps research organized and enables session-level cluster analysis later.`,
        annotations: { title: 'ELS Session', readOnlyHint: false },
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['create', 'view', 'list', 'update', 'delete'], description: 'What to do' },
                session_id: { type: 'string', description: 'Session ID (for view/update/delete)' },
                name: { type: 'string', description: 'Session name (for create/update)' },
                notes: { type: 'string', description: 'Session notes (for create/update)' },
                limit: { type: 'integer', description: 'Max sessions to return (for list)', default: 20 }
            },
            required: ['action']
        }
    },

    // ---------------------------------------------------------------
    // ELS History
    // ---------------------------------------------------------------

    {
        name: 'els_history',
        description: `Browse past ELS searches with filters. Every search ever run is saved — this tool lets you explore that research ledger.

Use this to:
- See what terms have been searched ("What have I looked for before?")
- Find a specific past search to review its hits
- Filter by term, stream, or session
- Get a list of all unique terms searched (for sweep analysis)

When starting a new conversation, check history first — the user may have done extensive prior research that you should build on.`,
        annotations: { title: 'ELS History', readOnlyHint: true },
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['searches', 'terms', 'search_detail'], description: 'What to browse: recent searches, unique terms searched, or a specific search detail' },
                search_id: { type: 'string', description: 'Specific search ID (for search_detail)' },
                term: { type: 'string', description: 'Filter by term (for searches)' },
                stream_id: { type: 'string', description: 'Filter by stream (for searches/terms)' },
                session_id: { type: 'string', description: 'Filter by session (for searches)' },
                limit: { type: 'integer', description: 'Max results (default 20)', default: 20 }
            },
            required: ['action']
        }
    },

    // ---------------------------------------------------------------
    // ELS Streams
    // ---------------------------------------------------------------

    {
        name: 'els_streams',
        description: `List available letter streams with statistics. Shows which streams are pre-built and cached, which can be built on demand, and letter counts for each.

Pre-built on server start: genesis (151K), torah (634K), full (3.2M).
On-demand: any of the 66 book abbreviations (gen, exo, lev, etc.)

Also shows letter frequency analysis — useful for understanding expected ELS frequencies and calculating statistical significance.`,
        annotations: { title: 'ELS Streams', readOnlyHint: true },
        inputSchema: {
            type: 'object',
            properties: {
                stream_id: { type: 'string', description: 'Get detailed info for a specific stream (optional)' },
                show_frequency: { type: 'boolean', description: 'Include letter frequency breakdown (default: false)', default: false }
            }
        }
    },

    // ---------------------------------------------------------------
    // ELS Research Stats
    // ---------------------------------------------------------------

    {
        name: 'els_research_stats',
        description: `Get aggregate statistics for the Bible code research system. Shows total sessions, searches, hits, unique terms, top searched terms, and recent sessions. Use this at the start of a conversation to understand the user's research journey so far.`,
        annotations: { title: 'ELS Stats', readOnlyHint: true },
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },

    // ---------------------------------------------------------------
    // ELS Proximity — Pairwise distance between two terms
    // ---------------------------------------------------------------

    {
        name: 'els_proximity',
        description: `Cross-reference two terms from your research history to find how close they appear in the letter stream. Runs on CACHED hit positions from past searches — instant, no re-scanning.

This is how you discover that ADRIAN and SHARMAN are just 2 letters apart at Mark 11:3, or that MATZR and ADRIAN share exact letter positions at Nehemiah 8:17.

WHAT IT FINDS:
- Intersections: positions where both terms share the exact same letter (e.g. the 'A' at position 1,234,567 is used by both ADRIAN skip 42 and SHARMAN skip 108)
- Closest pairs: the nearest approaches between all hits of term A and all hits of term B, ranked by distance
- Closest region: the verse range where the two terms come nearest

BOTH TERMS MUST HAVE BEEN SEARCHED FIRST via els_search. This tool reads from the saved hit positions, not the raw letter stream.

After finding close pairs, use read_scripture to check the verse context — a 4-letter distance in a thematically relevant passage is far more interesting than in a random chapter.`,
        annotations: { title: 'ELS Proximity', readOnlyHint: true },
        inputSchema: {
            type: 'object',
            properties: {
                term_a: { type: 'string', description: 'First term (must have been searched already)' },
                term_b: { type: 'string', description: 'Second term (must have been searched already)' },
                stream: { type: 'string', description: 'Stream to analyse in (default: torah)', default: 'torah' },
                max_pairs: { type: 'integer', description: 'Max closest pairs to return (default: 20)', default: 20 },
                max_distance: { type: 'integer', description: 'Only show pairs within this letter distance (optional — null shows all)' }
            },
            required: ['term_a', 'term_b']
        }
    },

    // ---------------------------------------------------------------
    // ELS Cluster — Sliding window density finder
    // ---------------------------------------------------------------

    {
        name: 'els_cluster',
        description: `Find the densest regions where multiple search terms converge in the letter stream. Uses a sliding window across all cached hit positions to locate clusters.

This is the tool that discovers things like 4 Sharman family members appearing in Genesis 10 (Table of Nations) within a 28-verse span, or MESSIAH/ADRIAN/SHARMAN converging in Numbers 21-24 (Balaam narrative).

HOW IT WORKS:
1. Gathers all cached hits for the specified terms (or all terms in a session)
2. Sorts every hit position into a single timeline
3. Slides a window across the timeline, counting distinct terms at each position
4. Reports regions with the highest concentration of different terms

Can analyse:
- All terms in a named session (pass session_id)
- A specific list of terms (pass terms array)
- All terms ever searched in a stream (default — the full research history)

Terms with >10,000 hits are excluded by default (statistical noise from short words like ANN). The window_size parameter controls how "close" terms need to be — default 10,000 letters ≈ roughly 50-80 verses.`,
        annotations: { title: 'ELS Cluster', readOnlyHint: true },
        inputSchema: {
            type: 'object',
            properties: {
                stream: { type: 'string', description: 'Stream to analyse (default: torah)', default: 'torah' },
                session_id: { type: 'string', description: 'Analyse terms from this session (optional)' },
                terms: { type: 'array', items: { type: 'string' }, description: 'Explicit list of terms to cluster (optional — overrides session)' },
                window_size: { type: 'integer', description: 'Sliding window size in letters (default: 10000)', default: 10000 },
                min_terms: { type: 'integer', description: 'Minimum distinct terms for a cluster (default: 2)', default: 2 },
                max_results: { type: 'integer', description: 'Max clusters to return (default: 10)', default: 10 }
            },
            required: ['stream']
        }
    },

    // ---------------------------------------------------------------
    // ELS Sweep — Full history cross-reference (THE KILLER FEATURE)
    // ---------------------------------------------------------------

    {
        name: 'els_sweep',
        description: `THE KILLER FEATURE: Scan your entire ELS research history for connections you never explicitly searched for.

For every pair of terms ever searched in the same stream, computes proximity and checks for shared letter positions. A term searched in January might be 4 letters from a term searched in March — you'd never know without the sweep.

HOW IT WORKS:
1. Loads ALL cached hits for ALL terms in the specified stream
2. Checks every possible pair of terms (n*(n-1)/2 comparisons)
3. Uses an optimised merge-scan (not brute force) for each pair
4. Reports pairs that are within max_distance letters OR share exact positions
5. Ranks results by a relevance score (intersections > close distance)

WHEN TO USE:
- After building up a research ledger with many searches over time
- When starting a new session — sweep first to see what history reveals
- Periodically, as new searches may create connections with old ones

Results are sorted by significance: shared letter positions rank highest, then closest distances. Follow up interesting pairs with els_proximity for full detail and read_scripture for verse context.`,
        annotations: { title: 'ELS Sweep', readOnlyHint: true },
        inputSchema: {
            type: 'object',
            properties: {
                stream: { type: 'string', description: 'Stream to sweep (default: torah)', default: 'torah' },
                max_distance: { type: 'integer', description: 'Only report pairs within this letter distance (default: 500)', default: 500 },
                max_results: { type: 'integer', description: 'Max connections to return (default: 30)', default: 30 },
                min_term_length: { type: 'integer', description: 'Minimum term length to include (default: 4)', default: 4 }
            },
            required: ['stream']
        }
    },

    // ---------------------------------------------------------------
    // ELS Statistics — Significance testing
    // ---------------------------------------------------------------

    {
        name: 'els_stats',
        description: `Statistical significance testing for ELS findings. Answers the question: "Is this pattern real or random?"

THREE METHODS (run individually or combined):

1. EXPECTED FREQUENCY (instant): Calculates how many hits you'd expect purely from letter probabilities. If 'E' appears 12.7% of the time and 'S' appears 6.2%, a 5-letter term has a calculable expected frequency across all skip intervals.

2. POISSON P-VALUE (instant): Compares your observed hit count against the expected frequency. P < 0.05 means the observed count is unlikely by chance. P < 0.001 means extremely unlikely.

3. MONTE CARLO (takes time): The gold standard. Shuffles the letter stream N times (preserving letter frequencies), counts ELS hits in each shuffled version, and reports how many shuffled texts produced as many or more hits than the real Bible. If 0 out of 100 shuffled texts match → p < 0.01. Uses parallel workers across CPU cores.

ACTIONS:
- expected: Just the expected frequency calculation (instant)
- poisson: Expected frequency + Poisson p-value (instant)
- monte_carlo: Shuffled text comparison only (takes 10s-5min depending on params)
- full: All three methods combined (recommended for thorough analysis)

RECOMMENDED FLOW:
1. Run els_search to find hits
2. Run els_stats action="poisson" for a quick significance check
3. If interesting (ratio > 1.5 or p < 0.1), run action="monte_carlo" for confirmation

MONTE CARLO TIPS:
- mc_runs=50 is a quick check (~30 seconds for genesis)
- mc_runs=100 is standard (~1 minute)
- mc_runs=500 is thorough (~5 minutes)
- mc_max_skip should match your original search. Narrower = faster but less accurate.
- Torah-scale Monte Carlo with 100 runs takes 2-5 minutes. Be patient.

Results are saved to the database when search_id is provided, building a statistical record alongside your research ledger.`,
        annotations: { title: 'ELS Statistics', readOnlyHint: true },
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['expected', 'poisson', 'monte_carlo', 'full'], description: 'Which analysis to run', default: 'poisson' },
                term: { type: 'string', description: 'The term to analyse' },
                stream: { type: 'string', description: 'Stream (default: torah)', default: 'torah' },
                observed: { type: 'integer', description: 'Observed hit count from els_search' },
                skip_min: { type: 'integer', description: 'Min skip from original search (default: 1)', default: 1 },
                skip_max: { type: 'integer', description: 'Max skip from original search (default: 3000)', default: 3000 },
                direction: { type: 'string', enum: ['forward', 'reverse', 'both'], description: 'Direction from original search (default: both)', default: 'both' },
                mc_runs: { type: 'integer', description: 'Monte Carlo runs (default: 100)', default: 100 },
                mc_max_skip: { type: 'integer', description: 'Max skip for Monte Carlo (narrower = faster, default: matches skip_max up to 1000)' },
                search_id: { type: 'string', description: 'Search ID to save results against (optional)' }
            },
            required: ['term', 'observed']
        }
    },

    // ===================================================================
    // Word Graph Tools (inherited — devotional study companion)
    // ===================================================================
    //
    // These are the same tools from KARP Word Graph. They share the same
    // graph.db database. Study notes, prayers, and insights from
    // devotional study can be connected to ELS research findings.

    {
        name: 'remember',
        description: 'Store a study note, prayer, insight, question, cross-reference, memory verse, or any other type in the personal knowledge graph. For ELS findings: use type "insight" or "cross_ref" and include the verse references in context. For scripture-related entries, set the context field to the passage reference (e.g. "ROM.8.28") so study_passage can surface it later.',
        annotations: { title: 'Remember', readOnlyHint: false },
        inputSchema: {
            type: 'object',
            properties: {
                type: { type: 'string', description: 'Node type: study_note, prayer, insight, cross_ref, question, memory_verse, memory, todo, decision, or any custom type' },
                summary: { type: 'string', description: 'Brief summary (required)' },
                detail: { type: 'string', description: 'Detailed content (optional)' },
                context: { type: 'string', description: 'Context — use passage reference for scripture-linked notes (e.g. "GEN.27.19")' },
                tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization' },
                importance: { type: 'number', description: 'Importance 0-1 (default 0.5)' },
                metadata: { type: 'object', description: 'Additional structured fields' },
                connect_to: { type: 'string', description: 'Optional: ID of existing node to connect to' },
                relationship: { type: 'string', description: 'Relationship name if connect_to is set' }
            },
            required: ['type', 'summary']
        }
    },
    {
        name: 'recall',
        description: 'Semantic search across personal study notes, prayers, insights, and knowledge graph. Finds entries by meaning, not just keywords. Use to check if the user has prior notes on a topic or passage before starting new research.',
        annotations: { title: 'Recall', readOnlyHint: true },
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Natural language search query' },
                limit: { type: 'integer', description: 'Max results (default 10)', default: 10 },
                type: { type: 'string', description: 'Filter by node type (optional)' }
            },
            required: ['query']
        }
    },
    {
        name: 'forget',
        description: 'Delete a node from the knowledge graph by ID. Permanent. Always confirm with the user first.',
        annotations: { title: 'Forget', readOnlyHint: false, destructiveHint: true },
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'Node ID to delete' }
            },
            required: ['id']
        }
    },
    {
        name: 'update',
        description: 'Edit an existing node. Only provided fields are updated — everything else stays the same.',
        annotations: { title: 'Update', readOnlyHint: false },
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'Node ID to update' },
                summary: { type: 'string' },
                detail: { type: 'string' },
                context: { type: 'string' },
                tags: { type: 'array', items: { type: 'string' } },
                importance: { type: 'number' },
                metadata: { type: 'object' }
            },
            required: ['id']
        }
    },
    {
        name: 'connect',
        description: 'Create a named relationship between two nodes in the knowledge graph. Great for linking ELS findings to study notes, or connecting discoveries across sessions.',
        annotations: { title: 'Connect', readOnlyHint: false },
        inputSchema: {
            type: 'object',
            properties: {
                source_id: { type: 'string', description: 'Source node ID' },
                target_id: { type: 'string', description: 'Target node ID' },
                relationship: { type: 'string', description: 'Relationship name (e.g. discovered_in, echoes, fulfills)' }
            },
            required: ['source_id', 'target_id', 'relationship']
        }
    },
    {
        name: 'search',
        description: 'Keyword search across knowledge graph node summaries and details. Use for exact terms or passage references.',
        annotations: { title: 'Search KG', readOnlyHint: true },
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Keyword search query' },
                limit: { type: 'integer', default: 20 },
                type: { type: 'string', description: 'Filter by type (optional)' }
            },
            required: ['query']
        }
    },
    {
        name: 'list',
        description: 'Browse knowledge graph by type, tags, or date.',
        annotations: { title: 'List KG', readOnlyHint: true },
        inputSchema: {
            type: 'object',
            properties: {
                type: { type: 'string' },
                tags: { type: 'array', items: { type: 'string' } },
                limit: { type: 'integer', default: 20 },
                offset: { type: 'integer', default: 0 },
                sort: { type: 'string', enum: ['created', 'updated', 'importance'] },
                order: { type: 'string', enum: ['asc', 'desc'] }
            }
        }
    },
    {
        name: 'kg_status',
        description: 'Knowledge graph health check — node counts, database size, embedding coverage, ELS research stats.',
        annotations: { title: 'KG Status', readOnlyHint: true },
        inputSchema: { type: 'object', properties: {} }
    },
    {
        name: 'snapshot',
        description: 'Create a backup snapshot of the database. Suggested before bulk operations.',
        annotations: { title: 'Snapshot', readOnlyHint: false },
        inputSchema: {
            type: 'object',
            properties: { reason: { type: 'string' } }
        }
    },

    // ===================================================================
    // Scripture Tools (inherited from Word Graph)
    // ===================================================================

    {
        name: 'read_scripture',
        description: 'Read specific scripture verses from the complete KJV Bible (31,102 verses, 66 books). Accepts natural references like "John 3:16", "Genesis 1:1-5", "Psalm 23" or abbreviated formats like "ROM.8.28". Essential for checking the context of ELS findings — when a hidden word lands in a verse, you need to read it.',
        annotations: { title: 'Read Scripture', readOnlyHint: true },
        inputSchema: {
            type: 'object',
            properties: {
                reference: { type: 'string', description: 'Natural reference like "John 3:16" or "GEN.1.1"' },
                book: { type: 'string', description: 'Book abbreviation (alternative to reference)' },
                chapter: { type: 'integer' },
                verse_start: { type: 'integer' },
                verse_end: { type: 'integer' }
            }
        }
    },
    {
        name: 'search_scripture',
        description: 'Semantic search across all 31,102 KJV verses — finds passages by MEANING. Use to find thematically related passages when an ELS hit lands in an interesting verse. If MESSIAH appears at skip 36 starting in Numbers 22, search for "Balaam prophecy messianic" to understand the context.',
        annotations: { title: 'Search Scripture', readOnlyHint: true },
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Natural language search' },
                limit: { type: 'integer', default: 10 },
                book: { type: 'string', description: 'Limit to book (optional)' },
                testament: { type: 'string', enum: ['OT', 'NT'] }
            },
            required: ['query']
        }
    },
    {
        name: 'study_passage',
        description: 'Deep study mode — verse text with surrounding context and user\'s study notes. Use after ELS search to examine the passage where a hit lands.',
        annotations: { title: 'Study Passage', readOnlyHint: true },
        inputSchema: {
            type: 'object',
            properties: {
                reference: { type: 'string', description: 'Scripture reference' },
                context_window: { type: 'integer', default: 3 }
            },
            required: ['reference']
        }
    },
    {
        name: 'study_history',
        description: 'Review the user\'s study journey — recent notes, prayers, questions, insights.',
        annotations: { title: 'Study History', readOnlyHint: true },
        inputSchema: {
            type: 'object',
            properties: {
                limit: { type: 'integer', default: 20 },
                type: { type: 'string' }
            }
        }
    },
    {
        name: 'scripture_status',
        description: 'Health check for the scripture database and ELS engine.',
        annotations: { title: 'Scripture Status', readOnlyHint: true },
        inputSchema: { type: 'object', properties: {} }
    },
    {
        name: 'list_books',
        description: 'List all 66 books of the Bible with chapter counts, verse counts, and testament.',
        annotations: { title: 'List Books', readOnlyHint: true },
        inputSchema: {
            type: 'object',
            properties: {
                testament: { type: 'string', enum: ['OT', 'NT'] }
            }
        }
    }
];

// ---------------------------------------------------------------------------
// Tool Router
// ---------------------------------------------------------------------------

async function handleToolCall(name, args) {
    switch (name) {

        // ===============================================================
        // ELS RESEARCH TOOLS
        // ===============================================================

        case 'els_search': {
            const term = (args.term || '').toUpperCase().replace(/[^A-Z]/g, '');
            if (!term || term.length < 3) {
                return { error: 'Term must be at least 3 letters (A-Z only). Short terms produce too many hits and can crash the server. 4+ letters recommended for meaningful results.' };
            }

            // Warn about short terms
            let warning = null;
            if (term.length === 3) {
                warning = `⚠️ Short term "${term}" (3 letters) may produce many hits. 4+ letters recommended for meaningful ELS research.`;
            }

            const streamId = args.stream || 'torah';

            // Ensure stream is loaded
            try {
                elsEngine.getStream(streamId);
            } catch (err) {
                return { error: `Failed to load stream "${streamId}": ${err.message}. Use els_streams to see available options.` };
            }

            // Run the search
            const result = await elsEngine.search(streamId, term, {
                minSkip: args.skip_min || 1,
                maxSkip: args.skip_max || 3000,
                direction: args.direction || 'both',
                parallel: true,
                mapVerses: true
            });

            // Auto-save to session
            const saveResult = elsSessions.saveSearch(result, args.session_id || null);

            // Build response — summarize hits (don't dump thousands)
            const maxHitsToShow = 25;
            const hitsToShow = result.hits.slice(0, maxHitsToShow);

            const response = {
                search_id: saveResult.search_id,
                session_id: saveResult.session_id,
                term: result.term,
                stream: result.stream_id,
                stream_name: result.stream_name,
                total_letters: result.total_letters,
                hit_count: result.hit_count,
                hits_capped: result.hits_capped || false,
                max_hits: result.max_hits,
                elapsed_ms: result.elapsed_ms,
                search_mode: result.search_mode,
                skip_range: result.skip_range,
                direction: result.direction,
                hits: hitsToShow.map(h => ({
                    skip: h.skip,
                    direction: h.direction,
                    start_pos: h.start,
                    start_verse: h.start_verse,
                    mid_verse: h.mid_verse,
                    end_verse: h.end_verse
                })),
                saved: true
            };

            if (result.hit_count > maxHitsToShow) {
                response.note = `Showing first ${maxHitsToShow} of ${result.hit_count} hits. Use els_history with search_id "${saveResult.search_id}" to see all hits.`;
            }

            if (warning) {
                response.warning = warning;
            }

            if (result.hit_count > 0) {
                response.suggestions = [
                    'Use read_scripture to check the context of interesting verse locations',
                    'Search for related terms and use els_proximity to find clusters',
                    'Use els_stats with this search\'s hit count for statistical significance testing'
                ];
            }

            return response;
        }

        case 'els_session': {
            switch (args.action) {
                case 'create': {
                    if (!args.name) return { error: 'Session name is required.' };
                    return elsSessions.createSession(args.name, args.notes);
                }
                case 'view': {
                    if (!args.session_id) return { error: 'session_id is required.' };
                    const session = elsSessions.getSession(args.session_id);
                    if (!session) return { error: `Session not found: ${args.session_id}` };
                    return session;
                }
                case 'list': {
                    return { sessions: elsSessions.listSessions({ limit: args.limit || 20 }) };
                }
                case 'update': {
                    if (!args.session_id) return { error: 'session_id is required.' };
                    return elsSessions.updateSession(args.session_id, {
                        name: args.name,
                        notes: args.notes
                    });
                }
                case 'delete': {
                    if (!args.session_id) return { error: 'session_id is required.' };
                    return elsSessions.deleteSession(args.session_id);
                }
                default:
                    return { error: `Unknown action: ${args.action}. Use create, view, list, update, or delete.` };
            }
        }

        case 'els_history': {
            switch (args.action) {
                case 'searches': {
                    return {
                        searches: elsSessions.searchHistory({
                            term: args.term,
                            stream_id: args.stream_id,
                            session_id: args.session_id,
                            limit: args.limit || 20
                        })
                    };
                }
                case 'terms': {
                    return {
                        terms: elsSessions.getSearchedTerms(args.stream_id)
                    };
                }
                case 'search_detail': {
                    if (!args.search_id) return { error: 'search_id is required.' };
                    const detail = elsSessions.getSearch(args.search_id);
                    if (!detail) return { error: `Search not found: ${args.search_id}` };
                    return detail;
                }
                default:
                    return { error: `Unknown action: ${args.action}. Use searches, terms, or search_detail.` };
            }
        }

        case 'els_streams': {
            if (args.stream_id) {
                // Detailed info for one stream
                const info = elsEngine.getStreamInfo(args.stream_id);
                if (!info) {
                    // Try to build it
                    try {
                        elsEngine.getStream(args.stream_id);
                        return elsEngine.getStreamInfo(args.stream_id);
                    } catch (err) {
                        return { error: `Stream not found: "${args.stream_id}". Use els_streams without a stream_id to list all available.` };
                    }
                }

                if (args.show_frequency) {
                    const freq = elsEngine.getLetterFrequency(args.stream_id);
                    return { ...info, letter_frequency: freq?.frequencies };
                }
                return info;
            }

            // List all streams
            const streams = elsEngine.listStreams();
            return streams;
        }

        case 'els_research_stats': {
            return elsSessions.getStats();
        }

        // ===============================================================
        // ELS PROXIMITY, CLUSTERING & SWEEP
        // ===============================================================

        case 'els_proximity': {
            if (!args.term_a || !args.term_b) {
                return { error: 'Both term_a and term_b are required.' };
            }
            const streamId = args.stream || 'torah';

            // Ensure stream is loaded
            try { elsEngine.getStream(streamId); } catch (err) {
                return { error: `Failed to load stream "${streamId}": ${err.message}` };
            }

            const proxResult = elsProximity.proximity(args.term_a, args.term_b, streamId, {
                maxPairs: args.max_pairs || 20,
                maxDistance: args.max_distance || null
            });

            if (proxResult.error) return proxResult;

            // Add suggestions
            proxResult.suggestions = [];
            if (proxResult.intersections.count > 0) {
                proxResult.suggestions.push(`${proxResult.intersections.count} shared letter position(s) found! Use read_scripture to check the verse context at those positions.`);
            }
            if (proxResult.closest_region) {
                proxResult.suggestions.push(`Closest approach: ${proxResult.closest_region.distance} letters apart near ${proxResult.closest_region.start_verse}. Use read_scripture to examine this region.`);
            }

            return proxResult;
        }

        case 'els_cluster': {
            const clusterStream = args.stream || 'torah';

            try { elsEngine.getStream(clusterStream); } catch (err) {
                return { error: `Failed to load stream "${clusterStream}": ${err.message}` };
            }

            const clusterResult = elsProximity.cluster(clusterStream, {
                session_id: args.session_id || null,
                terms: args.terms || null,
                windowSize: args.window_size || 10000,
                minTerms: args.min_terms || 2,
                maxResults: args.max_results || 10
            });

            if (clusterResult.error) return clusterResult;

            // Add suggestions for top clusters
            if (clusterResult.top_clusters && clusterResult.top_clusters.length > 0) {
                const best = clusterResult.top_clusters[0];
                clusterResult.suggestion = `Densest cluster: ${best.distinct_terms} terms (${best.terms.join(', ')}) converge in ${best.start_verse} \u2192 ${best.end_verse} (spread: ${best.spread.toLocaleString()} letters). Use read_scripture to examine this region and els_proximity on specific pairs for detail.`;
            }

            return clusterResult;
        }

        case 'els_sweep': {
            const sweepStream = args.stream || 'torah';

            try { elsEngine.getStream(sweepStream); } catch (err) {
                return { error: `Failed to load stream "${sweepStream}": ${err.message}` };
            }

            return elsProximity.sweep(sweepStream, {
                maxDistance: args.max_distance || 500,
                maxResults: args.max_results || 30,
                minTermLength: args.min_term_length || 4
            });
        }

        // ===============================================================
        // ELS STATISTICS
        // ===============================================================

        case 'els_stats': {
            if (!args.term) return { error: 'term is required.' };
            if (args.observed === undefined || args.observed === null) return { error: 'observed hit count is required.' };

            const statsStream = args.stream || 'torah';
            try { elsEngine.getStream(statsStream); } catch (err) {
                return { error: `Failed to load stream "${statsStream}": ${err.message}` };
            }

            const term = args.term.toUpperCase().replace(/[^A-Z]/g, '');
            const observed = parseInt(args.observed);
            const action = args.action || 'poisson';
            const skipMin = args.skip_min || 1;
            const skipMax = args.skip_max || 3000;
            const direction = args.direction || 'both';

            switch (action) {
                case 'expected': {
                    const result = elsStats.expectedFrequency(statsStream, term, { minSkip: skipMin, maxSkip: skipMax, direction });
                    result.observed = observed;
                    if (result.expected_hits > 0) {
                        result.ratio = parseFloat((observed / result.expected_hits).toFixed(4));
                    }
                    return result;
                }

                case 'poisson': {
                    return elsStats.poissonAnalysis(statsStream, term, observed, { minSkip: skipMin, maxSkip: skipMax, direction });
                }

                case 'monte_carlo': {
                    const mcResult = await elsStats.monteCarlo(statsStream, term, observed, {
                        runs: args.mc_runs || 100,
                        minSkip: skipMin,
                        maxSkip: args.mc_max_skip || Math.min(skipMax, 1000),
                        direction
                    });

                    // Save if search_id provided
                    if (args.search_id && !mcResult.error) {
                        const saved = elsStats.saveStatistics(args.search_id, {
                            observed,
                            expected: null,
                            ratio: null,
                            poisson_p: null,
                            monte_carlo_runs: mcResult.monte_carlo.runs,
                            monte_carlo_p: mcResult.monte_carlo.p_value
                        });
                        mcResult.stat_id = saved.stat_id;
                    }

                    return mcResult;
                }

                case 'full': {
                    return await elsStats.fullAnalysis(statsStream, term, observed, {
                        minSkip: skipMin,
                        maxSkip: skipMax,
                        direction,
                        mcRuns: args.mc_runs || 100,
                        mcMaxSkip: args.mc_max_skip || null,
                        searchId: args.search_id || null,
                        runMonteCarlo: true
                    });
                }

                default:
                    return { error: `Unknown action: ${action}. Use expected, poisson, monte_carlo, or full.` };
            }
        }

        // ===============================================================
        // Knowledge Graph Tools (inherited from Word Graph)
        // ===============================================================

        case 'remember': {
            const node = database.createNode({
                type: args.type,
                summary: args.summary,
                detail: args.detail,
                context: args.context,
                tags: args.tags,
                importance: args.importance,
                metadata: args.metadata
            });

            try {
                await search.embedNode(node.id);
            } catch (err) {
                log('WARN', `Auto-embed failed for ${node.id}: ${err.message}`);
            }

            if (args.connect_to && args.relationship) {
                try {
                    database.createEdge(node.id, args.connect_to, args.relationship);
                    node.connected_to = { id: args.connect_to, relationship: args.relationship };
                } catch (err) {
                    node.connection_error = err.message;
                }
            }

            return node;
        }

        case 'recall': {
            return await search.semanticSearch(args.query, { limit: args.limit, type: args.type });
        }

        case 'forget': {
            return database.deleteNode(args.id);
        }

        case 'update': {
            const { id, ...updates } = args;
            const node = database.updateNode(id, updates);
            try { await search.embedNode(id); } catch (err) { log('WARN', `Re-embed failed: ${err.message}`); }
            return node;
        }

        case 'connect': {
            return database.createEdge(args.source_id, args.target_id, args.relationship);
        }

        case 'search': {
            return search.keywordSearch(args.query, { limit: args.limit, type: args.type });
        }

        case 'list': {
            return database.listNodes({
                type: args.type, tags: args.tags, limit: args.limit,
                offset: args.offset, sort: args.sort, order: args.order
            });
        }

        case 'kg_status': {
            const stats = database.getStats();
            const types = database.getTypeDefinitions();
            const pending = database.getPendingProposals();
            const elsStats = elsSessions.getStats();

            return {
                ...stats,
                els_research: {
                    total_sessions: elsStats.total_sessions,
                    total_searches: elsStats.total_searches,
                    total_hits: elsStats.total_hits,
                    unique_terms: elsStats.unique_terms,
                    top_terms: elsStats.top_terms
                },
                available_types: types.map(t => ({
                    name: t.type_name, display_name: t.display_name, icon: t.icon, is_base: !!t.is_base_type
                })),
                pending_proposals: pending.length > 0 ? pending.map(p => ({ id: p.id, type_name: p.type_name })) : 'none',
                ui_url: `http://localhost:${UI_PORT}`,
                powered_by: 'KARP Bible Code by SoulDriver — Proverbs 25:2'
            };
        }

        case 'snapshot': {
            const snapshotPath = database.createSnapshot(args.reason || 'manual');
            return { status: 'created', path: snapshotPath };
        }

        // ===============================================================
        // Scripture Tool Handlers (inherited from Word Graph)
        // ===============================================================

        case 'read_scripture': {
            if (args.reference) {
                const parsed = database.parsePassageRef(args.reference);
                if (!parsed) return { error: `Could not parse reference: "${args.reference}"` };
                args.book = parsed.book_abbrev;
                args.chapter = parsed.chapter;
                args.verse_start = parsed.verse_start;
                args.verse_end = parsed.verse_end;
            }

            if (!args.book || !args.chapter) return { error: 'Please provide a reference or book + chapter.' };

            const bookInfo = database.getBook(args.book);
            if (!bookInfo) return { error: `Book not found: "${args.book}"` };

            let verses;
            if (args.verse_start && args.verse_end && args.verse_end !== args.verse_start) {
                verses = database.getVerseRange(args.book, args.chapter, args.verse_start, args.verse_end);
            } else if (args.verse_start) {
                const single = database.getScripture(args.book, args.chapter, args.verse_start);
                verses = single ? [single] : [];
            } else {
                verses = database.getChapter(args.book, args.chapter);
            }

            if (verses.length === 0) return { error: `No verses found for ${bookInfo.name} ${args.chapter}` };

            const refLabel = args.verse_start
                ? `${bookInfo.name} ${args.chapter}:${args.verse_start}${args.verse_end && args.verse_end !== args.verse_start ? '-' + args.verse_end : ''}`
                : `${bookInfo.name} ${args.chapter}`;

            return {
                reference: refLabel, book: bookInfo.name, book_abbrev: bookInfo.abbrev,
                testament: bookInfo.testament, chapter: args.chapter,
                verses: verses.map(v => ({ verse: v.verse, text: v.text })),
                verse_count: verses.length
            };
        }

        case 'search_scripture': {
            const scriptureEmbeddings = database.getAllScriptureEmbeddings();

            if (scriptureEmbeddings.length > 0) {
                const queryVector = await embeddings.embed(args.query);
                let scored = scriptureEmbeddings.map(emb => ({
                    ...emb, similarity: embeddings.cosineSimilarity(queryVector, emb.vector)
                }));

                if (args.book) scored = scored.filter(s => s.book_abbrev === args.book.toUpperCase());
                if (args.testament) {
                    const bookList = database.listBooks();
                    const testBooks = new Set(bookList.filter(b => b.testament === args.testament).map(b => b.abbrev));
                    scored = scored.filter(s => testBooks.has(s.book_abbrev));
                }

                scored.sort((a, b) => b.similarity - a.similarity);
                scored = scored.slice(0, args.limit || 10);

                return {
                    results: scored.map(s => {
                        const verses = database.getVerseRange(s.book_abbrev, s.chapter, s.verse_start, s.verse_end);
                        const bookInfo = database.getBook(s.book_abbrev);
                        return {
                            reference: `${bookInfo?.name || s.book_abbrev} ${s.chapter}:${s.verse_start}${s.verse_end !== s.verse_start ? '-' + s.verse_end : ''}`,
                            book_abbrev: s.book_abbrev, chapter: s.chapter,
                            verse_start: s.verse_start, verse_end: s.verse_end,
                            text: verses.map(v => `${v.verse}. ${v.text}`).join(' '),
                            similarity: Math.round(s.similarity * 1000) / 1000
                        };
                    }),
                    query: args.query, mode: 'semantic'
                };
            }

            const keywordResults = database.searchScriptureKeyword(args.query, { limit: args.limit || 10, book: args.book });
            return {
                results: keywordResults.map(v => ({
                    reference: `${v.book} ${v.chapter}:${v.verse}`, text: v.text
                })),
                query: args.query, mode: 'keyword'
            };
        }

        case 'study_passage': {
            const parsed = database.parsePassageRef(args.reference);
            if (!parsed) return { error: `Could not parse reference: "${args.reference}"` };

            const bookInfo = database.getBook(parsed.book_abbrev);
            if (!bookInfo) return { error: `Book not found: ${parsed.book_abbrev}` };

            const windowSize = args.context_window || 3;
            let mainVerses;
            if (parsed.verse_start) {
                if (parsed.verse_end && parsed.verse_end !== parsed.verse_start) {
                    mainVerses = database.getVerseRange(parsed.book_abbrev, parsed.chapter, parsed.verse_start, parsed.verse_end);
                } else {
                    const single = database.getScripture(parsed.book_abbrev, parsed.chapter, parsed.verse_start);
                    mainVerses = single ? [single] : [];
                }
            } else {
                mainVerses = database.getChapter(parsed.book_abbrev, parsed.chapter);
            }

            const contextStart = Math.max(1, (parsed.verse_start || 1) - windowSize);
            const contextEnd = (parsed.verse_end || parsed.verse_start || mainVerses[mainVerses.length - 1]?.verse || 1) + windowSize;
            const contextVerses = database.getVerseRange(parsed.book_abbrev, parsed.chapter, contextStart, contextEnd);
            const context = database.getScriptureContext(parsed.book_abbrev, parsed.chapter, parsed.verse_start || 1, windowSize);

            const refLabel = parsed.verse_start
                ? `${bookInfo.name} ${parsed.chapter}:${parsed.verse_start}${parsed.verse_end && parsed.verse_end !== parsed.verse_start ? '-' + parsed.verse_end : ''}`
                : `${bookInfo.name} ${parsed.chapter}`;

            return {
                reference: refLabel, book: bookInfo.name, testament: bookInfo.testament,
                passage: mainVerses.map(v => ({ verse: v.verse, text: v.text })),
                context_before: contextVerses.filter(v => v.verse < (parsed.verse_start || 1)).map(v => ({ verse: v.verse, text: v.text })),
                context_after: contextVerses.filter(v => v.verse > (parsed.verse_end || parsed.verse_start || mainVerses[mainVerses.length - 1]?.verse || 999)).map(v => ({ verse: v.verse, text: v.text })),
                study_notes: context.study_notes,
                study_note_count: context.study_notes.length
            };
        }

        case 'study_history': {
            return {
                items: database.getStudyHistory({ limit: args.limit || 20, type: args.type }),
                types_available: ['study_note', 'insight', 'prayer', 'teaching', 'question', 'memory_verse']
            };
        }

        case 'scripture_status': {
            const stats = database.getScriptureStats();
            const kgStats = database.getStats();
            const elsStats = elsSessions.getStats();
            const streamList = elsEngine.listStreams();

            return {
                scripture: stats,
                knowledge_graph: { total_nodes: kgStats.total_nodes, total_edges: kgStats.total_edges },
                els_engine: {
                    streams_built: streamList.built.length,
                    streams_available: streamList.available.length,
                    total_searches: elsStats.total_searches,
                    total_hits: elsStats.total_hits
                },
                ui_url: `http://localhost:${UI_PORT}`,
                powered_by: 'KARP Bible Code by SoulDriver — Proverbs 25:2'
            };
        }

        case 'list_books': {
            let books = database.listBooks();
            if (args.testament) books = books.filter(b => b.testament === args.testament);
            return {
                books: books.map(b => ({ order: b.book_order, name: b.name, abbrev: b.abbrev, testament: b.testament, chapters: b.chapter_count, verses: b.verse_count })),
                total: books.length
            };
        }

        default:
            return { error: `Unknown tool: ${name}` };
    }
}

// ---------------------------------------------------------------------------
// Express Web UI Server
// ---------------------------------------------------------------------------

function startWebUI() {
    const app = express();
    app.use(express.json());
    app.use(auth.authMiddleware);
    auth.addAuthRoutes(app);

    // Serve UI
    const uiPath = path.join(__dirname, '..', 'ui', 'index.html');
    app.get('/', (req, res) => {
        if (fs.existsSync(uiPath)) {
            res.sendFile(uiPath);
        } else {
            res.send('<h1>KARP Bible Code</h1><p>UI file not found.</p>');
        }
    });

    // --- Knowledge Graph API Routes (inherited) ---

    app.get('/api/stats', (req, res) => {
        try { res.json(database.getStats()); } catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.get('/api/nodes', (req, res) => {
        try {
            const { type, tags, limit, offset, sort, order } = req.query;
            res.json(database.listNodes({
                type, tags: tags ? tags.split(',') : undefined,
                limit: parseInt(limit) || 20, offset: parseInt(offset) || 0, sort, order
            }));
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.get('/api/nodes/:id', (req, res) => {
        try {
            const node = database.getNode(req.params.id);
            if (!node) return res.status(404).json({ error: 'Node not found' });
            res.json(node);
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.post('/api/nodes', async (req, res) => {
        try {
            const { type, summary, detail, context, tags, importance, metadata } = req.body;
            if (!type || !summary) return res.status(400).json({ error: 'type and summary required' });
            const node = database.createNode({ type, summary, detail, context, tags, importance, metadata });
            search.embedNode(node.id).catch(err => log('WARN', `Auto-embed failed: ${err.message}`));
            res.status(201).json(node);
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.patch('/api/nodes/:id', (req, res) => {
        try {
            const node = database.updateNode(req.params.id, req.body);
            search.embedNode(req.params.id).catch(() => {});
            res.json(node);
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.delete('/api/nodes/:id', (req, res) => {
        try { res.json(database.deleteNode(req.params.id)); } catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.get('/api/search', async (req, res) => {
        try {
            const { q, type, limit, mode } = req.query;
            if (!q) return res.status(400).json({ error: 'q required' });
            if (mode === 'keyword') res.json(search.keywordSearch(q, { limit: parseInt(limit) || 20, type }));
            else res.json(await search.semanticSearch(q, { limit: parseInt(limit) || 10, type }));
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.get('/api/types', (req, res) => {
        try { res.json(database.getTypeDefinitions()); } catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.get('/api/proposals', (req, res) => {
        try { res.json(database.getPendingProposals()); } catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.post('/api/proposals/:id/approve', async (req, res) => {
        try {
            const result = database.approveProposal(req.params.id);
            search.embedMissing().catch(() => {});
            res.json(result);
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.post('/api/proposals/:id/reject', (req, res) => {
        try { res.json(database.rejectProposal(req.params.id)); } catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.get('/api/edges', (req, res) => {
        try {
            res.json(database.queryAll(`
                SELECT e.*, s.type as source_type, s.summary as source_summary,
                       t.type as target_type, t.summary as target_summary
                FROM edges e JOIN nodes s ON e.source_id = s.id JOIN nodes t ON e.target_id = t.id
                ORDER BY e.created_at DESC
            `));
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.delete('/api/edges/:id', (req, res) => {
        try { res.json(database.deleteEdge(req.params.id)); } catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.get('/api/snapshots', (req, res) => {
        try { res.json(database.listSnapshots()); } catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.post('/api/snapshots', (req, res) => {
        try { res.json({ status: 'created', path: database.createSnapshot(req.body.reason || 'manual_ui') }); }
        catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.get('/api/export', (req, res) => {
        try {
            res.setHeader('Content-Disposition', 'attachment; filename=karp-bible-code-export.json');
            res.json(database.exportJSON());
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.get('/api/graph', (req, res) => {
        try {
            const nodes = database.queryAll('SELECT id, type, summary, importance, tags, created_at FROM nodes')
                .map(n => ({ ...n, tags: JSON.parse(n.tags || '[]') }));
            const edges = database.queryAll('SELECT id, source_id, target_id, relationship FROM edges');
            res.json({ nodes, edges });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // --- Scripture API Routes ---

    app.get('/api/scripture/status', (req, res) => {
        try { res.json(database.getScriptureStats()); } catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.get('/api/scripture/books', (req, res) => {
        try {
            let books = database.listBooks();
            if (req.query.testament) books = books.filter(b => b.testament === req.query.testament.toUpperCase());
            res.json(books);
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.get('/api/scripture/search', async (req, res) => {
        try {
            const { q, book, testament, limit } = req.query;
            if (!q) return res.status(400).json({ error: 'q required' });
            res.json(await search.scriptureSemanticSearch(q, { limit: parseInt(limit) || 10, book, testament }));
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.get('/api/scripture/history', (req, res) => {
        try {
            res.json(database.getStudyHistory({ limit: parseInt(req.query.limit) || 20, type: req.query.type }));
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.get('/api/scripture/:book/:chapter', (req, res) => {
        try {
            res.json({
                book: database.getBook(req.params.book),
                chapter: parseInt(req.params.chapter),
                verses: database.getChapter(req.params.book, parseInt(req.params.chapter))
            });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.get('/api/scripture/:book/:chapter/:verse', (req, res) => {
        try {
            const parts = req.params.verse.split('-');
            let verses;
            if (parts.length === 2) verses = database.getVerseRange(req.params.book, parseInt(req.params.chapter), parseInt(parts[0]), parseInt(parts[1]));
            else { const s = database.getScripture(req.params.book, parseInt(req.params.chapter), parseInt(parts[0])); verses = s ? [s] : []; }
            res.json({ verses });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // --- ELS API Routes (for future web UI) ---

    app.get('/api/els/stats', (req, res) => {
        try { res.json(elsSessions.getStats()); } catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.get('/api/els/streams', (req, res) => {
        try {
            if (req.query.id) {
                // Single stream info (used by Matrix UI)
                const info = elsEngine.getStreamInfo(req.query.id);
                if (!info) {
                    // Try to build it
                    try {
                        elsEngine.getStream(req.query.id);
                        return res.json(elsEngine.getStreamInfo(req.query.id));
                    } catch (err) {
                        return res.status(404).json({ error: `Stream not found: ${req.query.id}` });
                    }
                }
                return res.json(info);
            }
            res.json(elsEngine.listStreams());
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // GET /api/els/streams/:id/letters — Raw letter string for canvas rendering
    app.get('/api/els/streams/:id/letters', (req, res) => {
        try {
            const data = elsEngine.getStream(req.params.id);
            if (!data || !data.stream) return res.status(404).json({ error: `Stream not found: ${req.params.id}` });
            res.set('Content-Type', 'text/plain');
            res.send(data.stream);
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // GET /api/els/streams/:id/verse-index — Verse boundaries for position→verse lookup
    // Returns compact array: [[cumLen, "BOOK", chapter, verse], ...]
    app.get('/api/els/streams/:id/verse-index', (req, res) => {
        try {
            const data = elsEngine.getStream(req.params.id);
            if (!data || !data.verseBoundaries) return res.status(404).json({ error: `Stream not found: ${req.params.id}` });
            // Send compact format to minimize payload (~1500 entries for genesis, ~31K for full)
            const compact = data.verseBoundaries.map(vb => [vb.cumLen, vb.book, vb.chapter, vb.verse]);
            res.json(compact);
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.get('/api/els/sessions', (req, res) => {
        try { res.json(elsSessions.listSessions({ limit: parseInt(req.query.limit) || 20 })); }
        catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.get('/api/els/sessions/:id', (req, res) => {
        try {
            const session = elsSessions.getSession(req.params.id);
            if (!session) return res.status(404).json({ error: 'Session not found' });
            res.json(session);
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.get('/api/els/searches', (req, res) => {
        try {
            res.json(elsSessions.searchHistory({
                term: req.query.term, stream_id: req.query.stream,
                session_id: req.query.session, limit: parseInt(req.query.limit) || 20
            }));
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // POST /api/els/searches — Run a new ELS search (used by Matrix UI)
    app.post('/api/els/searches', async (req, res) => {
        try {
            const { term, stream, skip_min, skip_max, direction, session_id } = req.body;
            if (!term || term.length < 3) return res.status(400).json({ error: 'Term must be at least 3 letters. Short terms produce too many hits and can crash the server.' });

            const cleanTerm = term.toUpperCase().replace(/[^A-Z]/g, '');
            const streamId = stream || 'torah';

            // Ensure stream is loaded
            try { elsEngine.getStream(streamId); } catch (err) {
                return res.status(400).json({ error: `Stream "${streamId}" not available: ${err.message}` });
            }

            const result = await elsEngine.search(streamId, cleanTerm, {
                minSkip: skip_min || 1,
                maxSkip: skip_max || 2000,
                direction: direction || 'both',
                parallel: true,
                mapVerses: true
            });

            const saved = elsSessions.saveSearch(result, session_id || null);

            res.json({
                search_id: saved.search_id,
                session_id: saved.session_id,
                term: result.term,
                stream: result.stream_id,
                hit_count: result.hit_count,
                hits_capped: result.hits_capped || false,
                max_hits: result.max_hits,
                elapsed_ms: result.elapsed_ms,
                hits: result.hits.map(h => ({
                    skip: h.skip,
                    direction: h.direction,
                    positions: h.positions,
                    start_pos: h.start,
                    start_verse: h.start_verse,
                    mid_verse: h.mid_verse,
                    end_verse: h.end_verse
                }))
            });
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.get('/api/els/searches/:id', (req, res) => {
        try {
            const s = elsSessions.getSearch(req.params.id);
            if (!s) return res.status(404).json({ error: 'Search not found' });
            res.json(s);
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.get('/api/els/terms', (req, res) => {
        try { res.json(elsSessions.getSearchedTerms(req.query.stream)); }
        catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.get('/api/els/proximity', (req, res) => {
        try {
            const { term_a, term_b, stream, max_pairs, max_distance } = req.query;
            if (!term_a || !term_b) return res.status(400).json({ error: 'term_a and term_b required' });
            res.json(elsProximity.proximity(term_a, term_b, stream || 'torah', {
                maxPairs: parseInt(max_pairs) || 20,
                maxDistance: max_distance ? parseInt(max_distance) : null
            }));
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.get('/api/els/clusters', (req, res) => {
        try {
            res.json(elsProximity.listClusters({
                sessionId: req.query.session,
                limit: parseInt(req.query.limit) || 20
            }));
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.get('/api/els/sweep', (req, res) => {
        try {
            const stream = req.query.stream || 'torah';
            res.json(elsProximity.sweep(stream, {
                maxDistance: parseInt(req.query.max_distance) || 500,
                maxResults: parseInt(req.query.max_results) || 30
            }));
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    app.get('/api/els/stats/:searchId', (req, res) => {
        try { res.json(elsStats.getStatistics(req.params.searchId)); }
        catch (err) { res.status(500).json({ error: err.message }); }
    });

    // POST /api/els/stats — Run statistical analysis (Poisson / Monte Carlo)
    app.post('/api/els/stats', async (req, res) => {
        try {
            const { term, stream, observed, action, skip_min, skip_max, direction, mc_runs, mc_max_skip, search_id } = req.body;
            if (!term) return res.status(400).json({ error: 'term is required' });
            if (observed === undefined) return res.status(400).json({ error: 'observed hit count is required' });

            const cleanTerm = term.toUpperCase().replace(/[^A-Z]/g, '');
            const statsStream = stream || 'torah';
            const statsAction = action || 'poisson';
            const minSkip = skip_min || 1;
            const maxSkip = skip_max || 3000;
            const dir = direction || 'both';

            try { elsEngine.getStream(statsStream); } catch (err) {
                return res.status(400).json({ error: `Stream "${statsStream}" not available` });
            }

            switch (statsAction) {
                case 'expected': {
                    const result = elsStats.expectedFrequency(statsStream, cleanTerm, { minSkip: minSkip, maxSkip: maxSkip, direction: dir });
                    result.observed = observed;
                    if (result.expected_hits > 0) result.ratio = parseFloat((observed / result.expected_hits).toFixed(4));
                    return res.json(result);
                }
                case 'poisson': {
                    return res.json(elsStats.poissonAnalysis(statsStream, cleanTerm, observed, { minSkip: minSkip, maxSkip: maxSkip, direction: dir }));
                }
                case 'monte_carlo': {
                    const mcResult = await elsStats.monteCarlo(statsStream, cleanTerm, observed, {
                        runs: mc_runs || 100,
                        minSkip: minSkip,
                        maxSkip: mc_max_skip || Math.min(maxSkip, 1000),
                        direction: dir
                    });
                    if (search_id && !mcResult.error) {
                        const saved = elsStats.saveStatistics(search_id, {
                            observed, expected: null, ratio: null, poisson_p: null,
                            monte_carlo_runs: mcResult.monte_carlo.runs,
                            monte_carlo_p: mcResult.monte_carlo.p_value
                        });
                        mcResult.stat_id = saved.stat_id;
                    }
                    return res.json(mcResult);
                }
                case 'full': {
                    const fullResult = await elsStats.fullAnalysis(statsStream, cleanTerm, observed, {
                        minSkip: minSkip, maxSkip: maxSkip, direction: dir,
                        mcRuns: mc_runs || 100,
                        mcMaxSkip: mc_max_skip || null,
                        searchId: search_id || null,
                        runMonteCarlo: true
                    });
                    return res.json(fullResult);
                }
                default:
                    return res.status(400).json({ error: `Unknown action: ${statsAction}` });
            }
        } catch (err) { res.status(500).json({ error: err.message }); }
    });

    // Start server
    const server = app.listen(UI_PORT, '127.0.0.1', () => {
        log('INFO', `Web UI available at http://localhost:${UI_PORT}`);
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') log('WARN', `Port ${UI_PORT} in use — UI may already be running`);
        else log('ERROR', `Web UI server error: ${err.message}`);
    });

    return server;
}

// ---------------------------------------------------------------------------
// MCP Protocol Handler
// ---------------------------------------------------------------------------

async function handleMessage(message) {
    const { method, id, params = {} } = message;

    if (method === 'initialize') {
        log('INFO', `Initializing ${SERVER_NAME} v${VERSION}`);
        log('INFO', `Data path: ${DATA_PATH}`);

        ensureDataPath();

        // Initialize shared modules
        await database.configure(DATA_PATH);
        await embeddings.configure(DATA_PATH);
        await auth.configure(DATA_PATH, UI_PASSWORD);

        // Initialize ELS engine (builds/loads letter streams)
        await elsEngine.init(database);
        elsSessions.init(database);
        elsProximity.init(database, elsEngine, elsSessions);
        elsStats.init(database, elsEngine);

        // Start web UI
        startWebUI();

        // Background embed missing nodes
        search.embedMissing().then(result => {
            if (result.total > 0) log('INFO', `Background embed: ${result.embedded}/${result.total} nodes`);
        }).catch(err => log('WARN', `Background embed error: ${err.message}`));

        return {
            jsonrpc: '2.0',
            id,
            result: {
                protocolVersion: '2024-11-05',
                capabilities: { tools: {} },
                serverInfo: {
                    name: SERVER_NAME,
                    version: VERSION,
                    description: 'KARP Bible Code — AI-assisted ELS research with semantic-code correlation. You have a complete KJV Bible (31,102 verses) with ELS search across letter streams (genesis/torah/full/per-book). Every search is auto-saved to a persistent research ledger. Use sessions to group related searches. After searching multiple terms, use els_proximity for pairwise distance analysis, els_cluster to find regions where terms converge, and els_sweep to scan your entire research history for unexpected connections. The tool finds hidden letter patterns AND understands the theological meaning of the verses where they land. Web UI at localhost:3458. Built by SoulDriver — "It is the glory of God to conceal a thing: but the honour of kings is to search out a matter." (Proverbs 25:2)'
                }
            }
        };
    }

    if (method === 'notifications/initialized') {
        log('INFO', 'Client connected — Claude Desktop is ready');
        return null;
    }

    if (method === 'tools/list') {
        return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
    }

    if (method === 'tools/call') {
        const toolName = params.name || '';
        const toolArgs = params.arguments || {};

        try {
            const result = await handleToolCall(toolName, toolArgs);
            return {
                jsonrpc: '2.0', id,
                result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
            };
        } catch (err) {
            log('ERROR', `Tool error [${toolName}]: ${err.message}`);
            return {
                jsonrpc: '2.0', id,
                result: { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }], isError: true }
            };
        }
    }

    if (method === 'ping') {
        return { jsonrpc: '2.0', id, result: {} };
    }

    log('WARN', `Unknown method: ${method}`);
    return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
}

// ---------------------------------------------------------------------------
// Crash Resilience — keep the server alive no matter what
// ---------------------------------------------------------------------------

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10MB — if a response exceeds this, truncate it

/**
 * Safely serialize and write a response to stdout.
 * Catches serialization errors and oversized responses that would crash stdio.
 */
function safeWrite(response) {
    try {
        const json = JSON.stringify(response);
        if (json.length > MAX_RESPONSE_BYTES) {
            log('WARN', `Response too large (${(json.length / 1024 / 1024).toFixed(1)}MB) — truncating to error response`);
            // Replace with an error response preserving the jsonrpc id
            const errorResponse = {
                jsonrpc: '2.0',
                id: response.id,
                result: {
                    content: [{ type: 'text', text: JSON.stringify({
                        error: `Response too large (${(json.length / 1024 / 1024).toFixed(1)}MB). Try a longer search term or narrower skip range to reduce hits.`
                    }) }],
                    isError: true
                }
            };
            process.stdout.write(JSON.stringify(errorResponse) + '\n');
        } else {
            process.stdout.write(json + '\n');
        }
    } catch (err) {
        log('ERROR', `Failed to serialize/write response: ${err.message}`);
        // Last resort — try to send a minimal error
        try {
            const fallback = JSON.stringify({
                jsonrpc: '2.0',
                id: response?.id || null,
                result: {
                    content: [{ type: 'text', text: JSON.stringify({ error: `Server error: ${err.message}` }) }],
                    isError: true
                }
            });
            process.stdout.write(fallback + '\n');
        } catch (e) {
            log('ERROR', `Critical: could not write any response: ${e.message}`);
        }
    }
}

// Global crash handlers — prevent process exit on uncaught errors
process.on('uncaughtException', (err) => {
    log('ERROR', `UNCAUGHT EXCEPTION (server survived): ${err.message}`);
    log('ERROR', err.stack || 'no stack');
    // Force garbage collection if available
    if (global.gc) { try { global.gc(); } catch (e) {} }
});

process.on('unhandledRejection', (reason, promise) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    log('ERROR', `UNHANDLED REJECTION (server survived): ${msg}`);
});

// Memory monitoring — warn if heap gets too large
let lastMemWarn = 0;
function checkMemory() {
    const usage = process.memoryUsage();
    const heapMB = usage.heapUsed / 1024 / 1024;
    if (heapMB > 500 && Date.now() - lastMemWarn > 60000) {
        log('WARN', `High memory usage: ${heapMB.toFixed(0)}MB heap`);
        lastMemWarn = Date.now();
        if (global.gc) { try { global.gc(); } catch (e) {} }
    }
}
setInterval(checkMemory, 30000);

// ---------------------------------------------------------------------------
// Main — stdio loop (crash-resilient)
// ---------------------------------------------------------------------------

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let messageId = null;
    try {
        const message = JSON.parse(trimmed);
        messageId = message.id || null;
        const response = await handleMessage(message);
        if (response !== null) safeWrite(response);
    } catch (err) {
        log('ERROR', `Message handler error: ${err.message}`);
        // Try to return an error response so Claude Desktop doesn't hang
        if (messageId !== null) {
            try {
                safeWrite({
                    jsonrpc: '2.0',
                    id: messageId,
                    result: {
                        content: [{ type: 'text', text: JSON.stringify({ error: `Server error: ${err.message}` }) }],
                        isError: true
                    }
                });
            } catch (e) {
                log('ERROR', `Could not send error response: ${e.message}`);
            }
        }
    }
});

// Handle readline close (Claude Desktop disconnected)
rl.on('close', () => {
    log('INFO', 'stdin closed — Claude Desktop disconnected. Server staying alive for web UI.');
    // Don't exit — web UI server may still be useful
});

log('INFO', `${SERVER_NAME} v${VERSION} starting (stdio mode)`);
log('INFO', `Data: ${DATA_PATH} | UI: http://localhost:${UI_PORT}`);
log('INFO', 'Crash resilience: uncaughtException + unhandledRejection handlers active');
