// ============================================================================
// KARP Bible Code — Test Letter Stream Builder (Step 1 Verification)
// Run: node scripts/test_streams.js
// Validates: stream builds, verse boundaries, binary search mapping, ELS search
// ============================================================================

const path = require('path');
const database = require('../server/database');
const elsEngine = require('../server/els_engine');

const DATA_PATH = path.join(require('os').homedir(), '.karp-bible-code');

let passed = 0;
let failed = 0;

function assert(condition, testName) {
    if (condition) {
        console.log(`   ✅ ${testName}`);
        passed++;
    } else {
        console.log(`   ❌ FAIL: ${testName}`);
        failed++;
    }
}

async function main() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  KARP Bible Code — Step 1: Letter Stream Builder Tests');
    console.log('═══════════════════════════════════════════════════════════\n');

    // --- Initialize ---
    console.log('📦 Initializing database...');
    await database.configure(DATA_PATH);

    console.log('🔧 Initializing ELS engine...\n');
    await elsEngine.init(database);

    // ===================================================================
    // TEST 1: Core streams built
    // ===================================================================
    console.log('━━━ TEST 1: Core Stream Builds ━━━');

    const genesis = elsEngine.getStream('genesis');
    assert(genesis !== null, 'Genesis stream loaded');
    assert(genesis.totalLetters > 0, `Genesis has letters (${genesis.totalLetters.toLocaleString()})`);
    assert(genesis.totalLetters === 151843 || genesis.totalLetters > 140000, `Genesis ~151,843 letters (got ${genesis.totalLetters.toLocaleString()})`);
    assert(genesis.totalVerses > 0, `Genesis has verses (${genesis.totalVerses})`);
    assert(genesis.verseBoundaries.length === genesis.totalVerses, 'Verse boundary count matches verse count');

    const torah = elsEngine.getStream('torah');
    assert(torah !== null, 'Torah stream loaded');
    assert(torah.totalLetters === 634378 || torah.totalLetters > 600000, `Torah ~634,378 letters (got ${torah.totalLetters.toLocaleString()})`);

    const full = elsEngine.getStream('full');
    assert(full !== null, 'Full Bible stream loaded');
    assert(full.totalLetters === 3222423 || full.totalLetters > 3000000, `Full Bible ~3,222,423 letters (got ${full.totalLetters.toLocaleString()})`);
    assert(full.totalLetters > torah.totalLetters, 'Full Bible > Torah');
    assert(torah.totalLetters > genesis.totalLetters, 'Torah > Genesis');

    console.log();

    // ===================================================================
    // TEST 2: Verse boundary integrity
    // ===================================================================
    console.log('━━━ TEST 2: Verse Boundary Integrity ━━━');

    const genBounds = genesis.verseBoundaries;

    // First verse should start at position 0
    assert(genBounds[0].cumLen === genBounds[0].letterCount, 'First boundary cumLen = first verse letter count');
    assert(genBounds[0].book === 'GEN', 'First boundary is Genesis');
    assert(genBounds[0].chapter === 1, 'First boundary is chapter 1');
    assert(genBounds[0].verse === 1, 'First boundary is verse 1');

    // Boundaries should be monotonically increasing
    let monotonic = true;
    for (let i = 1; i < genBounds.length; i++) {
        if (genBounds[i].cumLen <= genBounds[i - 1].cumLen) {
            monotonic = false;
            break;
        }
    }
    assert(monotonic, 'Verse boundaries are monotonically increasing');

    // Last boundary cumLen should equal total letters
    assert(genBounds[genBounds.length - 1].cumLen === genesis.totalLetters, 'Last boundary cumLen = total letters');

    // Sum of all letterCounts should equal totalLetters
    const sumLetters = genBounds.reduce((sum, b) => sum + b.letterCount, 0);
    assert(sumLetters === genesis.totalLetters, `Sum of verse letter counts = total (${sumLetters.toLocaleString()} vs ${genesis.totalLetters.toLocaleString()})`);

    console.log();

    // ===================================================================
    // TEST 3: Position-to-verse binary search
    // ===================================================================
    console.log('━━━ TEST 3: Position → Verse Mapping ━━━');

    // Position 0 should be GEN 1:1
    const pos0 = elsEngine.positionToVerse('genesis', 0);
    assert(pos0 !== null, 'Position 0 maps to a verse');
    assert(pos0.book === 'GEN' && pos0.chapter === 1 && pos0.verse === 1, `Position 0 → GEN 1:1 (got ${pos0.reference})`);
    assert(pos0.charInVerse === 0, 'Position 0 is first character of GEN 1:1');

    // Last position should be in the last verse of Genesis (GEN 50:26)
    const lastPos = elsEngine.positionToVerse('genesis', genesis.totalLetters - 1);
    assert(lastPos !== null, 'Last position maps to a verse');
    assert(lastPos.book === 'GEN' && lastPos.chapter === 50, `Last position → GEN 50:xx (got ${lastPos.reference})`);

    // Position right at a boundary — second verse start
    const verse2Start = genBounds[0].cumLen;  // first letter of verse 2
    const pos2 = elsEngine.positionToVerse('genesis', verse2Start);
    assert(pos2 !== null, 'Verse 2 start position maps');
    assert(pos2.book === 'GEN' && pos2.chapter === 1 && pos2.verse === 2, `Verse 2 start → GEN 1:2 (got ${pos2.reference})`);
    assert(pos2.charInVerse === 0, 'Verse 2 start is charInVerse 0');

    // Position just before verse 2 — should still be in verse 1
    const preV2 = elsEngine.positionToVerse('genesis', verse2Start - 1);
    assert(preV2 !== null, 'Position before verse 2 maps');
    assert(preV2.verse === 1, `Pre-verse-2 position → verse 1 (got verse ${preV2.verse})`);

    // Out of bounds
    const oob = elsEngine.positionToVerse('genesis', genesis.totalLetters);
    assert(oob === null, 'Out-of-bounds position returns null');

    const neg = elsEngine.positionToVerse('genesis', -1);
    assert(neg === null, 'Negative position returns null');

    // Batch mapping
    const batchPositions = [0, 100, 1000, 10000, genesis.totalLetters - 1];
    const batchResults = elsEngine.positionsToVerses('genesis', batchPositions);
    assert(batchResults.length === batchPositions.length, `Batch mapping returns ${batchPositions.length} results`);
    assert(batchResults[0].reference === pos0.reference, 'Batch result[0] matches single lookup');
    assert(batchResults[batchResults.length - 1].reference === lastPos.reference, 'Batch result[last] matches single lookup');

    console.log();

    // ===================================================================
    // TEST 4: Cross-validation with proof of concept mapper
    // ===================================================================
    console.log('━━━ TEST 4: Cross-Validation (Spot Checks) ━━━');

    // Map a known position: verify the letter at the position matches the stream
    for (let testPos of [0, 50, 500, 5000, 50000, 100000]) {
        if (testPos >= genesis.totalLetters) continue;
        const mapped = elsEngine.positionToVerse('genesis', testPos);
        const streamLetter = genesis.stream[testPos];
        assert(mapped.letter === streamLetter, `Position ${testPos}: mapped letter '${mapped.letter}' matches stream '${streamLetter}' (${mapped.reference})`);
    }

    // Verse at position — check we can get the text
    const verseWithText = elsEngine.getVerseAtPosition('genesis', 0);
    assert(verseWithText !== null, 'getVerseAtPosition returns result');
    assert(verseWithText.text && verseWithText.text.includes('beginning'), `GEN 1:1 text contains "beginning" (got: "${verseWithText.text.substring(0, 60)}...")`);

    console.log();

    // ===================================================================
    // TEST 5: Letter frequency
    // ===================================================================
    console.log('━━━ TEST 5: Letter Frequency Analysis ━━━');

    const freq = elsEngine.getLetterFrequency('genesis');
    assert(freq !== null, 'Frequency analysis returns result');
    assert(freq.unique_letters === 26, `All 26 letters present (got ${freq.unique_letters})`);

    // Sum of all frequencies should equal total letters
    const freqSum = freq.frequencies.reduce((sum, f) => sum + f.count, 0);
    assert(freqSum === genesis.totalLetters, `Frequency sum = total letters (${freqSum.toLocaleString()})`);

    // Most common letters in English text should be near the top (E, T, A, O, etc.)
    const topLetters = freq.frequencies.slice(0, 5).map(f => f.letter);
    console.log(`   📊 Top 5 letters in Genesis: ${topLetters.join(', ')}`);

    console.log();

    // ===================================================================
    // TEST 6: ELS Search (Sync — quick validation)
    // ===================================================================
    console.log('━━━ TEST 6: ELS Search (Sync Mode) ━━━');

    const startTime = Date.now();
    const jesusHits = elsEngine.elsSearchSync('genesis', 'JESUS', { minSkip: 1, maxSkip: 500, direction: 'forward' });
    const syncElapsed = Date.now() - startTime;

    assert(jesusHits.length > 0, `JESUS in Genesis (skip 1-500, fwd): ${jesusHits.length} hits (${syncElapsed}ms)`);

    if (jesusHits.length > 0) {
        const firstHit = jesusHits[0];
        assert(firstHit.term === 'JESUS', 'Hit has correct term');
        assert(firstHit.positions.length === 5, 'JESUS has 5 letter positions');
        assert(firstHit.direction === 'forward', 'Hit has direction');
        assert(typeof firstHit.skip === 'number', 'Hit has skip interval');
    }

    console.log();

    // ===================================================================
    // TEST 7: ELS Search with Verse Mapping (Full Pipeline)
    // ===================================================================
    console.log('━━━ TEST 7: Full Search Pipeline (search + verse mapping) ━━━');

    const searchResult = await elsEngine.search('genesis', 'MESSIAH', {
        minSkip: 1,
        maxSkip: 1000,
        direction: 'both',
        parallel: false  // sync for testing speed
    });

    assert(searchResult.hit_count >= 0, `MESSIAH search completed: ${searchResult.hit_count} hits (${searchResult.elapsed_ms}ms)`);
    assert(searchResult.stream_id === 'genesis', 'Result has correct stream_id');
    assert(searchResult.term === 'MESSIAH', 'Result has correct term');

    if (searchResult.hits.length > 0) {
        const hit = searchResult.hits[0];
        assert(hit.start_verse !== '', `First hit has start verse mapping: ${hit.start_verse}`);
        assert(hit.mid_verse !== '', `First hit has mid verse mapping: ${hit.mid_verse}`);
        assert(hit.end_verse !== '', `First hit has end verse mapping: ${hit.end_verse}`);
        console.log(`   📍 First MESSIAH hit: skip ${hit.skip}, ${hit.start_verse} → ${hit.end_verse}`);
    }

    console.log();

    // ===================================================================
    // TEST 8: On-demand book stream
    // ===================================================================
    console.log('━━━ TEST 8: On-Demand Book Stream ━━━');

    const exodusStream = elsEngine.getStream('exo');
    assert(exodusStream !== null, 'Exodus stream built on demand');
    assert(exodusStream.totalLetters > 0, `Exodus has ${exodusStream.totalLetters.toLocaleString()} letters`);
    assert(exodusStream.verseBoundaries[0].book === 'EXO', 'Exodus stream starts with EXO');

    console.log();

    // ===================================================================
    // TEST 9: Stream listing
    // ===================================================================
    console.log('━━━ TEST 9: Stream Listing ━━━');

    const streams = elsEngine.listStreams();
    assert(streams.built.length >= 3, `At least 3 streams built (got ${streams.built.length})`);
    assert(streams.available.length > 60, `Available streams include all books (got ${streams.available.length})`);

    console.log(`   📋 Built streams: ${streams.built.map(s => s.stream_id).join(', ')}`);

    console.log();

    // ===================================================================
    // TEST 10: Parallel search comparison
    // ===================================================================
    console.log('━━━ TEST 10: Parallel vs Sync Comparison ━━━');

    const syncStart = Date.now();
    const syncHits = elsEngine.elsSearchSync('genesis', 'DAVID', { minSkip: 1, maxSkip: 1000, direction: 'forward' });
    const syncTime = Date.now() - syncStart;

    const parallelStart = Date.now();
    const parallelHits = await elsEngine.elsSearchParallel('genesis', 'DAVID', { minSkip: 1, maxSkip: 1000, direction: 'forward' });
    const parallelTime = Date.now() - parallelStart;

    assert(syncHits.length === parallelHits.length, `Sync (${syncHits.length}) and parallel (${parallelHits.length}) find same hit count`);
    console.log(`   ⏱️  Sync: ${syncTime}ms | Parallel: ${parallelTime}ms | Speedup: ${(syncTime / Math.max(parallelTime, 1)).toFixed(1)}x`);

    console.log();

    // ===================================================================
    // SUMMARY
    // ===================================================================
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
    console.log('═══════════════════════════════════════════════════════════');

    if (failed === 0) {
        console.log('\n  🎉 ALL TESTS PASSED — Step 1 Letter Stream Builder is solid!\n');
        console.log('  Next: Step 2 — Wire els_search as an MCP tool with auto-save.\n');
    } else {
        console.log(`\n  ⚠️  ${failed} test(s) need attention.\n`);
    }

    console.log('═══════════════════════════════════════════════════════════\n');
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
