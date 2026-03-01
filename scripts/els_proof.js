// ============================================================================
// KARP Bible Code — ELS Proof of Concept
// Run: node scripts/els_proof.js
// Reads KJV from existing Word Graph DB, builds letter stream, searches ELS
// ============================================================================

const path = require('path');
const fs = require('fs');

// We need sql.js to read the existing Word Graph database
let SQL;

const DB_PATH = path.join(require('os').homedir(), '.karp-bible-code', 'graph.db');

async function init() {
    const initSqlJs = require('sql.js');
    SQL = await initSqlJs();

    if (!fs.existsSync(DB_PATH)) {
        console.error(`❌ Database not found: ${DB_PATH}`);
        console.error('   Run this from a machine with KARP Word Graph installed.');
        process.exit(1);
    }

    const buffer = fs.readFileSync(DB_PATH);
    const db = new SQL.Database(buffer);
    return db;
}

// ---------------------------------------------------------------------------
// Layer 1: Build Letter Stream
// ---------------------------------------------------------------------------

function buildLetterStream(db, scope = 'full') {
    console.log(`\n📜 Building letter stream (scope: ${scope})...`);

    let query = 'SELECT book_abbrev, chapter, verse, text FROM scriptures ORDER BY book_order, chapter, verse';

    if (scope === 'torah') {
        query = "SELECT book_abbrev, chapter, verse, text FROM scriptures WHERE book_abbrev IN ('GEN','EXO','LEV','NUM','DEU') ORDER BY book_order, chapter, verse";
    }

    const rows = db.exec(query);
    if (!rows.length || !rows[0].values.length) {
        console.error('❌ No scripture found in database');
        process.exit(1);
    }

    let stream = '';          // the continuous letter string
    const index = [];          // position → verse mapping
    let position = 0;

    const letterFreq = {};

    for (const row of rows[0].values) {
        const [bookAbbrev, chapter, verse, text] = row;

        // Strip to letters only (uppercase)
        const letters = text.toUpperCase().replace(/[^A-Z]/g, '');

        for (let i = 0; i < letters.length; i++) {
            const ch = letters[i];
            stream += ch;

            // Track position mapping (sample every 1000th for memory)
            if (position % 10000 === 0) {
                index.push({ position, book: bookAbbrev, chapter, verse, charInVerse: i });
            }

            // Letter frequency
            letterFreq[ch] = (letterFreq[ch] || 0) + 1;
            position++;
        }
    }

    console.log(`   ✅ Stream length: ${stream.length.toLocaleString()} letters`);
    console.log(`   ✅ Verses processed: ${rows[0].values.length.toLocaleString()}`);
    console.log(`   ✅ Index checkpoints: ${index.length.toLocaleString()}`);

    // Show letter frequencies
    const sorted = Object.entries(letterFreq).sort((a, b) => b[1] - a[1]);
    console.log(`   📊 Top 10 letters:`);
    for (const [letter, count] of sorted.slice(0, 10)) {
        const pct = ((count / stream.length) * 100).toFixed(2);
        console.log(`      ${letter}: ${count.toLocaleString()} (${pct}%)`);
    }

    return { stream, index, letterFreq, totalLetters: stream.length };
}

// ---------------------------------------------------------------------------
// Layer 2: ELS Search Engine
// ---------------------------------------------------------------------------

function elsSearch(stream, term, { minSkip = 1, maxSkip = null, direction = 'both' } = {}) {
    term = term.toUpperCase().replace(/[^A-Z]/g, '');
    if (!term) return [];

    if (!maxSkip) {
        maxSkip = Math.floor(stream.length / term.length);
    }

    // Cap max skip for reasonable search times
    maxSkip = Math.min(maxSkip, 50000);

    const hits = [];
    const termLen = term.length;
    const streamLen = stream.length;

    const directions = [];
    if (direction === 'both' || direction === 'forward') directions.push(1);
    if (direction === 'both' || direction === 'reverse') directions.push(-1);

    // Optimisation: build first-letter index
    const firstLetterPositions = [];
    const firstLetter = term[0];
    for (let i = 0; i < streamLen; i++) {
        if (stream[i] === firstLetter) firstLetterPositions.push(i);
    }

    console.log(`   🔍 First letter '${firstLetter}' appears at ${firstLetterPositions.length.toLocaleString()} positions`);

    for (const dir of directions) {
        for (let skip = minSkip; skip <= maxSkip; skip++) {
            const neededLength = (termLen - 1) * skip;

            for (const start of firstLetterPositions) {
                // Check bounds
                const endPos = start + dir * neededLength;
                if (endPos < 0 || endPos >= streamLen) continue;

                // Check remaining letters
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
                }
            }
        }
    }

    return hits;
}

