// ============================================================================
// KARP Bible Code — Step 5 Integration Test: Statistical Significance
// Run: node scripts/test_stats.js
// Validates: expected frequency, Poisson p-value, Monte Carlo, full analysis
// Requires: Steps 1-4 working
// ============================================================================

const path = require('path');
const database = require('../server/database');
const elsEngine = require('../server/els_engine');
const elsSessions = require('../server/els_sessions');
const elsStats = require('../server/els_stats');

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
    console.log('  KARP Bible Code — Step 5: Statistical Significance');
    console.log('═══════════════════════════════════════════════════════════\n');

    // --- Initialize ---
    console.log('📦 Initializing...');
    await database.configure(DATA_PATH);
    await elsEngine.init(database);
    elsSessions.init(database);
    elsStats.init(database, elsEngine);
    console.log();

    // --- Run a search so we have real observed data ---
    console.log('🔍 Running baseline searches...\n');

    const session = elsSessions.createSession('Step 5 Test — Statistics', 'Stats engine validation');
    const sid = session.session_id;

    // JESUS in genesis — moderate hit count
    process.stderr.write('   JESUS in genesis (skip 1-2000, both)...');
    const jesusResult = await elsEngine.search('genesis', 'JESUS', {
        minSkip: 1, maxSkip: 2000, direction: 'both', parallel: true, mapVerses: true
    });
    const jesusSaved = elsSessions.saveSearch(jesusResult, sid);
    process.stderr.write(` ${jesusResult.hit_count} hits (${jesusResult.elapsed_ms}ms)\n`);

    // MESSIAH in torah — the classic test
    process.stderr.write('   MESSIAH in torah (skip 1-3000, both)...');
    const messiahResult = await elsEngine.search('torah', 'MESSIAH', {
        minSkip: 1, maxSkip: 3000, direction: 'both', parallel: true, mapVerses: true
    });
    const messiahSaved = elsSessions.saveSearch(messiahResult, sid);
    process.stderr.write(` ${messiahResult.hit_count} hits (${messiahResult.elapsed_ms}ms)\n`);

    // ADRIAN in genesis — personal test
    process.stderr.write('   ADRIAN in genesis (skip 1-2000, both)...');
    const adrianResult = await elsEngine.search('genesis', 'ADRIAN', {
        minSkip: 1, maxSkip: 2000, direction: 'both', parallel: true, mapVerses: true
    });
    elsSessions.saveSearch(adrianResult, sid);
    process.stderr.write(` ${adrianResult.hit_count} hits (${adrianResult.elapsed_ms}ms)\n`);

    console.log();

    // ===================================================================
    // TEST 1: Expected Frequency
    // ===================================================================
    console.log('━━━ TEST 1: Expected Frequency ━━━');

    const ef1 = elsStats.expectedFrequency('genesis', 'JESUS', {
        minSkip: 1, maxSkip: 2000, direction: 'both'
    });

    assert(!ef1.error, 'Expected frequency returned without error');
    assert(ef1.term === 'JESUS', 'Correct term');
    assert(ef1.stream_id === 'genesis', 'Correct stream');
    assert(ef1.expected_hits > 0, `Expected hits: ${ef1.expected_hits}`);
    assert(ef1.letter_probability > 0, `Letter probability: ${ef1.letter_probability.toExponential(4)}`);
    assert(ef1.per_letter_probs.length === 5, 'Per-letter breakdown has 5 entries');
    assert(ef1.per_letter_probs[0].letter === 'J', 'First letter is J');
    assert(ef1.per_letter_probs[0].probability > 0, `P(J) = ${ef1.per_letter_probs[0].probability}`);

    console.log(`   📊 Expected: ${ef1.expected_hits} | Observed: ${jesusResult.hit_count} | Ratio: ${(jesusResult.hit_count / ef1.expected_hits).toFixed(2)}x`);

    console.log();

    // ===================================================================
    // TEST 2: Expected Frequency — missing letter
    // ===================================================================
    console.log('━━━ TEST 2: Expected Frequency — Edge Case ━━━');

    // All 26 letters should be present, but test the path
    const efAll = elsStats.expectedFrequency('genesis', 'ABCDEFGHIJ', { minSkip: 1, maxSkip: 100 });
    assert(!efAll.error, 'Multi-letter term works');
    assert(efAll.expected_hits >= 0, `Expected: ${efAll.expected_hits}`);

    console.log();

    // ===================================================================
    // TEST 3: Poisson Analysis — JESUS in Genesis
    // ===================================================================
    console.log('━━━ TEST 3: Poisson Analysis — JESUS in Genesis ━━━');

    const poisson1 = elsStats.poissonAnalysis('genesis', 'JESUS', jesusResult.hit_count, {
        minSkip: 1, maxSkip: 2000, direction: 'both'
    });

    assert(!poisson1.error, 'Poisson analysis returned without error');
    assert(poisson1.observed === jesusResult.hit_count, `Observed: ${poisson1.observed}`);
    assert(typeof poisson1.expected === 'number', `Expected: ${poisson1.expected}`);
    assert(typeof poisson1.ratio === 'number', `Ratio: ${poisson1.ratio}x`);
    assert(typeof poisson1.poisson_p === 'number', `P-value: ${poisson1.poisson_p}`);
    assert(typeof poisson1.significance === 'string', `Significance: ${poisson1.significance}`);

    console.log(`   📊 ${poisson1.observed} observed vs ${poisson1.expected} expected = ${poisson1.ratio}x`);
    console.log(`   📊 Poisson p = ${poisson1.poisson_p} → ${poisson1.significance}`);

    console.log();

    // ===================================================================
    // TEST 4: Poisson Analysis — MESSIAH in Torah
    // ===================================================================
    console.log('━━━ TEST 4: Poisson Analysis — MESSIAH in Torah ━━━');

    const poisson2 = elsStats.poissonAnalysis('torah', 'MESSIAH', messiahResult.hit_count, {
        minSkip: 1, maxSkip: 3000, direction: 'both'
    });

    assert(!poisson2.error, 'Torah Poisson returned without error');
    assert(poisson2.observed === messiahResult.hit_count, `Observed: ${poisson2.observed}`);
    assert(typeof poisson2.ratio === 'number', `Ratio: ${poisson2.ratio}x`);

    console.log(`   📊 MESSIAH in Torah: ${poisson2.observed} observed vs ${poisson2.expected} expected = ${poisson2.ratio}x`);
    console.log(`   📊 Poisson p = ${poisson2.poisson_p} → ${poisson2.significance}`);

    console.log();

    // ===================================================================
    // TEST 5: Poisson P-Value edge cases
    // ===================================================================
    console.log('━━━ TEST 5: Poisson P-Value Edge Cases ━━━');

    // observed = 0 should give p = 1
    const p0 = elsStats.poissonPValue(0, 5);
    assert(p0 === 1, `P(X>=0 | λ=5) = 1 (got ${p0})`);

    // observed = 1, expected = 0 should give p = 0
    const pZeroExp = elsStats.poissonPValue(1, 0);
    assert(pZeroExp === 0, `P(X>=1 | λ=0) = 0 (got ${pZeroExp})`);

    // Very high observed vs low expected should be near 0
    const pExtreme = elsStats.poissonPValue(50, 2);
    assert(pExtreme < 0.001, `P(X>=50 | λ=2) < 0.001 (got ${pExtreme})`);

    // observed ≈ expected should be around 0.5
    const pNormal = elsStats.poissonPValue(10, 10);
    assert(pNormal > 0.3 && pNormal < 0.7, `P(X>=10 | λ=10) ≈ 0.5 (got ${pNormal.toFixed(4)})`);

    console.log();

    // ===================================================================
    // TEST 6: Monte Carlo — JESUS in Genesis (quick run)
    // ===================================================================
    console.log('━━━ TEST 6: Monte Carlo — JESUS in Genesis (30 runs) ━━━');
    console.log('   ⏳ This takes 15-30 seconds...\n');

    const mc1 = await elsStats.monteCarlo('genesis', 'JESUS', jesusResult.hit_count, {
        runs: 30,
        minSkip: 1,
        maxSkip: 500,     // Narrower for speed
        direction: 'both'
    });

    assert(!mc1.error, 'Monte Carlo returned without error');
    assert(mc1.observed_hits === jesusResult.hit_count, `Observed: ${mc1.observed_hits}`);
    assert(mc1.monte_carlo.runs === 30, `Ran ${mc1.monte_carlo.runs} simulations`);
    assert(typeof mc1.monte_carlo.p_value === 'number', `MC p-value: ${mc1.monte_carlo.p_value}`);
    assert(typeof mc1.monte_carlo.shuffled_higher_or_equal === 'number',
        `Shuffled >= observed: ${mc1.monte_carlo.shuffled_higher_or_equal}/${mc1.monte_carlo.runs}`);
    assert(typeof mc1.monte_carlo.shuffled_distribution === 'object', 'Has distribution stats');
    assert(typeof mc1.monte_carlo.shuffled_distribution.mean === 'number',
        `Shuffled mean: ${mc1.monte_carlo.shuffled_distribution.mean}`);
    assert(typeof mc1.monte_carlo.shuffled_distribution.stddev === 'number',
        `Shuffled stddev: ${mc1.monte_carlo.shuffled_distribution.stddev}`);
    assert(typeof mc1.monte_carlo.shuffled_distribution.z_score === 'number',
        `Z-score: ${mc1.monte_carlo.shuffled_distribution.z_score}`);
    assert(mc1.elapsed_ms > 0, `Elapsed: ${mc1.elapsed_ms}ms`);
    assert(mc1.threads_used > 0, `Threads: ${mc1.threads_used}`);

    console.log(`\n   📊 Real Bible: ${mc1.observed_hits} hits`);
    console.log(`   📊 Shuffled mean: ${mc1.monte_carlo.shuffled_distribution.mean} (σ=${mc1.monte_carlo.shuffled_distribution.stddev})`);
    console.log(`   📊 Shuffled range: ${mc1.monte_carlo.shuffled_distribution.min} — ${mc1.monte_carlo.shuffled_distribution.max}`);
    console.log(`   📊 Z-score: ${mc1.monte_carlo.shuffled_distribution.z_score}`);
    console.log(`   📊 MC p-value: ${mc1.monte_carlo.p_value} → ${mc1.monte_carlo.significance}`);

    console.log();

    // ===================================================================
    // TEST 7: Monte Carlo — ADRIAN in Genesis (quick run)
    // ===================================================================
    console.log('━━━ TEST 7: Monte Carlo — ADRIAN in Genesis (20 runs) ━━━');
    console.log('   ⏳ Quick run...\n');

    const mc2 = await elsStats.monteCarlo('genesis', 'ADRIAN', adrianResult.hit_count, {
        runs: 20,
        minSkip: 1,
        maxSkip: 500,
        direction: 'both'
    });

    assert(!mc2.error, 'ADRIAN Monte Carlo returned without error');
    assert(mc2.monte_carlo.runs === 20, `Ran ${mc2.monte_carlo.runs} simulations`);

    console.log(`   📊 ADRIAN: ${mc2.observed_hits} real vs ${mc2.monte_carlo.shuffled_distribution.mean} shuffled mean`);
    console.log(`   📊 MC p-value: ${mc2.monte_carlo.p_value} → ${mc2.monte_carlo.significance}`);

    console.log();

    // ===================================================================
    // TEST 8: Full Analysis pipeline
    // ===================================================================
    console.log('━━━ TEST 8: Full Analysis — MESSIAH in Torah (20 MC runs) ━━━');
    console.log('   ⏳ Poisson (instant) + Monte Carlo (~30s)...\n');

    const full1 = await elsStats.fullAnalysis('torah', 'MESSIAH', messiahResult.hit_count, {
        minSkip: 1,
        maxSkip: 3000,
        direction: 'both',
        mcRuns: 20,
        mcMaxSkip: 500,     // Narrower MC for speed
        searchId: messiahSaved.search_id,
        runMonteCarlo: true
    });

    assert(!full1.error, 'Full analysis returned without error');
    assert(full1.observed === messiahResult.hit_count, `Observed: ${full1.observed}`);
    assert(typeof full1.expected === 'number', `Expected: ${full1.expected}`);
    assert(typeof full1.ratio === 'number', `Ratio: ${full1.ratio}x`);
    assert(typeof full1.poisson_p === 'number', `Poisson p: ${full1.poisson_p}`);
    assert(typeof full1.poisson_significance === 'string', `Poisson: ${full1.poisson_significance}`);
    assert(typeof full1.monte_carlo_p === 'number', `MC p: ${full1.monte_carlo_p}`);
    assert(typeof full1.monte_carlo_significance === 'string', `MC: ${full1.monte_carlo_significance}`);
    assert(typeof full1.monte_carlo_runs === 'number', `MC runs: ${full1.monte_carlo_runs}`);
    assert(typeof full1.shuffled_distribution === 'object', 'Has shuffled distribution');
    assert(full1.stat_id && full1.stat_id.startsWith('stat_'), `Saved to DB: ${full1.stat_id}`);

    console.log(`\n   📊 MESSIAH in Torah — Full Statistical Workup:`);
    console.log(`      Observed: ${full1.observed} | Expected: ${full1.expected} | Ratio: ${full1.ratio}x`);
    console.log(`      Poisson p = ${full1.poisson_p} → ${full1.poisson_significance}`);
    console.log(`      Monte Carlo p = ${full1.monte_carlo_p} → ${full1.monte_carlo_significance}`);
    console.log(`      Shuffled mean: ${full1.shuffled_distribution.mean} | Z-score: ${full1.shuffled_distribution.z_score}`);

    console.log();

    // ===================================================================
    // TEST 9: Statistics persistence
    // ===================================================================
    console.log('━━━ TEST 9: Statistics Persistence ━━━');

    const savedStats = elsStats.getStatistics(messiahSaved.search_id);
    assert(savedStats.length > 0, `Found ${savedStats.length} saved stat record(s)`);

    if (savedStats.length > 0) {
        const stat = savedStats[0];
        assert(stat.stat_id === full1.stat_id, 'Stat ID matches');
        assert(stat.observed_count === messiahResult.hit_count, 'Observed count saved correctly');
        assert(stat.monte_carlo_runs > 0, `MC runs saved: ${stat.monte_carlo_runs}`);
        assert(stat.computed_at !== null, `Computed at: ${stat.computed_at}`);
    }

    const singleStat = elsStats.getStatistic(full1.stat_id);
    assert(singleStat !== null, 'Can retrieve stat by ID');

    console.log();

    // ===================================================================
    // TEST 10: Full analysis without Monte Carlo (Poisson only)
    // ===================================================================
    console.log('━━━ TEST 10: Full Analysis — Poisson Only (no MC) ━━━');

    const poissonOnly = await elsStats.fullAnalysis('genesis', 'ADRIAN', adrianResult.hit_count, {
        minSkip: 1,
        maxSkip: 2000,
        direction: 'both',
        runMonteCarlo: false
    });

    assert(!poissonOnly.error, 'Poisson-only returned without error');
    assert(poissonOnly.poisson_p !== undefined, 'Has Poisson p');
    assert(poissonOnly.monte_carlo_p === undefined, 'No MC p (as expected)');
    assert(poissonOnly.elapsed_ms < 100, `Fast: ${poissonOnly.elapsed_ms}ms`);

    console.log(`   📊 ADRIAN Poisson-only: ${poissonOnly.ratio}x, p=${poissonOnly.poisson_p}`);

    console.log();

    // ===================================================================
    // CLEANUP
    // ===================================================================
    console.log('━━━ Cleanup ━━━');
    console.log(`   ℹ️  Test session preserved: ${sid}`);

    console.log();

    // ===================================================================
    // SUMMARY
    // ===================================================================
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
    console.log('═══════════════════════════════════════════════════════════');

    if (failed === 0) {
        console.log('\n  🎉 ALL TESTS PASSED — Step 5 Statistical Significance is solid!');
        console.log('\n  MCP Tool ready:');
        console.log('    • els_stats  — expected frequency, Poisson, Monte Carlo');
        console.log('\n  Full toolchain complete (Steps 1-5):');
        console.log('    1. els_search     — find hidden patterns');
        console.log('    2. els_session    — group related research');
        console.log('    3. els_history    — browse past searches');
        console.log('    4. els_proximity  — pairwise distance analysis');
        console.log('    5. els_cluster    — multi-term convergence');
        console.log('    6. els_sweep      — history cross-reference');
        console.log('    7. els_stats      — statistical significance');
        console.log('    8. els_streams    — stream management');
        console.log('    + read_scripture, search_scripture, study_passage');
        console.log('    + remember, recall, connect (knowledge graph)');
        console.log('\n  Next: Step 6 — Web UI Matrix Tab.\n');
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
