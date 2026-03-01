// ============================================================================
// KARP Bible Code — ELS Session & History Manager
// Version: 0.1.0
// Author: SoulDriver (Adelaide, Australia)
// Description: Research session management, search persistence, and history
//              browsing. Every ELS search is auto-saved with its hits —
//              building a persistent research ledger over time.
//              The sweep & proximity tools run on cached positions, not the
//              letter stream — making cross-session analysis instant.
// License: MIT
// ============================================================================

const crypto = require('crypto');

let database = null;

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(level, msg) {
    process.stderr.write(`${new Date().toISOString()} [ELS-SESSION:${level}] ${msg}\n`);
}

// ---------------------------------------------------------------------------
// ID Generator
// ---------------------------------------------------------------------------

function generateId(prefix = 'els') {
    return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

function init(db) {
    database = db;
    // Schema is created by els_engine.js — we just use the tables
    log('INFO', 'Session manager initialized');
}

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================

/**
 * Create a new research session.
 */
function createSession(name, notes = '') {
    const sessionId = generateId('session');
    const now = new Date().toISOString();

    database.getDb().run(
        `INSERT INTO els_sessions (session_id, name, created_at, updated_at, notes) VALUES (?, ?, ?, ?, ?)`,
        [sessionId, name, now, now, notes]
    );
    database.saveToDisk();

    log('INFO', `Session created: ${sessionId} — "${name}"`);
    return { session_id: sessionId, name, created_at: now, notes };
}

/**
 * Get a session by ID, including its searches.
 */
function getSession(sessionId) {
    const session = database.queryOne(
        'SELECT * FROM els_sessions WHERE session_id = ?',
        [sessionId]
    );
    if (!session) return null;

    // Get searches in this session
    const searches = database.queryAll(
        'SELECT search_id, term, stream_id, skip_min, skip_max, direction, hit_count, elapsed_ms, searched_at FROM els_searches WHERE session_id = ? ORDER BY searched_at DESC',
        [sessionId]
    );

    return { ...session, searches, search_count: searches.length };
}

/**
 * List all sessions.
 */
function listSessions({ limit = 20, offset = 0 } = {}) {
    const sessions = database.queryAll(
        `SELECT s.*, (SELECT COUNT(*) FROM els_searches WHERE session_id = s.session_id) as search_count
         FROM els_sessions s ORDER BY s.updated_at DESC LIMIT ? OFFSET ?`,
        [limit, offset]
    );
    return sessions;
}

/**
 * Update session name/notes.
 */
function updateSession(sessionId, updates) {
    const existing = database.queryOne('SELECT * FROM els_sessions WHERE session_id = ?', [sessionId]);
    if (!existing) throw new Error(`Session not found: ${sessionId}`);

    const now = new Date().toISOString();
    const sets = ['updated_at = ?'];
    const values = [now];

    if (updates.name !== undefined) { sets.push('name = ?'); values.push(updates.name); }
    if (updates.notes !== undefined) { sets.push('notes = ?'); values.push(updates.notes); }

    values.push(sessionId);
    database.getDb().run(`UPDATE els_sessions SET ${sets.join(', ')} WHERE session_id = ?`, values);
    database.saveToDisk();

    return getSession(sessionId);
}

/**
 * Delete a session and all its searches/hits.
 */
function deleteSession(sessionId) {
    const existing = database.queryOne('SELECT * FROM els_sessions WHERE session_id = ?', [sessionId]);
    if (!existing) throw new Error(`Session not found: ${sessionId}`);

    // Get all search IDs in this session
    const searchIds = database.queryAll(
        'SELECT search_id FROM els_searches WHERE session_id = ?',
        [sessionId]
    ).map(r => r.search_id);

    // Delete hits for those searches
    for (const sid of searchIds) {
        database.getDb().run('DELETE FROM els_hits WHERE search_id = ?', [sid]);
        database.getDb().run('DELETE FROM els_statistics WHERE search_id = ?', [sid]);
    }

    // Delete searches
    database.getDb().run('DELETE FROM els_searches WHERE session_id = ?', [sessionId]);

    // Delete clusters
    database.getDb().run('DELETE FROM els_clusters WHERE session_id = ?', [sessionId]);

    // Delete session
    database.getDb().run('DELETE FROM els_sessions WHERE session_id = ?', [sessionId]);

    database.immediateSave();
    log('INFO', `Session deleted: ${sessionId} (${searchIds.length} searches removed)`);

    return { deleted: true, session_id: sessionId, name: existing.name, searches_removed: searchIds.length };
}

/**
 * Get or create a "default" session for auto-save when no session is specified.
 */
function getDefaultSession() {
    // Look for an existing default session
    let session = database.queryOne(
        "SELECT * FROM els_sessions WHERE name = '__default__' ORDER BY created_at DESC LIMIT 1"
    );

    if (!session) {
        const result = createSession('__default__', 'Auto-created default session for unsessioned searches');
        return result.session_id;
    }

    return session.session_id;
}

// ============================================================================
// SEARCH PERSISTENCE — Auto-save every search + hits
// ============================================================================

/**
 * Save a completed search and all its hits to the database.
 * Called automatically after every els_search.
 *
 * @param {Object} searchResult - Output from elsEngine.search()
 * @param {string} sessionId - Session to attach to (uses default if null)
 * @returns {Object} - Saved search record with search_id
 */
function saveSearch(searchResult, sessionId = null) {
    if (!sessionId) {
        sessionId = getDefaultSession();
    }

    const searchId = generateId('search');
    const now = new Date().toISOString();

    // Insert the search record
    database.getDb().run(
        `INSERT INTO els_searches (search_id, session_id, term, stream_id, skip_min, skip_max, direction, hit_count, elapsed_ms, searched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            searchId,
            sessionId,
            searchResult.term,
            searchResult.stream_id,
            searchResult.skip_range.min,
            searchResult.skip_range.max,
            searchResult.direction,
            searchResult.hit_count,
            searchResult.elapsed_ms,
            now
        ]
    );

    // Insert all hits
    if (searchResult.hits && searchResult.hits.length > 0) {
        const db = database.getDb();
        db.run('BEGIN TRANSACTION;');
        try {
            for (const hit of searchResult.hits) {
                const hitId = generateId('hit');
                db.run(
                    `INSERT INTO els_hits (hit_id, search_id, term, stream_id, start_position, skip_interval, direction, positions, start_verse, mid_verse, end_verse, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        hitId,
                        searchId,
                        hit.term,
                        searchResult.stream_id,
                        hit.start,
                        hit.skip,
                        hit.direction,
                        JSON.stringify(hit.positions),
                        hit.start_verse || '',
                        hit.mid_verse || '',
                        hit.end_verse || '',
                        now
                    ]
                );
            }
            db.run('COMMIT;');
        } catch (err) {
            db.run('ROLLBACK;');
            log('ERROR', `Failed to save hits for search ${searchId}: ${err.message}`);
        }
    }

    // Update session timestamp
    database.getDb().run(
        'UPDATE els_sessions SET updated_at = ? WHERE session_id = ?',
        [now, sessionId]
    );

    database.saveToDisk();
    log('INFO', `Search saved: ${searchId} — "${searchResult.term}" in ${searchResult.stream_id} (${searchResult.hit_count} hits)`);

    return {
        search_id: searchId,
        session_id: sessionId,
        term: searchResult.term,
        stream_id: searchResult.stream_id,
        hit_count: searchResult.hit_count,
        elapsed_ms: searchResult.elapsed_ms,
        saved_at: now
    };
}

