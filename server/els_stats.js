// ============================================================================
// KARP Bible Code — ELS Statistical Significance Engine
// Version: 0.1.0
// Author: SoulDriver (Adelaide, Australia)
// Description: Layer 5 of the Bible Code system. Answers the question:
//              "Is this pattern real or random?"
//
//              Three methods:
//              1. Expected Frequency — probability by letter distribution
//              2. Poisson P-Value — observed vs expected significance
//              3. Monte Carlo — shuffled text comparison (gold standard)
//
//              Monte Carlo uses worker_threads for parallel shuffling.
//              Results saved to els_statistics table for research continuity.
//
//              Design principle: The tool doesn't claim codes are real or fake.
//              It measures. It compares. It presents. The data speaks.
//
// License: MIT
// ============================================================================

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// WORKER THREAD CODE — Monte Carlo shuffle + ELS count
// ---------------------------------------------------------------------------

if (!isMainThread) {
    const { stream, term, minSkip, maxSkip, directions, runsStart, runsEnd, seed } = workerData;

    const termLen = term.length;
    const streamLen = stream.length;
    const results = [];

    // Seeded PRNG for reproducibility (xorshift32)
    let rngState = seed;
    function nextRandom() {
        rngState ^= rngState << 13;
        rngState ^= rngState >> 17;
        rngState ^= rngState << 5;
        return (rngState >>> 0) / 4294967296;
    }

    for (let run = runsStart; run < runsEnd; run++) {
        // Fisher-Yates shuffle
        const shuffled = stream.split('');
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(nextRandom() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }

        const shuffledStr = shuffled.join('');

        // Count ELS hits in shuffled text
        // Build first-letter index
        const firstPositions = [];
        for (let i = 0; i < streamLen; i++) {
            if (shuffledStr[i] === term[0]) firstPositions.push(i);
        }

        let hitCount = 0;

        for (const dir of directions) {
            for (let skip = minSkip; skip <= maxSkip; skip++) {
                for (const start of firstPositions) {
                    const endPos = start + dir * ((termLen - 1) * skip);
                    if (endPos < 0 || endPos >= streamLen) continue;

                    let match = true;
                    for (let c = 1; c < termLen; c++) {
                        const pos = start + dir * (c * skip);
                        if (pos < 0 || pos >= streamLen || shuffledStr[pos] !== term[c]) {
                            match = false;
                            break;
                        }
                    }

                    if (match) hitCount++;
                }
            }
        }

        results.push(hitCount);
    }

    parentPort.postMessage(results);
    process.exit(0);
}

// ============================================================================
// MAIN THREAD — Statistics Engine
// ============================================================================

let database = null;
let elsEngine = null;

function log(level, msg) {
    process.stderr.write(`${new Date().toISOString()} [ELS-STATS:${level}] ${msg}\n`);
}

function init(db, engine) {
    database = db;
    elsEngine = engine;
    log('INFO', 'Statistics engine initialized');
}

// ============================================================================
// METHOD 1: Expected Frequency by Letter Probability
// ============================================================================

/**
 * Calculate the expected number of ELS hits for a term based on
 * individual letter probabilities in the stream.
 *
 * For a term of length L at a specific skip interval S:
 *   P(hit at position i) = product of P(letter[j]) for j=0..L-1
 *   Expected hits at skip S = P * validStartPositions(S)
 *
 * Aggregate across all skip intervals in [minSkip, maxSkip].
 *
 * This is a baseline expectation assuming independent letter placement
 * (which is approximately true for sufficiently large texts).
 */
