// ============================================================================
// KARP Bible Code — ELS Engine (Letter Stream Builder + Search Core)
// Version: 0.1.0
// Author: SoulDriver (Adelaide, Australia)
// Description: Layer 1 & 2 of the Bible Code system.
//              Builds continuous letter streams from KJV scripture,
//              caches them in SQLite, and provides position-to-verse mapping
//              via binary search on cumulative verse boundaries.
//              "It is the glory of God to conceal a thing: but the honour
//               of kings is to search out a matter." — Proverbs 25:2
// License: MIT
// ============================================================================

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');

// ---------------------------------------------------------------------------
// Safety Limits
// ---------------------------------------------------------------------------
const MIN_TERM_LENGTH = 3;   // Minimum letters (2-letter terms crash via combinatorial explosion)
const MAX_HITS = 10000;       // Hard cap — early termination if exceeded

// ---------------------------------------------------------------------------
// WORKER THREAD CODE — ELS search inside a worker
// ---------------------------------------------------------------------------

if (!isMainThread) {
    const { stream, term, skipStart, skipEnd, directions, maxHits } = workerData;
    const hits = [];
    const hitCap = maxHits || MAX_HITS;
    const termLen = term.length;
    const streamLen = stream.length;
    let capped = false;

    // Build first-letter index for this worker
    const firstPositions = [];
    for (let i = 0; i < streamLen; i++) {
        if (stream[i] === term[0]) firstPositions.push(i);
    }

    for (const dir of directions) {
        if (capped) break;
        for (let skip = skipStart; skip <= skipEnd; skip++) {
            if (capped) break;
            for (const start of firstPositions) {
                const endPos = start + dir * ((termLen - 1) * skip);
                if (endPos < 0 || endPos >= streamLen) continue;

                let match = true;
                const positions = [start];

                for (let c = 1; c < termLen; c++) {
                    const pos = start + dir * (c * skip);
                    if (pos < 0 || pos >= streamLen || stream[pos] !== term[c]) {
                        match = false;
                        break;
                    }
                    positions.push(pos);
                }

                if (match) {
                    hits.push({
                        term,
                        start,
                        skip,
                        direction: dir === 1 ? 'forward' : 'reverse',
                        positions
                    });
                    if (hits.length >= hitCap) { capped = true; break; }
                }
            }
        }
    }

    parentPort.postMessage({ hits, capped });
    process.exit(0);
}

// ============================================================================
// MAIN THREAD — Letter Stream Builder + ELS Engine
// ============================================================================

let database = null;   // Reference to database module (set via init())
let streamCache = {};  // In-memory cache: streamId → { stream, verseBoundaries, letterFreq, ... }

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(level, msg) {
    process.stderr.write(`${new Date().toISOString()} [ELS:${level}] ${msg}\n`);
}

// ---------------------------------------------------------------------------
// Initialization — called from server index.js after DB is ready
// ---------------------------------------------------------------------------

async function init(db) {
    database = db;
    ensureSchema();
    await preloadStreams();
    return true;
}

// ---------------------------------------------------------------------------
// Schema — ELS tables in the existing graph.db
// ---------------------------------------------------------------------------