// ============================================================================
// SEARCH HISTORY — Browse past searches
// ============================================================================

/**
 * Get a specific search by ID, including its hits.
 */
function getSearch(searchId) {
    const search = database.queryOne(
        'SELECT * FROM els_searches WHERE search_id = ?',
        [searchId]
    );
    if (!search) return null;

    const hits = database.queryAll(
        'SELECT * FROM els_hits WHERE search_id = ? ORDER BY skip_interval ASC',
        [searchId]
    ).map(h => ({
        ...h,
        positions: JSON.parse(h.positions || '[]')
    }));

    return { ...search, hits };
}

/**
 * Browse search history with filters.
 */
function searchHistory({ term, stream_id, session_id, limit = 20, offset = 0 } = {}) {
    let sql = 'SELECT * FROM els_searches WHERE 1=1';
    const params = [];

    if (term) {
        sql += ' AND term LIKE ?';
        params.push(`%${term.toUpperCase()}%`);
    }
    if (stream_id) {
        sql += ' AND stream_id = ?';
        params.push(stream_id);
    }
    if (session_id) {
        sql += ' AND session_id = ?';
        params.push(session_id);
    }

    sql += ' ORDER BY searched_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return database.queryAll(sql, params);
}

/**
 * Get all hits for a specific term across ALL searches (for cross-session analysis).
 */