function expectedFrequency(streamId, term, { minSkip = 1, maxSkip = 3000, direction = 'both' } = {}) {
    term = term.toUpperCase().replace(/[^A-Z]/g, '');
    const data = elsEngine.getStream(streamId);
    if (!data) return { error: `Stream not found: ${streamId}` };

    const { letterFreq, totalLetters } = data;
    const termLen = term.length;

    // Product of individual letter probabilities
    let letterProb = 1;
    for (const ch of term) {
        const freq = letterFreq[ch] || 0;
        if (freq === 0) {
            return {
                term,
                stream_id: streamId,
                letter_probability: 0,
                expected_total: 0,
                note: `Letter '${ch}' does not appear in this stream.`
            };
        }
        letterProb *= freq / totalLetters;
    }

    // Direction multiplier
    const dirMultiplier = direction === 'both' ? 2 : 1;

    // Sum expected frequency across all skip intervals
    let expectedTotal = 0;
    const capSkip = Math.min(maxSkip, Math.floor(totalLetters / termLen));

    for (let skip = minSkip; skip <= capSkip; skip++) {
        // Number of valid starting positions for this skip
        const neededSpan = (termLen - 1) * skip;
        const validStarts = totalLetters - neededSpan;
        if (validStarts <= 0) continue;

        expectedTotal += letterProb * validStarts * dirMultiplier;
    }

    return {
        term,
        stream_id: streamId,
        stream_letters: totalLetters,
        letter_probability: letterProb,
        skip_range: { min: minSkip, max: capSkip },
        direction,
        expected_hits: parseFloat(expectedTotal.toFixed(4)),
        per_letter_probs: term.split('').map(ch => ({
            letter: ch,
            frequency: letterFreq[ch] || 0,
            probability: parseFloat(((letterFreq[ch] || 0) / totalLetters).toFixed(6))
        }))
    };
}

// ============================================================================
// METHOD 2: Poisson P-Value
// ============================================================================

/**
 * Calculate the Poisson p-value: P(X >= observed | expected).
 *
 * If we observe more hits than expected by random chance, how unlikely is that?
 * P < 0.05 = statistically significant
 * P < 0.01 = highly significant
 * P < 0.001 = extremely significant
 *
 * Uses log-space calculation to avoid factorial overflow.
 */
function poissonPValue(observed, expected) {
    if (expected <= 0) return observed > 0 ? 0 : 1;
    if (observed <= 0) return 1;

    // P(X >= observed) = 1 - P(X < observed) = 1 - sum_{k=0}^{observed-1} Poisson(k, expected)
    // Poisson(k, λ) = (λ^k * e^-λ) / k!
    // In log space: log(P(k)) = k*log(λ) - λ - log(k!)

    let cumulativeP = 0;
    let logPTerm = -expected; // log(P(0)) = -λ

    for (let k = 0; k < observed; k++) {
        cumulativeP += Math.exp(logPTerm);

        // Guard against cumulative rounding past 1
        if (cumulativeP >= 1) return 0;

        // log(P(k+1)) = log(P(k)) + log(λ) - log(k+1)
        logPTerm += Math.log(expected) - Math.log(k + 1);
    }

    return Math.max(0, 1 - cumulativeP);
}

/**
 * Full Poisson analysis: compute expected frequency, then p-value.
 */
function poissonAnalysis(streamId, term, observed, { minSkip = 1, maxSkip = 3000, direction = 'both' } = {}) {
    const freq = expectedFrequency(streamId, term, { minSkip, maxSkip, direction });
    if (freq.error) return freq;

    const expected = freq.expected_hits;
    const pValue = poissonPValue(observed, expected);
    const ratio = expected > 0 ? observed / expected : Infinity;

    let significance;
    if (pValue < 0.001) significance = 'EXTREMELY SIGNIFICANT (p < 0.001)';
    else if (pValue < 0.01) significance = 'HIGHLY SIGNIFICANT (p < 0.01)';
    else if (pValue < 0.05) significance = 'SIGNIFICANT (p < 0.05)';
    else significance = 'NOT SIGNIFICANT (p >= 0.05)';

    return {
        term,
        stream_id: streamId,
        observed,
        expected: parseFloat(expected.toFixed(4)),
        ratio: parseFloat(ratio.toFixed(4)),
        poisson_p: pValue < 0.0001 ? parseFloat(pValue.toExponential(4)) : parseFloat(pValue.toFixed(6)),
        significance,
        skip_range: freq.skip_range,
        direction,
        letter_probability: freq.letter_probability,
        per_letter_probs: freq.per_letter_probs
    };
}

// ============================================================================
// METHOD 3: Monte Carlo Simulation
// ============================================================================

/**
 * Monte Carlo significance test: shuffle the letter stream N times,
 * count ELS hits in each shuffled version, compare against the real count.
 *
 * P-value = (shuffled runs with >= observed hits) / total runs
 *
 * This is the gold standard for ELS significance because:
 * - No assumptions about letter distribution
 * - Controls for text length, letter frequency, and search parameters
 * - Directly answers: "How often does random text produce this many hits?"
 *
 * Uses worker_threads for parallel execution on multi-core CPUs.
 *
 * @param {string} streamId - Which letter stream
 * @param {string} term - Search term
 * @param {number} observed - Observed hit count from real search
 * @param {Object} options - { runs, minSkip, maxSkip, direction, threads }
 */