function ensureSchema() {
    const dbInstance = database.getDb();

    // Pre-computed letter streams
    dbInstance.run(`
        CREATE TABLE IF NOT EXISTS letter_streams (
            stream_id TEXT PRIMARY KEY,
            display_name TEXT NOT NULL,
            scope_filter TEXT NOT NULL DEFAULT '',
            total_letters INTEGER NOT NULL DEFAULT 0,
            total_verses INTEGER NOT NULL DEFAULT 0,
            letter_freq TEXT NOT NULL DEFAULT '{}',
            verse_boundaries TEXT NOT NULL DEFAULT '[]',
            stream TEXT NOT NULL DEFAULT '',
            built_at TEXT NOT NULL
        );
    `);

    // Research sessions
    dbInstance.run(`
        CREATE TABLE IF NOT EXISTS els_sessions (
            session_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            notes TEXT DEFAULT ''
        );
    `);

    // Every search ever run
    dbInstance.run(`
        CREATE TABLE IF NOT EXISTS els_searches (
            search_id TEXT PRIMARY KEY,
            session_id TEXT,
            term TEXT NOT NULL,
            stream_id TEXT NOT NULL,
            skip_min INTEGER NOT NULL,
            skip_max INTEGER NOT NULL,
            direction TEXT NOT NULL DEFAULT 'both',
            hit_count INTEGER NOT NULL DEFAULT 0,
            elapsed_ms INTEGER NOT NULL DEFAULT 0,
            searched_at TEXT NOT NULL,
            FOREIGN KEY (session_id) REFERENCES els_sessions(session_id)
        );
    `);

    // Individual hits — the persistent research ledger
    dbInstance.run(`
        CREATE TABLE IF NOT EXISTS els_hits (
            hit_id TEXT PRIMARY KEY,
            search_id TEXT NOT NULL,
            term TEXT NOT NULL,
            stream_id TEXT NOT NULL,
            start_position INTEGER NOT NULL,
            skip_interval INTEGER NOT NULL,
            direction TEXT NOT NULL,
            positions TEXT NOT NULL DEFAULT '[]',
            start_verse TEXT DEFAULT '',
            mid_verse TEXT DEFAULT '',
            end_verse TEXT DEFAULT '',
            created_at TEXT NOT NULL,
            FOREIGN KEY (search_id) REFERENCES els_searches(search_id)
        );
    `);

    // Discovered clusters and intersections
    dbInstance.run(`
        CREATE TABLE IF NOT EXISTS els_clusters (
            cluster_id TEXT PRIMARY KEY,
            session_id TEXT,
            type TEXT NOT NULL,
            terms TEXT NOT NULL DEFAULT '[]',
            region_start INTEGER NOT NULL DEFAULT 0,
            region_end INTEGER NOT NULL DEFAULT 0,
            spread INTEGER NOT NULL DEFAULT 0,
            verse_range TEXT DEFAULT '',
            significance_p REAL,
            metadata TEXT DEFAULT '{}',
            discovered_at TEXT NOT NULL
        );
    `);

    // Statistical analyses
    dbInstance.run(`
        CREATE TABLE IF NOT EXISTS els_statistics (
            stat_id TEXT PRIMARY KEY,
            search_id TEXT,
            expected_frequency REAL,
            observed_count INTEGER,
            ratio REAL,
            poisson_p REAL,
            monte_carlo_runs INTEGER,
            monte_carlo_p REAL,
            control_text TEXT DEFAULT 'shuffled',
            computed_at TEXT NOT NULL
        );
    `);

    // Indexes for performance
    dbInstance.run('CREATE INDEX IF NOT EXISTS idx_els_searches_session ON els_searches(session_id);');
    dbInstance.run('CREATE INDEX IF NOT EXISTS idx_els_searches_term ON els_searches(term);');
    dbInstance.run('CREATE INDEX IF NOT EXISTS idx_els_searches_stream ON els_searches(stream_id);');
    dbInstance.run('CREATE INDEX IF NOT EXISTS idx_els_hits_search ON els_hits(search_id);');
    dbInstance.run('CREATE INDEX IF NOT EXISTS idx_els_hits_term ON els_hits(term);');
    dbInstance.run('CREATE INDEX IF NOT EXISTS idx_els_hits_stream ON els_hits(stream_id);');
    dbInstance.run('CREATE INDEX IF NOT EXISTS idx_els_clusters_session ON els_clusters(session_id);');

    database.saveToDisk();
    log('INFO', 'ELS schema initialized');
}

// ============================================================================
// LAYER 1: LETTER STREAM BUILDER
// ============================================================================

// Stream scope definitions — which books are in each named stream
const STREAM_SCOPES = {
    genesis: {
        display: 'Genesis',
        filter: "book_abbrev = 'GEN'"
    },
    torah: {
        display: 'Torah (Pentateuch)',
        filter: "book_abbrev IN ('GEN','EXO','LEV','NUM','DEU')"
    },
    ot: {
        display: 'Old Testament',
        filter: "book_order <= 39"
    },
    nt: {
        display: 'New Testament',
        filter: "book_order > 39"
    },
    full: {
        display: 'Full Bible (KJV)',
        filter: "1=1"
    }
};