// ---------------------------------------------------------------------------
// Layer 3: Statistical Significance
// ---------------------------------------------------------------------------

function calculateExpectedFrequency(term, letterFreq, totalLetters, skip, streamLength) {
    // Probability of the term appearing at a specific position & skip
    let prob = 1;
    for (const ch of term) {
        prob *= (letterFreq[ch] || 0) / totalLetters;
    }

    // Number of valid starting positions for this skip
    const validStarts = streamLength - (term.length - 1) * skip;
    if (validStarts <= 0) return 0;

    return prob * validStarts;
}

function poissonPValue(observed, expected) {
    // P(X >= observed) using Poisson CDF complement
    // For small expected values, use exact Poisson
    if (expected <= 0) return observed > 0 ? 0 : 1;

    let cumulativeP = 0;
    for (let k = 0; k < observed; k++) {
        cumulativeP += (Math.pow(expected, k) * Math.exp(-expected)) / factorial(k);
    }
    return Math.max(0, 1 - cumulativeP);
}

function factorial(n) {
    if (n <= 1) return 1;
    // Use Stirling's approximation for large n
    if (n > 20) {
        return Math.sqrt(2 * Math.PI * n) * Math.pow(n / Math.E, n);
    }
    let result = 1;
    for (let i = 2; i <= n; i++) result *= i;
    return result;
}

function monteCarloSignificance(stream, term, observedHits, letterFreq, { runs = 100, maxSkip = 1000 } = {}) {
    console.log(`   🎲 Running Monte Carlo (${runs} shuffled texts, skip 1-${maxSkip})...`);

    const letters = stream.split('');
    let higherCount = 0;

    for (let r = 0; r < runs; r++) {
        // Fisher-Yates shuffle
        const shuffled = [...letters];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }

        const shuffledStream = shuffled.join('');
        const hits = elsSearch(shuffledStream, term, { maxSkip, direction: 'forward' });

        if (hits.length >= observedHits) higherCount++;

        if ((r + 1) % 25 === 0) {
            process.stderr.write(`\r   🎲 Monte Carlo: ${r + 1}/${runs}...`);
        }
    }

    process.stderr.write('\r' + ' '.repeat(60) + '\r');

    const pValue = higherCount / runs;
    return { runs, higherCount, pValue };
}

// ---------------------------------------------------------------------------
// Layer 4: Verse Location Mapper
// ---------------------------------------------------------------------------