async function monteCarlo(streamId, term, observed, options = {}) {
    const {
        runs = 100,
        minSkip = 1,
        maxSkip = 1000,    // Narrower than full search for speed
        direction = 'both',
        threads = null
    } = options;

    term = term.toUpperCase().replace(/[^A-Z]/g, '');
    const data = elsEngine.getStream(streamId);
    if (!data) return { error: `Stream not found: ${streamId}` };

    const stream = data.stream;
    const capSkip = Math.min(maxSkip, Math.floor(stream.length / term.length));

    const directions = [];
    if (direction === 'both' || direction === 'forward') directions.push(1);
    if (direction === 'both' || direction === 'reverse') directions.push(-1);

    const numThreads = threads || Math.max(1, Math.min(os.cpus().length - 1, runs));
    const runsPerThread = Math.ceil(runs / numThreads);

    log('INFO', `Monte Carlo: ${runs} runs, "${term}" in ${streamId} (skip ${minSkip}-${capSkip}, ${numThreads} threads)`);
    const startTime = Date.now();

    // Dispatch to workers
    const allResults = await new Promise((resolve, reject) => {
        const hitCounts = [];
        let completed = 0;
        const actualThreads = Math.min(numThreads, runs);

        for (let t = 0; t < actualThreads; t++) {
            const runsStart = t * runsPerThread;
            const runsEnd = Math.min(runsStart + runsPerThread, runs);

            if (runsStart >= runs) {
                completed++;
                if (completed === actualThreads) resolve(hitCounts);
                continue;
            }

            // Generate a unique seed per worker
            const seed = (Date.now() + t * 31337 + Math.floor(Math.random() * 100000)) | 1;

            const worker = new Worker(__filename, {
                workerData: {
                    stream,
                    term,
                    minSkip,
                    maxSkip: capSkip,
                    directions,
                    runsStart,
                    runsEnd,
                    seed
                }
            });

            worker.on('message', (results) => {
                hitCounts.push(...results);
                completed++;
                if (completed === actualThreads) resolve(hitCounts);
            });

            worker.on('error', (err) => {
                log('ERROR', `MC Worker ${t} error: ${err.message}`);
                completed++;
                if (completed === actualThreads) resolve(hitCounts);
            });
        }

        // Safety timeout — 5 minutes for large runs
        setTimeout(() => {
            if (completed < actualThreads) {
                log('WARN', `Monte Carlo timeout — ${completed}/${actualThreads} workers completed`);
                resolve(hitCounts);
            }
        }, 300000);
    });

    const elapsed = Date.now() - startTime;

    // Analyse results
    const higherOrEqual = allResults.filter(c => c >= observed).length;
    const mcPValue = allResults.length > 0 ? higherOrEqual / allResults.length : 1;

    // Distribution stats
    const sorted = [...allResults].sort((a, b) => a - b);
    const mean = allResults.reduce((s, v) => s + v, 0) / allResults.length;
    const median = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 0;
    const min = sorted[0] || 0;
    const max = sorted[sorted.length - 1] || 0;

    // Standard deviation
    const variance = allResults.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / allResults.length;
    const stddev = Math.sqrt(variance);

    // Z-score: how many standard deviations is the observed from the shuffled mean?
    const zScore = stddev > 0 ? (observed - mean) / stddev : 0;

    let significance;
    if (mcPValue === 0) significance = `EXTREMELY SIGNIFICANT (p < ${(1 / allResults.length).toFixed(4)} — none of ${allResults.length} shuffled texts matched)`;
    else if (mcPValue < 0.01) significance = 'HIGHLY SIGNIFICANT (p < 0.01)';
    else if (mcPValue < 0.05) significance = 'SIGNIFICANT (p < 0.05)';
    else significance = 'NOT SIGNIFICANT (p >= 0.05)';

    log('INFO', `Monte Carlo complete: ${allResults.length} runs in ${elapsed}ms — p=${mcPValue.toFixed(4)}`);

    return {
        term,
        stream_id: streamId,
        observed_hits: observed,
        monte_carlo: {
            runs: allResults.length,
            shuffled_higher_or_equal: higherOrEqual,
            p_value: parseFloat(mcPValue.toFixed(6)),
            significance,
            shuffled_distribution: {
                mean: parseFloat(mean.toFixed(2)),
                median,
                min,
                max,
                stddev: parseFloat(stddev.toFixed(2)),
                z_score: parseFloat(zScore.toFixed(2))
            }
        },
        search_params: {
            skip_range: { min: minSkip, max: capSkip },
            direction
        },
        elapsed_ms: elapsed,
        threads_used: Math.min(numThreads, runs)
    };
}