// Book abbreviations for individual book streams
const BOOK_ORDER = [
    'GEN','EXO','LEV','NUM','DEU','JOS','JDG','RUT','1SA','2SA',
    '1KI','2KI','1CH','2CH','EZR','NEH','EST','JOB','PSA','PRO',
    'ECC','SOS','ISA','JER','LAM','EZK','DAN','HOS','JOL','AMO',
    'OBA','JON','MIC','NAH','HAB','ZEP','HAG','ZEC','MAL',
    'MAT','MRK','LUK','JHN','ACT','ROM','1CO','2CO','GAL','EPH',
    'PHP','COL','1TH','2TH','1TI','2TI','TIT','PHM','HEB','JAS',
    '1PE','2PE','1JN','2JN','3JN','JUD','REV'
];

/**
 * Build a letter stream from scripture rows.
 *
 * Returns:
 *   stream          — continuous uppercase A-Z string
 *   letterFreq      — { A: count, B: count, ... }
 *   verseBoundaries — array of { cumLen, book, chapter, verse, letterCount }
 *                     sorted by position, enabling binary search for pos→verse
 *   totalLetters    — stream.length
 *   totalVerses     — number of verses in the stream
 */
function buildStreamFromRows(rows) {
    let stream = '';
    const letterFreq = {};
    const verseBoundaries = [];
    let cumulativeLen = 0;

    for (const row of rows) {
        const book = row.book_abbrev;
        const chapter = row.chapter;
        const verse = row.verse;
        const text = row.text;

        // Strip to uppercase A-Z only
        const letters = text.toUpperCase().replace(/[^A-Z]/g, '');
        const letterCount = letters.length;

        if (letterCount === 0) continue;

        // Add to stream
        stream += letters;

        // Track verse boundary (cumulative start position + length)
        verseBoundaries.push({
            cumLen: cumulativeLen + letterCount,  // cumulative end position (exclusive)
            book,
            chapter,
            verse,
            letterCount
        });

        // Letter frequency
        for (let i = 0; i < letterCount; i++) {
            const ch = letters[i];
            letterFreq[ch] = (letterFreq[ch] || 0) + 1;
        }

        cumulativeLen += letterCount;
    }

    return {
        stream,
        letterFreq,
        verseBoundaries,
        totalLetters: stream.length,
        totalVerses: verseBoundaries.length
    };
}

/**
 * Build and store a named letter stream.
 * Reads from scriptures table, builds the stream, saves to letter_streams table.
 */