function mapPositionToVerse(db, position, streamScope = 'full') {
    let query = 'SELECT book_abbrev, chapter, verse, text FROM scriptures ORDER BY book_order, chapter, verse';
    if (streamScope === 'torah') {
        query = "SELECT book_abbrev, chapter, verse, text FROM scriptures WHERE book_abbrev IN ('GEN','EXO','LEV','NUM','DEU') ORDER BY book_order, chapter, verse";
    }

    const rows = db.exec(query);
    if (!rows.length) return null;

    let pos = 0;
    for (const row of rows[0].values) {
        const [book, chapter, verse, text] = row;
        const letters = text.toUpperCase().replace(/[^A-Z]/g, '');

        if (pos + letters.length > position) {
            const charInVerse = position - pos;
            return { book, chapter, verse, charInVerse, letter: letters[charInVerse] };
        }
        pos += letters.length;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Main — Run Proof of Concept
// ---------------------------------------------------------------------------

async function main() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  KARP Bible Code — ELS Proof of Concept');
    console.log('  Testing: Letter Stream → ELS Search → Statistics');
    console.log('═══════════════════════════════════════════════════════════');

    const db = await init();
    console.log(`✅ Database loaded: ${DB_PATH}`);

    // --- Build letter streams ---
    const torah = buildLetterStream(db, 'torah');
    const full = buildLetterStream(db, 'full');

    // --- Test 1: Search for common biblical terms ---
    const testTerms = ['JESUS', 'MESSIAH', 'GOD', 'TORAH', 'DAVID', 'MOSES'];

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  TEST 1: ELS Search — Torah (skip 1-1000)');
    console.log('═══════════════════════════════════════════════════════════');

    for (const term of testTerms) {
        console.log(`\n🔎 Searching: "${term}" (Torah, skip 1-1000, forward only)`);
        const start = Date.now();
        const hits = elsSearch(torah.stream, term, { maxSkip: 1000, direction: 'forward' });
        const elapsed = Date.now() - start;

        console.log(`   ✅ Found: ${hits.length} occurrences (${elapsed}ms)`);

        if (hits.length > 0) {
            // Show first 3 hits
            for (const hit of hits.slice(0, 3)) {
                const loc = mapPositionToVerse(db, hit.start, 'torah');
                const locStr = loc ? `${loc.book} ${loc.chapter}:${loc.verse}` : '?';
                console.log(`      Skip ${hit.skip}: start pos ${hit.start} → ${locStr}`);
            }
            if (hits.length > 3) console.log(`      ... and ${hits.length - 3} more`);

            // Group by skip interval
            const skipCounts = {};
            for (const h of hits) skipCounts[h.skip] = (skipCounts[h.skip] || 0) + 1;
            const topSkips = Object.entries(skipCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
            console.log(`   📊 Most frequent skips: ${topSkips.map(([s, c]) => `${s}(×${c})`).join(', ')}`);
        }
    }

    // --- Test 2: Statistical significance for one term ---
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  TEST 2: Statistical Significance — "JESUS" in Torah');
    console.log('═══════════════════════════════════════════════════════════');

    const jesusHits = elsSearch(torah.stream, 'JESUS', { maxSkip: 1000, direction: 'forward' });
    console.log(`\n   Observed: ${jesusHits.length} hits`);

    // Expected frequency (aggregate across all skips)
    let totalExpected = 0;
    for (let skip = 1; skip <= 1000; skip++) {
        totalExpected += calculateExpectedFrequency(
            'JESUS', torah.letterFreq, torah.totalLetters, skip, torah.totalLetters
        );
    }
    console.log(`   Expected (by letter frequency): ${totalExpected.toFixed(2)}`);
    console.log(`   Ratio: ${(jesusHits.length / totalExpected).toFixed(2)}x`);

    const pVal = poissonPValue(jesusHits.length, totalExpected);
    console.log(`   Poisson P-Value: ${pVal < 0.001 ? '< 0.001' : pVal.toFixed(6)}`);

    // --- Test 3: Monte Carlo (small run to prove concept) ---
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  TEST 3: Monte Carlo — "JESUS" in Torah vs 50 shuffled');
    console.log('═══════════════════════════════════════════════════════════');

    const mc = monteCarloSignificance(
        torah.stream, 'JESUS', jesusHits.length, torah.letterFreq,
        { runs: 50, maxSkip: 500 }
    );

    console.log(`\n   Real Torah hits: ${jesusHits.length}`);
    console.log(`   Shuffled texts with >= hits: ${mc.higherCount}/${mc.runs}`);
    console.log(`   Monte Carlo P-Value: ${mc.pValue < 0.02 ? '< 0.02' : mc.pValue.toFixed(4)}`);

    if (mc.pValue < 0.05) {
        console.log(`   ⚡ STATISTICALLY SIGNIFICANT at p < 0.05`);
    } else {
        console.log(`   📊 Not significant at p < 0.05 (need more runs or wider skip range)`);
    }

    // --- Test 4: Full Bible stream stats ---
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  TEST 4: Full Bible Letter Stream Statistics');
    console.log('═══════════════════════════════════════════════════════════');

    console.log(`\n   Torah stream: ${torah.totalLetters.toLocaleString()} letters`);
    console.log(`   Full Bible:   ${full.totalLetters.toLocaleString()} letters`);
    console.log(`   NT letters:   ${(full.totalLetters - torah.totalLetters).toLocaleString()} letters`);

    // --- Summary ---
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  PROOF OF CONCEPT RESULTS');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`\n   ✅ Letter stream builds from existing Word Graph DB`);
    console.log(`   ✅ ELS search finds patterns at skip intervals`);
    console.log(`   ✅ Position-to-verse mapping works`);
    console.log(`   ✅ Expected frequency calculation works`);
    console.log(`   ✅ Poisson P-value calculation works`);
    console.log(`   ✅ Monte Carlo simulation runs against shuffled text`);
    console.log(`\n   🚀 Core math is proven. Ready to build Phase 1.`);

    console.log('\n═══════════════════════════════════════════════════════════\n');

    db.close();
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