// ============================================================================
// COMBINED ANALYSIS — Full statistical workup
// ============================================================================

/**
 * Run the full statistical analysis pipeline and save results.
 *
 * 1. Expected frequency (instant)
 * 2. Poisson p-value (instant)
 * 3. Monte Carlo (takes time, optional)
 *
 * @param {string} streamId - Stream
 * @param {string} term - Term
 * @param {number} observed - Observed hits
 * @param {Object} options - { minSkip, maxSkip, direction, mcRuns, mcMaxSkip, searchId }
 */
async function fullAnalysis(streamId, term, observed, options = {}) {
    const {
        minSkip = 1,
        maxSkip = 3000,
        direction = 'both',
        mcRuns = 100,
        mcMaxSkip = null,    // Defaults to maxSkip if null, but often narrower for speed
        searchId = null,
        runMonteCarlo = true
    } = options;

    const startTime = Date.now();

    // Step 1: Poisson analysis (includes expected frequency)
    const poisson = poissonAnalysis(streamId, term, observed, { minSkip, maxSkip, direction });
    if (poisson.error) return poisson;

    const result = {
        term,
        stream_id: streamId,
        observed,
        expected: poisson.expected,
        ratio: poisson.ratio,
        poisson_p: poisson.poisson_p,
        poisson_significance: poisson.significance,
        letter_probability: poisson.letter_probability,
        skip_range: poisson.skip_range,
        direction
    };

    // Step 2: Monte Carlo (optional, takes time)
    if (runMonteCarlo && mcRuns > 0) {
        const effectiveMcSkip = mcMaxSkip || Math.min(maxSkip, 1000);
        const mc = await monteCarlo(streamId, term, observed, {
            runs: mcRuns,
            minSkip,
            maxSkip: effectiveMcSkip,
            direction
        });

        if (!mc.error) {
            result.monte_carlo_p = mc.monte_carlo.p_value;
            result.monte_carlo_significance = mc.monte_carlo.significance;
            result.monte_carlo_runs = mc.monte_carlo.runs;
            result.shuffled_distribution = mc.monte_carlo.shuffled_distribution;
            result.monte_carlo_elapsed_ms = mc.elapsed_ms;
        }
    }

    result.elapsed_ms = Date.now() - startTime;

    // Save to database if search_id provided
    if (searchId) {
        const saved = saveStatistics(searchId, result);
        result.stat_id = saved.stat_id;
    }

    return result;
}

// ============================================================================
// PERSISTENCE — Save/load statistics
// ============================================================================

function saveStatistics(searchId, stats) {
    const statId = `stat_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();

    database.getDb().run(
        `INSERT INTO els_statistics (stat_id, search_id, expected_frequency, observed_count, ratio, poisson_p, monte_carlo_runs, monte_carlo_p, control_text, computed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            statId,
            searchId,
            stats.expected || null,
            stats.observed || null,
            stats.ratio || null,
            stats.poisson_p || null,
            stats.monte_carlo_runs || null,
            stats.monte_carlo_p || null,
            'shuffled',
            now
        ]
    );

    database.saveToDisk();
    log('INFO', `Statistics saved: ${statId} for search ${searchId}`);
    return { stat_id: statId, saved_at: now };
}

function getStatistics(searchId) {
    return database.queryAll(
        'SELECT * FROM els_statistics WHERE search_id = ? ORDER BY computed_at DESC',
        [searchId]
    );
}

function getStatistic(statId) {
    return database.queryOne('SELECT * FROM els_statistics WHERE stat_id = ?', [statId]);
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
    init,

    // Individual methods
    expectedFrequency,
    poissonPValue,
    poissonAnalysis,
    monteCarlo,

    // Combined
    fullAnalysis,

    // Persistence
    saveStatistics,
    getStatistics,
    getStatistic
};
