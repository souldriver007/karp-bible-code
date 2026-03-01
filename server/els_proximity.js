// ============================================================================
// KARP Bible Code — ELS Proximity, Clustering & Sweep Engine
// Version: 0.1.0
// Author: SoulDriver (Adelaide, Australia)
// Description: Layer 4 of the Bible Code system. Runs on CACHED hit positions
//              from the els_hits table — not the letter stream. This makes
//              cross-referencing instant regardless of Bible size.
//
//              Three tools:
//              1. els_proximity  — pairwise distance between two terms
//              2. els_cluster    — sliding window density across session terms
//              3. els_sweep      — scan ALL research history for connections
//
//              These are where the real discoveries happen. Individual ELS
//              finds are interesting. Clusters of multiple terms converging
//              in the same region are extraordinary.
//
// License: MIT
// ============================================================================

let database = null;
let elsEngine = null;
let elsSessions = null;

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(level, msg) {
    process.stderr.write(`${new Date().toISOString()} [ELS-PROX:${level}] ${msg}\n`);
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

function init(db, engine, sessions) {
    database = db;
    elsEngine = engine;
    elsSessions = sessions;
    log('INFO', 'Proximity engine initialized');
}

// ============================================================================
// UTILITY: Load cached hits for a term
// ============================================================================

/**
 * Get all cached hit positions for a term in a given stream.
 * Returns a flat array of { hit_id, term, skip, direction, positions[], start_verse, mid_verse, end_verse }
 * pulled from the els_hits table — no re-scanning the letter stream.
 */
function getCachedHits(term, streamId) {
    term = term.toUpperCase().replace(/[^A-Z]/g, '');

    const rows = database.queryAll(
        'SELECT * FROM els_hits WHERE term = ? AND stream_id = ? ORDER BY start_position ASC',
        [term, streamId]
    );

    return rows.map(r => ({
        hit_id: r.hit_id,
        term: r.term,
        skip: r.skip_interval,
        direction: r.direction,
        start_position: r.start_position,
        positions: JSON.parse(r.positions || '[]'),
        start_verse: r.start_verse,
        mid_verse: r.mid_verse,
        end_verse: r.end_verse
    }));
}

/**
 * Get all unique terms with cached hits in a given stream.
 */
function getCachedTerms(streamId) {
    return database.queryAll(
        'SELECT DISTINCT term, COUNT(*) as hit_count FROM els_hits WHERE stream_id = ? GROUP BY term ORDER BY term',
        [streamId]
    );
}

/**
 * Get all unique terms in a specific session.
 */
function getSessionTerms(sessionId) {
    return database.queryAll(
        `SELECT DISTINCT h.term, COUNT(*) as hit_count, h.stream_id
         FROM els_hits h
         JOIN els_searches s ON h.search_id = s.search_id
         WHERE s.session_id = ?
         GROUP BY h.term, h.stream_id
         ORDER BY h.term`,
        [sessionId]
    );
}

// ============================================================================
// TOOL 1: ELS PROXIMITY — Pairwise distance between two terms
// ============================================================================

/**
 * Compute proximity analysis between two terms' cached hit positions.
 *
 * For every hit of term A and every hit of term B, compute:
 * - Minimum distance between any letter positions (closest approach)
 * - Whether they share any exact letter positions (intersection)
 * - Pairwise closest pairs ranked by distance
 *
 * This runs on cached positions from the database — milliseconds, not minutes.
 *
 * @param {string} termA - First term
 * @param {string} termB - Second term
 * @param {string} streamId - Which stream to use
 * @param {Object} options - { maxPairs, maxDistance }
 * @returns {Object} Proximity analysis results
 */
function proximity(termA, termB, streamId, options = {}) {
    const {
        maxPairs = 20,        // Max closest pairs to return
        maxDistance = null     // Filter: only pairs within this distance (null = all)
    } = options;

    const startTime = Date.now();

    termA = termA.toUpperCase().replace(/[^A-Z]/g, '');
    termB = termB.toUpperCase().replace(/[^A-Z]/g, '');

    const hitsA = getCachedHits(termA, streamId);
    const hitsB = getCachedHits(termB, streamId);

    if (!hitsA.length) {
        return { error: `No cached hits for "${termA}" in ${streamId}. Run els_search first.` };
    }
    if (!hitsB.length) {
        return { error: `No cached hits for "${termB}" in ${streamId}. Run els_search first.` };
    }

    // --- Find intersections (shared letter positions) ---
    const posSetA = new Set();
    for (const hit of hitsA) {
        for (const pos of hit.positions) posSetA.add(pos);
    }

    const intersections = [];
    for (const hit of hitsB) {
        for (const pos of hit.positions) {
            if (posSetA.has(pos)) {
                const verseInfo = elsEngine.positionToVerse(streamId, pos);
                intersections.push({
                    position: pos,
                    verse: verseInfo ? verseInfo.reference : '?',
                    letter: verseInfo ? verseInfo.letter : '?'
                });
            }
        }
    }

    // --- Compute pairwise minimum distances ---
    // For each hit of A, find its closest hit in B (by start position)
    // This is O(n*m) but on cached data it's fast
    const pairs = [];

    for (const hitA of hitsA) {
        for (const hitB of hitsB) {
            // Minimum distance between ANY positions of hitA and ANY positions of hitB
            let minDist = Infinity;
            let closestPosA = null;
            let closestPosB = null;

            for (const posA of hitA.positions) {
                for (const posB of hitB.positions) {
                    const dist = Math.abs(posA - posB);
                    if (dist < minDist) {
                        minDist = dist;
                        closestPosA = posA;
                        closestPosB = posB;
                    }
                }
            }

            if (maxDistance !== null && minDist > maxDistance) continue;

            pairs.push({
                distance: minDist,
                hitA: {
                    skip: hitA.skip,
                    direction: hitA.direction,
                    start_verse: hitA.start_verse,
                    closest_position: closestPosA
                },
                hitB: {
                    skip: hitB.skip,
                    direction: hitB.direction,
                    start_verse: hitB.start_verse,
                    closest_position: closestPosB
                },
                closest_verse_A: elsEngine.positionToVerse(streamId, closestPosA)?.reference || '?',
                closest_verse_B: elsEngine.positionToVerse(streamId, closestPosB)?.reference || '?'
            });
        }
    }

    // Sort by distance and take top N
    pairs.sort((a, b) => a.distance - b.distance);
    const closestPairs = pairs.slice(0, maxPairs);

    // Map the closest pair's region to verse context
    let closestRegion = null;
    if (closestPairs.length > 0) {
        const best = closestPairs[0];
        const regionStart = Math.min(best.hitA.closest_position, best.hitB.closest_position);
        const regionEnd = Math.max(best.hitA.closest_position, best.hitB.closest_position);
        const startVerse = elsEngine.positionToVerse(streamId, regionStart);
        const endVerse = elsEngine.positionToVerse(streamId, regionEnd);

        closestRegion = {
            distance: best.distance,
            region_start: regionStart,
            region_end: regionEnd,
            start_verse: startVerse?.reference || '?',
            end_verse: endVerse?.reference || '?',
            span_letters: regionEnd - regionStart
        };
    }

    const elapsed = Date.now() - startTime;

    return {
        term_a: termA,
        term_b: termB,
        stream_id: streamId,
        hits_a: hitsA.length,
        hits_b: hitsB.length,
        total_pairs_checked: hitsA.length * hitsB.length,
        intersections: {
            count: intersections.length,
            shared_positions: intersections
        },
        closest_region: closestRegion,
        closest_pairs: closestPairs,
        elapsed_ms: elapsed
    };
}

// ============================================================================
// TOOL 2: ELS CLUSTER — Sliding window density finder
// ============================================================================

/**
 * Find the densest region where multiple terms converge.
 *
 * Uses a sliding window across the letter stream to find the region
 * with the highest concentration of hits from different terms.
 *
 * Can operate on:
 * - All terms in a session (session_id)
 * - A specific list of terms
 *
 * @param {string} streamId - Which stream
 * @param {Object} options - { session_id, terms[], windowSize, minTerms, maxResults }
 * @returns {Object} Cluster analysis results
 */
function cluster(streamId, options = {}) {
    const {
        session_id = null,
        terms = null,          // Explicit term list (overrides session)
        windowSize = 10000,    // Window size in letters
        minTerms = 2,          // Minimum distinct terms in a cluster
        maxResults = 10,       // Max clusters to return
        excludeShort = true    // Exclude terms with >10,000 hits (noise)
    } = options;

    const startTime = Date.now();

    // Determine which terms to analyse
    let termList;
    if (terms && terms.length > 0) {
        termList = terms.map(t => ({
            term: t.toUpperCase().replace(/[^A-Z]/g, ''),
            stream_id: streamId
        }));
    } else if (session_id) {
        termList = getSessionTerms(session_id).filter(t => t.stream_id === streamId);
    } else {
        termList = getCachedTerms(streamId);
    }

    if (termList.length < 2) {
        return { error: `Need at least 2 terms for cluster analysis. Found ${termList.length}. Run more els_search first.` };
    }

    // Load all hits, optionally filtering noisy short terms
    const allHitsByTerm = {};
    const allPositions = []; // Flat list of { position, term } for sliding window

    for (const t of termList) {
        const hits = getCachedHits(t.term, streamId);

        if (excludeShort && hits.length > 10000) {
            log('INFO', `Excluding "${t.term}" from cluster analysis (${hits.length} hits — noise)`);
            continue;
        }

        if (hits.length === 0) continue;

        allHitsByTerm[t.term] = hits;

        // Add start positions to flat list
        for (const hit of hits) {
            allPositions.push({
                position: hit.start_position,
                term: t.term,
                skip: hit.skip,
                direction: hit.direction,
                start_verse: hit.start_verse
            });
        }
    }

    const activeTerms = Object.keys(allHitsByTerm);
    if (activeTerms.length < minTerms) {
        return {
            error: `Only ${activeTerms.length} terms with hits after filtering. Need at least ${minTerms}.`,
            terms_available: activeTerms
        };
    }

    // Sort all positions
    allPositions.sort((a, b) => a.position - b.position);

    if (allPositions.length === 0) {
        return { error: 'No hit positions to analyse.' };
    }

    // --- Sliding window: find regions with most distinct terms ---
    const streamData = elsEngine.getStream(streamId);
    const streamLength = streamData ? streamData.totalLetters : allPositions[allPositions.length - 1].position + 1;

    const clusters = [];

    // Use a two-pointer sliding window on the sorted positions
    let left = 0;

    for (let right = 0; right < allPositions.length; right++) {
        // Advance left pointer until window fits
        while (allPositions[right].position - allPositions[left].position > windowSize) {
            left++;
        }

        // Count distinct terms in this window
        const windowTerms = new Set();
        const windowHits = [];
        for (let i = left; i <= right; i++) {
            windowTerms.add(allPositions[i].term);
            windowHits.push(allPositions[i]);
        }

        if (windowTerms.size >= minTerms) {
            const regionStart = allPositions[left].position;
            const regionEnd = allPositions[right].position;

            clusters.push({
                region_start: regionStart,
                region_end: regionEnd,
                spread: regionEnd - regionStart,
                distinct_terms: windowTerms.size,
                total_hits: windowHits.length,
                terms: Array.from(windowTerms),
                hits_per_term: Object.fromEntries(
                    Array.from(windowTerms).map(t => [
                        t,
                        windowHits.filter(h => h.term === t).length
                    ])
                ),
                start_verse: elsEngine.positionToVerse(streamId, regionStart)?.reference || '?',
                end_verse: elsEngine.positionToVerse(streamId, regionEnd)?.reference || '?'
            });
        }
    }

    // Deduplicate overlapping clusters — keep the ones with most terms, then tightest spread
    const deduplicated = deduplicateClusters(clusters, windowSize);

    // Sort by distinct_terms DESC, then spread ASC (tighter is better)
    deduplicated.sort((a, b) => {
        if (b.distinct_terms !== a.distinct_terms) return b.distinct_terms - a.distinct_terms;
        return a.spread - b.spread;
    });

    const topClusters = deduplicated.slice(0, maxResults);

    // Enrich top clusters with verse detail
    for (const c of topClusters) {
        // Get the hit detail for each term in this cluster
        c.detail = [];
        for (const term of c.terms) {
            const termHits = allHitsByTerm[term] || [];
            const inRegion = termHits.filter(h =>
                h.start_position >= c.region_start && h.start_position <= c.region_end
            );
            for (const hit of inRegion.slice(0, 3)) { // Max 3 per term
                c.detail.push({
                    term: hit.term,
                    skip: hit.skip,
                    direction: hit.direction,
                    start_verse: hit.start_verse,
                    mid_verse: hit.mid_verse
                });
            }
        }
    }

    const elapsed = Date.now() - startTime;

    return {
        stream_id: streamId,
        terms_analysed: activeTerms,
        term_count: activeTerms.length,
        window_size: windowSize,
        total_positions: allPositions.length,
        clusters_found: deduplicated.length,
        top_clusters: topClusters,
        elapsed_ms: elapsed
    };
}

/**
 * Remove overlapping clusters, keeping the best one in each region.
 * Two clusters overlap if their regions intersect by more than 50%.
 */
function deduplicateClusters(clusters, windowSize) {
    if (clusters.length === 0) return [];

    // Sort by distinct_terms DESC, then spread ASC
    const sorted = [...clusters].sort((a, b) => {
        if (b.distinct_terms !== a.distinct_terms) return b.distinct_terms - a.distinct_terms;
        return a.spread - b.spread;
    });

    const kept = [];
    const halfWindow = windowSize / 2;

    for (const c of sorted) {
        const midpoint = (c.region_start + c.region_end) / 2;

        // Check if this cluster's midpoint is too close to any kept cluster
        const overlaps = kept.some(k => {
            const kMid = (k.region_start + k.region_end) / 2;
            return Math.abs(midpoint - kMid) < halfWindow;
        });

        if (!overlaps) {
            kept.push(c);
        }
    }

    return kept;
}

// ============================================================================
// TOOL 3: ELS SWEEP — Cross-reference ALL research history
// ============================================================================

/**
 * The killer feature: scan the entire research history for connections
 * between terms that were searched days, weeks, or months apart.
 *
 * For every pair of terms ever searched in the same stream, compute
 * proximity. Report any pairs that are surprisingly close or share
 * exact letter positions.
 *
 * This is how you discover that a name searched in January is 4 letters
 * away from a name searched in March — connections you never explicitly
 * looked for.
 *
 * @param {string} streamId - Which stream to sweep
 * @param {Object} options - { maxDistance, maxResults, excludeShort }
 * @returns {Object} Sweep results with discovered connections
 */
function sweep(streamId, options = {}) {
    const {
        maxDistance = 500,      // Only report pairs within this letter distance
        maxResults = 30,        // Max connections to return
        excludeShort = true,    // Exclude terms with >10K hits
        minTermLength = 4       // Minimum term length to include
    } = options;

    const startTime = Date.now();

    // Get all terms ever searched in this stream
    let allTerms = getCachedTerms(streamId);

    // Filter
    if (minTermLength > 0) {
        allTerms = allTerms.filter(t => t.term.length >= minTermLength);
    }
    if (excludeShort) {
        allTerms = allTerms.filter(t => t.hit_count <= 10000);
    }

    if (allTerms.length < 2) {
        return {
            error: `Need at least 2 searchable terms in ${streamId}. Found ${allTerms.length}. Run more searches first.`,
            terms_available: allTerms.map(t => t.term)
        };
    }

    log('INFO', `Sweep: analysing ${allTerms.length} terms in ${streamId}...`);

    // Load all hit positions into memory
    const hitsByTerm = {};
    for (const t of allTerms) {
        hitsByTerm[t.term] = getCachedHits(t.term, streamId);
    }

    // Check every pair of terms
    const discoveries = [];
    const termNames = Object.keys(hitsByTerm);

    for (let i = 0; i < termNames.length; i++) {
        for (let j = i + 1; j < termNames.length; j++) {
            const termA = termNames[i];
            const termB = termNames[j];
            const hitsA = hitsByTerm[termA];
            const hitsB = hitsByTerm[termB];

            // Build position sets for intersection check
            const posSetA = new Set();
            for (const h of hitsA) for (const p of h.positions) posSetA.add(p);

            // Check for intersections
            const sharedPositions = [];
            for (const h of hitsB) {
                for (const p of h.positions) {
                    if (posSetA.has(p)) {
                        sharedPositions.push(p);
                    }
                }
            }

            // Find closest approach (by start positions for speed)
            let closestDist = Infinity;
            let closestA = null;
            let closestB = null;

            // Optimise: both arrays sorted by start_position — use merge-style scan
            let ai = 0, bi = 0;
            const sortedA = hitsA; // Already sorted by start_position from getCachedHits
            const sortedB = hitsB;

            while (ai < sortedA.length && bi < sortedB.length) {
                const dist = Math.abs(sortedA[ai].start_position - sortedB[bi].start_position);
                if (dist < closestDist) {
                    closestDist = dist;
                    closestA = sortedA[ai];
                    closestB = sortedB[bi];
                }

                // Advance the pointer with the smaller position
                if (sortedA[ai].start_position < sortedB[bi].start_position) {
                    ai++;
                } else {
                    bi++;
                }
            }

            // Report if within threshold or has intersections
            if (closestDist <= maxDistance || sharedPositions.length > 0) {
                const discovery = {
                    term_a: termA,
                    term_b: termB,
                    hits_a: hitsA.length,
                    hits_b: hitsB.length,
                    closest_distance: closestDist,
                    intersections: sharedPositions.length,
                    closest_verse_a: closestA ? closestA.start_verse : '?',
                    closest_verse_b: closestB ? closestB.start_verse : '?'
                };

                // Map intersection positions to verses
                if (sharedPositions.length > 0) {
                    discovery.shared_verses = sharedPositions.slice(0, 5).map(pos => {
                        const v = elsEngine.positionToVerse(streamId, pos);
                        return v ? v.reference : '?';
                    });
                }

                // Score: lower distance + more intersections = more interesting
                discovery._score = (sharedPositions.length * 1000) + (maxDistance - Math.min(closestDist, maxDistance));
                discoveries.push(discovery);
            }
        }
    }

    // Sort by score descending
    discoveries.sort((a, b) => b._score - a._score);

    // Clean up internal score field
    const results = discoveries.slice(0, maxResults).map(d => {
        const { _score, ...rest } = d;
        return rest;
    });

    const elapsed = Date.now() - startTime;

    return {
        stream_id: streamId,
        terms_swept: termNames.length,
        pairs_checked: (termNames.length * (termNames.length - 1)) / 2,
        connections_found: results.length,
        max_distance: maxDistance,
        connections: results,
        elapsed_ms: elapsed,
        suggestion: results.length > 0
            ? 'Use els_proximity on any interesting pair for detailed position analysis, then read_scripture to check verse context.'
            : 'No close connections found yet. Run more searches to build up the research history, then sweep again.'
    };
}

// ============================================================================
// UTILITY: Save cluster as a discovery record
// ============================================================================

/**
 * Save a discovered cluster to the els_clusters table.
 */
function saveCluster(streamId, clusterData, sessionId = null) {
    const crypto = require('crypto');
    const clusterId = `cluster_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();

    database.getDb().run(
        `INSERT INTO els_clusters (cluster_id, session_id, type, terms, region_start, region_end, spread, verse_range, significance_p, metadata, discovered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            clusterId,
            sessionId,
            clusterData.type || 'mega_cluster',
            JSON.stringify(clusterData.terms || []),
            clusterData.region_start || 0,
            clusterData.region_end || 0,
            clusterData.spread || 0,
            clusterData.verse_range || '',
            clusterData.significance_p || null,
            JSON.stringify(clusterData.metadata || {}),
            now
        ]
    );

    database.saveToDisk();
    log('INFO', `Cluster saved: ${clusterId}`);
    return { cluster_id: clusterId, saved_at: now };
}

/**
 * List saved clusters.
 */
function listClusters({ sessionId, limit = 20 } = {}) {
    let sql = 'SELECT * FROM els_clusters';
    const params = [];

    if (sessionId) {
        sql += ' WHERE session_id = ?';
        params.push(sessionId);
    }

    sql += ' ORDER BY discovered_at DESC LIMIT ?';
    params.push(limit);

    return database.queryAll(sql, params).map(r => ({
        ...r,
        terms: JSON.parse(r.terms || '[]'),
        metadata: JSON.parse(r.metadata || '{}')
    }));
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
    init,

    // Core tools
    proximity,
    cluster,
    sweep,

    // Cluster persistence
    saveCluster,
    listClusters,

    // Utilities
    getCachedHits,
    getCachedTerms,
    getSessionTerms
};
