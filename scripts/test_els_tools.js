// ============================================================================
// KARP Bible Code — Step 2 Integration Test
// Run: node scripts/test_els_tools.js
// Validates: MCP tool chain — search with auto-save, sessions, history
// ============================================================================

const path = require('path');
const database = require('../server/database');
const elsEngine = require('../server/els_engine');
const elsSessions = require('../server/els_sessions');

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
    console.log('  KARP Bible Code — Step 2: ELS Search MCP Tool Tests');
    console.log('═══════════════════════════════════════════════════════════\n');

    // --- Initialize ---
    console.log('📦 Initializing...');
    await database.configure(DATA_PATH);
    await elsEngine.init(database);
    elsSessions.init(database);
    console.log();

    // ===================================================================
    // TEST 1: Session creation
    // ===================================================================
    console.log('━━━ TEST 1: Session Management ━━━');

    const session = elsSessions.createSession('Test Session', 'Integration test session');
    assert(session.session_id.startsWith('session_'), `Session created: ${session.session_id}`);
    assert(session.name === 'Test Session', 'Session has correct name');

    const retrieved = elsSessions.getSession(session.session_id);
    assert(retrieved !== null, 'Session can be retrieved');
    assert(retrieved.name === 'Test Session', 'Retrieved session has correct name');
    assert(retrieved.search_count === 0, 'New session has 0 searches');

    const sessions = elsSessions.listSessions();
    assert(sessions.length > 0, 'Session list is not empty');

    console.log();

    // ===================================================================
    // TEST 2: ELS search with auto-save
    // ===================================================================
    console.log('━━━ TEST 2: ELS Search with Auto-Save ━━━');

    const searchResult = await elsEngine.search('genesis', 'JESUS', {
        minSkip: 1,
        maxSkip: 1000,
        direction: 'both',
        parallel: true,
        mapVerses: true
    });

    assert(searchResult.hit_count > 0, `JESUS search found ${searchResult.hit_count} hits`);
    assert(searchResult.term === 'JESUS', 'Search result has correct term');
    assert(searchResult.stream_id === 'genesis', 'Search result has correct stream');

    // Auto-save
    const saved = elsSessions.saveSearch(searchResult, session.session_id);
    assert(saved.search_id.startsWith('search_'), `Search auto-saved: ${saved.search_id}`);
    assert(saved.session_id === session.session_id, 'Saved to correct session');
    assert(saved.hit_count === searchResult.hit_count, 'Saved hit count matches');

    // Verify session now has 1 search
    const updatedSession = elsSessions.getSession(session.session_id);
    assert(updatedSession.search_count === 1, `Session now has ${updatedSession.search_count} search(es)`);

    console.log();

    // ===================================================================
    // TEST 3: Second search + history
    // ===================================================================
    console.log('━━━ TEST 3: Multiple Searches + History ━━━');

    const messiahResult = await elsEngine.search('genesis', 'MESSIAH', {
        minSkip: 1, maxSkip: 1000, direction: 'both'
    });
    const messiahSaved = elsSessions.saveSearch(messiahResult, session.session_id);
    assert(messiahSaved.search_id !== saved.search_id, 'Second search has different ID');

    // Session should now have 2 searches
    const session2 = elsSessions.getSession(session.session_id);
    assert(session2.search_count === 2, `Session now has ${session2.search_count} searches`);
    assert(session2.searches.length === 2, 'Searches array has 2 entries');

    // Search history
    const history = elsSessions.searchHistory({ session_id: session.session_id });
    assert(history.length === 2, `History returns ${history.length} searches for session`);

    // Filter by term
    const jesusHistory = elsSessions.searchHistory({ term: 'JESUS' });
    assert(jesusHistory.length >= 1, 'Can filter history by term');

    console.log();

    // ===================================================================
    // TEST 4: Search detail retrieval
    // ===================================================================
    console.log('━━━ TEST 4: Search Detail + Hit Retrieval ━━━');

    const detail = elsSessions.getSearch(saved.search_id);
    assert(detail !== null, 'Can retrieve search by ID');
    assert(detail.term === 'JESUS', 'Search detail has correct term');
    assert(detail.hits.length === searchResult.hit_count, `All ${detail.hits.length} hits were saved`);

    if (detail.hits.length > 0) {
        const hit = detail.hits[0];
        assert(hit.term === 'JESUS', 'Hit has correct term');
        assert(hit.skip_interval > 0, `Hit has skip interval: ${hit.skip_interval}`);
        assert(hit.start_verse !== '', `Hit has start verse: ${hit.start_verse}`);
        assert(Array.isArray(hit.positions), 'Hit positions is an array');
        assert(hit.positions.length === 5, 'JESUS hit has 5 positions');
    }

    console.log();

    // ===================================================================
    // TEST 5: Cross-term hit retrieval
    // ===================================================================
    console.log('━━━ TEST 5: Cross-Term Hit Retrieval ━━━');

    const allJesusHits = elsSessions.getAllHitsForTerm('JESUS', 'genesis');
    assert(allJesusHits.length === searchResult.hit_count, `getAllHitsForTerm returns ${allJesusHits.length} hits`);

    const allMessiahHits = elsSessions.getAllHitsForTerm('MESSIAH', 'genesis');
    assert(allMessiahHits.length === messiahResult.hit_count, `MESSIAH has ${allMessiahHits.length} cached hits`);

    console.log();

    // ===================================================================
    // TEST 6: Unique terms list
    // ===================================================================
    console.log('━━━ TEST 6: Unique Terms Tracking ━━━');

    const terms = elsSessions.getSearchedTerms();
    assert(terms.length >= 2, `${terms.length} unique terms tracked`);

    const jesusEntry = terms.find(t => t.term === 'JESUS');
    assert(jesusEntry !== null, 'JESUS appears in terms list');
    assert(jesusEntry.total_hits > 0, `JESUS has ${jesusEntry.total_hits} total hits`);

    console.log();

    // ===================================================================
    // TEST 7: Default session (auto-create)
    // ===================================================================
    console.log('━━━ TEST 7: Default Session Auto-Create ━━━');

    const davidResult = await elsEngine.search('genesis', 'DAVID', {
        minSkip: 1, maxSkip: 500, direction: 'forward'
    });
    const davidSaved = elsSessions.saveSearch(davidResult); // No session specified
    assert(davidSaved.session_id !== null, `Auto-assigned to session: ${davidSaved.session_id}`);

    // Should be the __default__ session
    const defaultSession = elsSessions.getSession(davidSaved.session_id);
    assert(defaultSession.name === '__default__', 'Auto-created default session');

    console.log();

    // ===================================================================
    // TEST 8: Session update
    // ===================================================================
    console.log('━━━ TEST 8: Session Update ━━━');

    const updated = elsSessions.updateSession(session.session_id, {
        name: 'Messianic Names Study',
        notes: 'Searching for JESUS and MESSIAH in Genesis'
    });
    assert(updated.name === 'Messianic Names Study', 'Session name updated');
    assert(updated.notes.includes('JESUS'), 'Session notes updated');

    console.log();

    // ===================================================================
    // TEST 9: Research stats
    // ===================================================================
    console.log('━━━ TEST 9: Research Statistics ━━━');

    const stats = elsSessions.getStats();
    assert(stats.total_sessions >= 2, `${stats.total_sessions} total sessions`);
    assert(stats.total_searches >= 3, `${stats.total_searches} total searches`);
    assert(stats.total_hits > 0, `${stats.total_hits} total hits`);
    assert(stats.unique_terms >= 3, `${stats.unique_terms} unique terms`);
    assert(stats.top_terms.length > 0, 'Top terms list populated');

    console.log(`   📊 Research ledger: ${stats.total_sessions} sessions, ${stats.total_searches} searches, ${stats.total_hits} hits, ${stats.unique_terms} terms`);

    console.log();

    // ===================================================================
    // TEST 10: Torah search (larger stream)
    // ===================================================================
    console.log('━━━ TEST 10: Torah Search + Save ━━━');

    const torahResult = await elsEngine.search('torah', 'MESSIAH', {
        minSkip: 1, maxSkip: 3000, direction: 'both', parallel: true
    });
    assert(torahResult.hit_count > 0, `MESSIAH in Torah: ${torahResult.hit_count} hits (${torahResult.elapsed_ms}ms)`);

    const torahSaved = elsSessions.saveSearch(torahResult, session.session_id);
    assert(torahSaved.saved_at !== undefined, 'Torah search saved successfully');

    // Verify first hit has verse mapping
    if (torahResult.hits.length > 0) {
        const hit = torahResult.hits[0];
        assert(hit.start_verse !== '', `First Torah hit: skip ${hit.skip}, ${hit.start_verse}`);

        // Read the verse to confirm context
        const verseData = elsEngine.getVerseAtPosition('torah', hit.positions[0]);
        assert(verseData && verseData.text, `Verse text retrieved: "${verseData.text.substring(0, 50)}..."`);
    }

    console.log();

    // ===================================================================
    // TEST 11: Cleanup — delete test session
    // ===================================================================
    console.log('━━━ TEST 11: Session Deletion ━━━');

    // Create a throwaway session for deletion test
    const throwaway = elsSessions.createSession('DELETE ME', 'test');
    const throwResult = await elsEngine.search('genesis', 'TEST', { minSkip: 1, maxSkip: 100 });
    elsSessions.saveSearch(throwResult, throwaway.session_id);

    const deleted = elsSessions.deleteSession(throwaway.session_id);
    assert(deleted.deleted === true, 'Session deletion reported success');
    assert(deleted.searches_removed >= 1, `${deleted.searches_removed} searches cleaned up`);

    const gone = elsSessions.getSession(throwaway.session_id);
    assert(gone === null, 'Deleted session no longer retrievable');

    console.log();

    // ===================================================================
    // SUMMARY
    // ===================================================================
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
    console.log('═══════════════════════════════════════════════════════════');

    if (failed === 0) {
        console.log('\n  🎉 ALL TESTS PASSED — Step 2 ELS Search MCP Tool is solid!');
        console.log('\n  The MCP server is ready. To wire into Claude Desktop:');
        console.log('  1. Add to claude_desktop_config.json');
        console.log('  2. Point command to: node server/index.js');
        console.log('  3. Restart Claude Desktop');
        console.log('\n  Next: Step 3 — Proximity & clustering on cached data.\n');
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