function buildStream(streamId) {
    const scope = STREAM_SCOPES[streamId];
    let displayName, filter;

    if (scope) {
        displayName = scope.display;
        filter = scope.filter;
    } else {
        // Assume it's a book abbreviation
        const bookAbbrev = streamId.toUpperCase();
        const bookInfo = database.getBook(bookAbbrev);
        if (!bookInfo) {
            throw new Error(`Unknown stream scope: "${streamId}". Use genesis, torah, ot, nt, full, or a book abbreviation (GEN, EXO, etc.)`);
        }
        displayName = bookInfo.name;
        filter = `book_abbrev = '${bookAbbrev}'`;
    }

    log('INFO', `Building letter stream: ${streamId} (${displayName})...`);
    const startTime = Date.now();

    // Query scriptures in canonical order
    const sql = `SELECT book_abbrev, chapter, verse, text FROM scriptures WHERE ${filter} ORDER BY book_order, chapter, verse`;
    const rows = database.queryAll(sql);

    if (!rows.length) {
        throw new Error(`No scripture found for stream "${streamId}" (filter: ${filter})`);
    }

    const result = buildStreamFromRows(rows);
    const elapsed = Date.now() - startTime;

    // Store in database
    const now = new Date().toISOString();
    const dbInstance = database.getDb();

    dbInstance.run(
        `INSERT OR REPLACE INTO letter_streams (stream_id, display_name, scope_filter, total_letters, total_verses, letter_freq, verse_boundaries, stream, built_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            streamId,
            displayName,
            filter,
            result.totalLetters,
            result.totalVerses,
            JSON.stringify(result.letterFreq),
            JSON.stringify(result.verseBoundaries),
            result.stream,
            now
        ]
    );
    database.immediateSave();

    // Cache in memory
    streamCache[streamId] = result;

    log('INFO', `Stream "${streamId}" built: ${result.totalLetters.toLocaleString()} letters, ${result.totalVerses.toLocaleString()} verses (${elapsed}ms)`);

    return {
        stream_id: streamId,
        display_name: displayName,
        total_letters: result.totalLetters,
        total_verses: result.totalVerses,
        letter_freq: result.letterFreq,
        built_at: now,
        elapsed_ms: elapsed
    };
}

/**
 * Load a stream from the database cache (or build if not yet cached).
 * Returns the in-memory representation with stream string and verse boundaries.
 */
function getStream(streamId) {
    // Check in-memory cache first
    if (streamCache[streamId]) {
        return streamCache[streamId];
    }

    // Check database
    const row = database.queryOne(
        'SELECT * FROM letter_streams WHERE stream_id = ?',
        [streamId]
    );

    if (row) {
        // Load into memory cache
        streamCache[streamId] = {
            stream: row.stream,
            letterFreq: JSON.parse(row.letter_freq),
            verseBoundaries: JSON.parse(row.verse_boundaries),
            totalLetters: row.total_letters,
            totalVerses: row.total_verses
        };
        log('INFO', `Stream "${streamId}" loaded from DB cache (${row.total_letters.toLocaleString()} letters)`);
        return streamCache[streamId];
    }

    // Not cached — build it
    return buildStream(streamId) && streamCache[streamId];
}

/**
 * Pre-load the core streams on server boot.
 * Builds them if they don't exist, loads from DB if they do.
 */
async function preloadStreams() {
    const coreStreams = ['genesis', 'torah', 'full'];
    const startTime = Date.now();

    for (const sid of coreStreams) {
        try {
            getStream(sid);
        } catch (err) {
            log('ERROR', `Failed to load stream "${sid}": ${err.message}`);
        }
    }

    const elapsed = Date.now() - startTime;
    const cached = Object.keys(streamCache).length;
    log('INFO', `Stream preload complete: ${cached} streams ready (${elapsed}ms)`);
}

/**
 * List all available streams (built + buildable).
 */
function listStreams() {
    // Get already-built streams from DB
    const built = database.queryAll(
        'SELECT stream_id, display_name, total_letters, total_verses, built_at FROM letter_streams ORDER BY total_letters DESC'
    );

    // Get all buildable scopes
    const available = Object.entries(STREAM_SCOPES).map(([id, scope]) => ({
        stream_id: id,
        display_name: scope.display,
        built: built.some(b => b.stream_id === id)
    }));

    // Add individual books
    const books = database.listBooks();
    for (const book of books) {
        const bid = book.abbrev.toLowerCase();
        available.push({
            stream_id: bid,
            display_name: book.name,
            built: built.some(b => b.stream_id === bid)
        });
    }

    return { built, available };
}

// ============================================================================
// POSITION → VERSE MAPPING (Binary Search on Cumulative Boundaries)
// ============================================================================

/**
 * Map a letter position in a stream to its verse reference.
 * Uses binary search on the cumulative verse boundary array.
 *
 * The verseBoundaries array is sorted by cumLen (cumulative letter count).
 * Each entry: { cumLen, book, chapter, verse, letterCount }
 * cumLen is the END position (exclusive) of that verse in the stream.
 *
 * To find which verse contains position P:
 *   Find the first boundary where cumLen > P
 *   That's the verse containing position P.
 *
 * Returns: { book, chapter, verse, charInVerse, reference }
 */
function positionToVerse(streamId, position) {
    const data = getStream(streamId);
    if (!data) return null;

    const boundaries = data.verseBoundaries;
    if (!boundaries.length) return null;
    if (position < 0 || position >= data.totalLetters) return null;

    // Binary search: find first boundary where cumLen > position
    let lo = 0;
    let hi = boundaries.length - 1;

    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (boundaries[mid].cumLen <= position) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }

    const boundary = boundaries[lo];
    const verseStart = boundary.cumLen - boundary.letterCount;
    const charInVerse = position - verseStart;

    return {
        book: boundary.book,
        chapter: boundary.chapter,
        verse: boundary.verse,
        charInVerse,
        letter: data.stream[position],
        reference: `${boundary.book} ${boundary.chapter}:${boundary.verse}`
    };
}

/**
 * Map an array of positions to their verse references.
 * More efficient than calling positionToVerse repeatedly — 
 * sorts positions and walks the boundary array once.
 */
function positionsToVerses(streamId, positions) {
    const data = getStream(streamId);
    if (!data) return [];

    const boundaries = data.verseBoundaries;
    if (!boundaries.length) return [];

    // Create indexed positions so we can sort and unsort
    const indexed = positions.map((pos, i) => ({ pos, idx: i }));
    indexed.sort((a, b) => a.pos - b.pos);

    const results = new Array(positions.length);
    let bIdx = 0;

    for (const { pos, idx } of indexed) {
        if (pos < 0 || pos >= data.totalLetters) {
            results[idx] = null;
            continue;
        }

        // Walk forward to find the right boundary
        while (bIdx < boundaries.length - 1 && boundaries[bIdx].cumLen <= pos) {
            bIdx++;
        }

        const boundary = boundaries[bIdx];
        const verseStart = boundary.cumLen - boundary.letterCount;

        results[idx] = {
            book: boundary.book,
            chapter: boundary.chapter,
            verse: boundary.verse,
            charInVerse: pos - verseStart,
            letter: data.stream[pos],
            reference: `${boundary.book} ${boundary.chapter}:${boundary.verse}`
        };
    }

    return results;
}

/**
 * Get the verse text for a mapped position.
 * Convenience method that combines positionToVerse + scripture lookup.
 */
function getVerseAtPosition(streamId, position) {
    const loc = positionToVerse(streamId, position);
    if (!loc) return null;

    const scripture = database.getScripture(loc.book, loc.chapter, loc.verse);
    if (!scripture) return loc;

    return {
        ...loc,
        text: scripture.text
    };
}

// ============================================================================
// LAYER 2: ELS SEARCH ENGINE (Parallel)
// ============================================================================

/**
 * Single-threaded ELS search (for small streams or quick searches).
 */
function elsSearchSync(streamId, term, { minSkip = 1, maxSkip = 3000, direction = 'both' } = {}) {
    const data = getStream(streamId);
    if (!data) throw new Error(`Stream not found: ${streamId}`);

    term = term.toUpperCase().replace(/[^A-Z]/g, '');
    if (!term || term.length < MIN_TERM_LENGTH) throw new Error(`Term must be at least ${MIN_TERM_LENGTH} letters (A-Z only). Short terms produce too many hits and can crash the server.`);

    const stream = data.stream;
    const streamLen = stream.length;

    // Cap max skip to what's physically possible
    maxSkip = Math.min(maxSkip, Math.floor(streamLen / term.length));

    const directions = [];
    if (direction === 'both' || direction === 'forward') directions.push(1);
    if (direction === 'both' || direction === 'reverse') directions.push(-1);

    // First-letter index optimisation
    const firstPositions = [];
    const firstLetter = term[0];
    for (let i = 0; i < streamLen; i++) {
        if (stream[i] === firstLetter) firstPositions.push(i);
    }

    const hits = [];
    const termLen = term.length;
    let capped = false;

    for (const dir of directions) {
        if (capped) break;
        for (let skip = minSkip; skip <= maxSkip; skip++) {
            if (capped) break;
            for (const start of firstPositions) {
                const endPos = start + dir * ((termLen - 1) * skip);
                if (endPos < 0 || endPos >= streamLen) continue;

                let match = true;
                const positions = [start];

                for (let c = 1; c < termLen; c++) {
                    const pos = start + dir * (c * skip);
                    if (pos < 0 || pos >= streamLen || stream[pos] !== term[c]) {
                        match = false;
                        break;
                    }
                    positions.push(pos);
                }

                if (match) {
                    hits.push({ term, start, skip, direction: dir === 1 ? 'forward' : 'reverse', positions });
                    if (hits.length >= MAX_HITS) { capped = true; break; }
                }
            }
        }
    }

    return { hits, capped };
}

/**
 * Parallel ELS search using worker_threads.
 * Splits skip ranges across CPU cores for faster searching.
 */
function elsSearchParallel(streamId, term, { minSkip = 1, maxSkip = 3000, direction = 'both', threads = null } = {}) {
    const data = getStream(streamId);
    if (!data) return Promise.reject(new Error(`Stream not found: ${streamId}`));

    term = term.toUpperCase().replace(/[^A-Z]/g, '');
    if (!term || term.length < MIN_TERM_LENGTH) return Promise.reject(new Error(`Term must be at least ${MIN_TERM_LENGTH} letters (A-Z only). Short terms produce too many hits and can crash the server.`));

    const stream = data.stream;
    maxSkip = Math.min(maxSkip, Math.floor(stream.length / term.length));

    const numThreads = threads || Math.max(1, os.cpus().length - 1);
    const totalSkips = maxSkip - minSkip + 1;
    const skipsPerThread = Math.ceil(totalSkips / numThreads);

    const directions = [];
    if (direction === 'both' || direction === 'forward') directions.push(1);
    if (direction === 'both' || direction === 'reverse') directions.push(-1);

    // Each worker gets a share of the global hit cap
    const perWorkerCap = Math.ceil(MAX_HITS / Math.max(1, Math.min(numThreads, totalSkips)));

    return new Promise((resolve, reject) => {
        const allHits = [];
        let completed = 0;
        let anyCapped = false;
        const actualThreads = Math.min(numThreads, totalSkips);

        if (actualThreads === 0) {
            resolve({ hits: [], capped: false });
            return;
        }

        for (let t = 0; t < actualThreads; t++) {
            const skipStart = minSkip + (t * skipsPerThread);
            const skipEnd = Math.min(skipStart + skipsPerThread - 1, maxSkip);

            if (skipStart > maxSkip) {
                completed++;
                if (completed === actualThreads) resolve({ hits: allHits, capped: anyCapped });
                continue;
            }

            const worker = new Worker(__filename, {
                workerData: { stream, term, skipStart, skipEnd, directions, maxHits: perWorkerCap }
            });

            worker.on('message', (result) => {
                allHits.push(...result.hits);
                if (result.capped) anyCapped = true;
                completed++;
                if (completed === actualThreads) {
                    // Apply global cap across all worker results
                    const globalCapped = anyCapped || allHits.length >= MAX_HITS;
                    const trimmed = allHits.slice(0, MAX_HITS);
                    resolve({ hits: trimmed, capped: globalCapped });
                }
            });

            worker.on('error', (err) => {
                log('ERROR', `Worker ${t} error: ${err.message}`);
                completed++;
                if (completed === actualThreads) resolve({ hits: allHits, capped: anyCapped });
            });

            worker.on('exit', (code) => {
                if (code !== 0) {
                    log('WARN', `Worker ${t} exited with code ${code}`);
                }
            });
        }

        // Safety timeout — 60 seconds
        setTimeout(() => {
            if (completed < actualThreads) {
                log('WARN', `ELS search timeout — ${completed}/${actualThreads} workers completed`);
                resolve({ hits: allHits, capped: true });
            }
        }, 60000);
    });
}

/**
 * Main search entry point. Uses parallel for large searches, sync for small.
 * Auto-maps hit positions to verse references.
 * Returns enriched hits ready for storage/display.
 */
async function search(streamId, term, options = {}) {
    const {
        minSkip = 1,
        maxSkip = 3000,
        direction = 'both',
        parallel = true,
        mapVerses = true
    } = options;

    // Enforce minimum term length before any work
    const cleanTerm = (term || '').toUpperCase().replace(/[^A-Z]/g, '');
    if (!cleanTerm || cleanTerm.length < MIN_TERM_LENGTH) {
        throw new Error(`Term must be at least ${MIN_TERM_LENGTH} letters (A-Z only). Short terms produce too many hits and can crash the server.`);
    }

    const startTime = Date.now();
    const data = getStream(streamId);

    // Decide sync vs parallel based on search space
    const totalSkips = maxSkip - minSkip + 1;
    const useParallel = parallel && totalSkips > 500;

    let result;
    if (useParallel) {
        result = await elsSearchParallel(streamId, term, { minSkip, maxSkip, direction });
    } else {
        result = elsSearchSync(streamId, term, { minSkip, maxSkip, direction });
    }

    let hits = result.hits;
    const hitsCapped = result.capped;
    const elapsed = Date.now() - startTime;

    // Enrich hits with verse mappings
    if (mapVerses && hits.length > 0) {
        for (const hit of hits) {
            // Map start, mid, and end positions
            const startVerse = positionToVerse(streamId, hit.positions[0]);
            const endVerse = positionToVerse(streamId, hit.positions[hit.positions.length - 1]);
            const midIdx = Math.floor(hit.positions.length / 2);
            const midVerse = positionToVerse(streamId, hit.positions[midIdx]);

            hit.start_verse = startVerse ? startVerse.reference : '';
            hit.mid_verse = midVerse ? midVerse.reference : '';
            hit.end_verse = endVerse ? endVerse.reference : '';
        }
    }

    // Sort by skip interval
    hits.sort((a, b) => a.skip - b.skip);

    return {
        term: term.toUpperCase().replace(/[^A-Z]/g, ''),
        stream_id: streamId,
        stream_name: data ? STREAM_SCOPES[streamId]?.display || streamId.toUpperCase() : streamId,
        total_letters: data ? data.totalLetters : 0,
        hit_count: hits.length,
        hits_capped: hitsCapped,
        max_hits: MAX_HITS,
        elapsed_ms: elapsed,
        search_mode: useParallel ? 'parallel' : 'sync',
        skip_range: { min: minSkip, max: maxSkip },
        direction,
        hits
    };
}

// ============================================================================
// STREAM STATISTICS & UTILITIES
// ============================================================================

/**
 * Get letter frequency analysis for a stream.
 */
function getLetterFrequency(streamId) {
    const data = getStream(streamId);
    if (!data) return null;

    const sorted = Object.entries(data.letterFreq)
        .sort((a, b) => b[1] - a[1])
        .map(([letter, count]) => ({
            letter,
            count,
            percentage: ((count / data.totalLetters) * 100).toFixed(3),
            probability: count / data.totalLetters
        }));

    return {
        stream_id: streamId,
        total_letters: data.totalLetters,
        unique_letters: sorted.length,
        frequencies: sorted
    };
}

/**
 * Get stream metadata without loading the full stream string.
 */
function getStreamInfo(streamId) {
    const row = database.queryOne(
        'SELECT stream_id, display_name, total_letters, total_verses, letter_freq, built_at FROM letter_streams WHERE stream_id = ?',
        [streamId]
    );

    if (!row) return null;

    return {
        stream_id: row.stream_id,
        display_name: row.display_name,
        total_letters: row.total_letters,
        total_verses: row.total_verses,
        letter_freq: JSON.parse(row.letter_freq),
        built_at: row.built_at,
        cached_in_memory: !!streamCache[streamId]
    };
}

/**
 * Force rebuild a stream (e.g. if scripture data changes).
 */
function rebuildStream(streamId) {
    // Clear from memory cache
    delete streamCache[streamId];

    // Delete from DB
    database.getDb().run('DELETE FROM letter_streams WHERE stream_id = ?', [streamId]);
    database.saveToDisk();

    // Rebuild
    return buildStream(streamId);
}

/**
 * Rebuild all cached streams.
 */
function rebuildAllStreams() {
    const results = [];
    const built = database.queryAll('SELECT stream_id FROM letter_streams');

    for (const row of built) {
        try {
            results.push(rebuildStream(row.stream_id));
        } catch (err) {
            log('ERROR', `Failed to rebuild stream "${row.stream_id}": ${err.message}`);
            results.push({ stream_id: row.stream_id, error: err.message });
        }
    }

    return results;
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
    init,

    // Stream building
    buildStream,
    getStream,
    listStreams,
    rebuildStream,
    rebuildAllStreams,
    getStreamInfo,

    // Position mapping
    positionToVerse,
    positionsToVerses,
    getVerseAtPosition,

    // ELS search
    search,
    elsSearchSync,
    elsSearchParallel,

    // Utilities
    getLetterFrequency,

    // Constants
    STREAM_SCOPES,
    BOOK_ORDER,
    MIN_TERM_LENGTH,
    MAX_HITS
};