function getAllHitsForTerm(term, streamId = null) {
    let sql = 'SELECT * FROM els_hits WHERE term = ?';
    const params = [term.toUpperCase()];

    if (streamId) {
        sql += ' AND stream_id = ?';
        params.push(streamId);
    }

    sql += ' ORDER BY start_position ASC';

    return database.queryAll(sql, params).map(h => ({
        ...h,
        positions: JSON.parse(h.positions || '[]')
    }));
}

/**
 * Get all unique terms that have been searched.
 */
function getSearchedTerms(streamId = null) {
    let sql = 'SELECT DISTINCT term, stream_id, COUNT(*) as search_count, SUM(hit_count) as total_hits FROM els_searches';
    const params = [];

    if (streamId) {
        sql += ' WHERE stream_id = ?';
        params.push(streamId);
    }

    sql += ' GROUP BY term, stream_id ORDER BY term ASC';

    return database.queryAll(sql, params);
}

// ============================================================================
// STATISTICS
// ============================================================================

/**
 * Get aggregate statistics for the ELS research system.
 */
function getStats() {
    const totalSessions = database.queryOne('SELECT COUNT(*) as count FROM els_sessions')?.count || 0;
    const totalSearches = database.queryOne('SELECT COUNT(*) as count FROM els_searches')?.count || 0;
    const totalHits = database.queryOne('SELECT COUNT(*) as count FROM els_hits')?.count || 0;
    const totalClusters = database.queryOne('SELECT COUNT(*) as count FROM els_clusters')?.count || 0;
    const uniqueTerms = database.queryOne('SELECT COUNT(DISTINCT term) as count FROM els_searches')?.count || 0;
    const streamsUsed = database.queryOne('SELECT COUNT(DISTINCT stream_id) as count FROM els_searches')?.count || 0;

    // Most searched terms
    const topTerms = database.queryAll(
        'SELECT term, COUNT(*) as times_searched, SUM(hit_count) as total_hits FROM els_searches GROUP BY term ORDER BY times_searched DESC LIMIT 10'
    );

    // Recent sessions
    const recentSessions = database.queryAll(
        `SELECT s.*, (SELECT COUNT(*) FROM els_searches WHERE session_id = s.session_id) as search_count
         FROM els_sessions s WHERE s.name != '__default__' ORDER BY s.updated_at DESC LIMIT 5`
    );

    return {
        total_sessions: totalSessions,
        total_searches: totalSearches,
        total_hits: totalHits,
        total_clusters: totalClusters,
        unique_terms: uniqueTerms,
        streams_used: streamsUsed,
        top_terms: topTerms,
        recent_sessions: recentSessions
    };
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
    init,

    // Sessions
    createSession,
    getSession,
    listSessions,
    updateSession,
    deleteSession,
    getDefaultSession,

    // Search persistence
    saveSearch,

    // History
    getSearch,
    searchHistory,
    getAllHitsForTerm,
    getSearchedTerms,

    // Stats
    getStats
};
