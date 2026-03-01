// ============================================================================
// KARP Bible Code — Clean DB for Distribution
// Version: 0.1.0
// Author: SoulDriver (Adelaide, Australia)
// Usage: node scripts/clean_for_dist.js
//
// Creates a CLEAN copy of graph.db with only:
//   ✓ KJV Bible text (31,102 verses)
//   ✓ Scripture embeddings (15,857 vectors)
//   ✓ Book metadata (66 books)
//   ✓ Base type definitions
//   ✓ Empty schema tables (ready for user data)
//
// Strips:
//   ✗ Personal study notes, prayers, insights
//   ✗ Knowledge graph edges
//   ✗ Personal node embeddings
//   ✗ ELS sessions, searches, hits, statistics, clusters
//   ✗ Pre-built letter streams (auto-rebuild on first boot)
//   ✗ Auth data (passwords)
//   ✗ Pending proposals
//
// Output: dist/graph-clean.db
// Then run: DB_PATH=dist/graph-clean.db npm run build
// ============================================================================

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const ROOT = path.join(__dirname, '..');
const HOME = require('os').homedir();

// Source DB: prefer new path, fall back to old shared path (pre-separation)
const NEW_DB = path.join(HOME, '.karp-bible-code', 'graph.db');
const OLD_DB = path.join(HOME, '.karp-word-graph', 'graph.db');
const SOURCE_DB = fs.existsSync(NEW_DB) ? NEW_DB : OLD_DB;

const OUTPUT_DIR = path.join(ROOT, 'dist');
const OUTPUT_DB = path.join(OUTPUT_DIR, 'graph-clean.db');

async function main() {
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║  KARP Bible Code — Clean DB for Distribution         ║');
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log('');

    // Check source exists
    if (!fs.existsSync(SOURCE_DB)) {
        console.error(`✗ Source database not found: ${SOURCE_DB}`);
        console.error('  Make sure KARP Bible Code has been run at least once.');
        process.exit(1);
    }

    if (SOURCE_DB === OLD_DB) {
        console.log('⚠️  Using legacy shared DB (pre-separation): .karp-word-graph');
        console.log('   Future runs will use: .karp-bible-code');
    }
    const sourceSize = (fs.statSync(SOURCE_DB).size / 1024 / 1024).toFixed(1);
    console.log(`Source: ${SOURCE_DB} (${sourceSize}MB)`);

    // Ensure output dir
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    // Copy source to output (work on the copy)
    fs.copyFileSync(SOURCE_DB, OUTPUT_DB);
    console.log(`Copied to: ${OUTPUT_DB}`);

    // Open the copy
    const SQL = await initSqlJs();
    const buffer = fs.readFileSync(OUTPUT_DB);
    const db = new SQL.Database(buffer);

    // --- Count before cleaning ---
    const countTable = (table) => {
        try {
            const result = db.exec(`SELECT COUNT(*) FROM ${table}`);
            return result.length > 0 ? result[0].values[0][0] : 0;
        } catch {
            return 'N/A';
        }
    };

    console.log('');
    console.log('Before cleaning:');
    console.log(`  scriptures:            ${countTable('scriptures')} (KEEP)`);
    console.log(`  books:                 ${countTable('books')} (KEEP)`);
    console.log(`  scripture_embeddings:  ${countTable('scripture_embeddings')} (KEEP)`);
    console.log(`  nodes:                 ${countTable('nodes')} (STRIP)`);
    console.log(`  edges:                 ${countTable('edges')} (STRIP)`);
    console.log(`  embeddings:            ${countTable('embeddings')} (STRIP)`);
    console.log(`  els_sessions:          ${countTable('els_sessions')} (STRIP)`);
    console.log(`  els_searches:          ${countTable('els_searches')} (STRIP)`);
    console.log(`  els_hits:              ${countTable('els_hits')} (STRIP)`);
    console.log(`  els_statistics:        ${countTable('els_statistics')} (STRIP)`);
    console.log(`  els_clusters:          ${countTable('els_clusters')} (STRIP)`);
    console.log(`  letter_streams:        ${countTable('letter_streams')} (STRIP — rebuilds on boot)`);
    console.log(`  pending_proposals:     ${countTable('pending_proposals')} (STRIP)`);
    console.log(`  type_definitions:      ${countTable('type_definitions')} (KEEP base only)`);

    // --- Strip personal data ---
    console.log('');
    console.log('Cleaning...');

    // Personal knowledge graph
    db.run('DELETE FROM embeddings;');
    console.log('  ✓ Cleared embeddings (personal node vectors)');

    db.run('DELETE FROM edges;');
    console.log('  ✓ Cleared edges (connections)');

    db.run('DELETE FROM nodes;');
    console.log('  ✓ Cleared nodes (study notes, prayers, insights)');

    // ELS research history
    // Order matters: hits/searches reference sessions, statistics reference searches
    try {
        db.run('DELETE FROM els_hits;');
        console.log('  ✓ Cleared els_hits');
    } catch { console.log('  - els_hits table not found (OK)'); }

    try {
        db.run('DELETE FROM els_statistics;');
        console.log('  ✓ Cleared els_statistics');
    } catch { console.log('  - els_statistics table not found (OK)'); }

    try {
        db.run('DELETE FROM els_clusters;');
        console.log('  ✓ Cleared els_clusters');
    } catch { console.log('  - els_clusters table not found (OK)'); }

    try {
        db.run('DELETE FROM els_searches;');
        console.log('  ✓ Cleared els_searches');
    } catch { console.log('  - els_searches table not found (OK)'); }

    try {
        db.run('DELETE FROM els_sessions;');
        console.log('  ✓ Cleared els_sessions');
    } catch { console.log('  - els_sessions table not found (OK)'); }

    // Pre-built letter streams (auto-rebuild from scripture on first boot)
    try {
        db.run('DELETE FROM letter_streams;');
        console.log('  ✓ Cleared letter_streams (rebuild on first boot from scripture)');
    } catch { console.log('  - letter_streams table not found (OK)'); }

    // Proposals
    db.run('DELETE FROM pending_proposals;');
    console.log('  ✓ Cleared pending_proposals');

    // Non-base type definitions
    try {
        db.run('DELETE FROM type_definitions WHERE is_base_type = 0;');
        console.log('  ✓ Cleared custom type definitions (kept base types)');
    } catch { console.log('  - type_definitions cleanup skipped'); }

    // Auth data
    try {
        db.run('DELETE FROM auth;');
        console.log('  ✓ Cleared auth data');
    } catch { console.log('  - No auth table (OK)'); }

    // Migrations log
    try {
        db.run('DELETE FROM migrations;');
        console.log('  ✓ Cleared migrations log');
    } catch { console.log('  - No migrations table (OK)'); }

    // Vacuum to reclaim space
    db.run('VACUUM;');
    console.log('  ✓ VACUUM — reclaimed disk space');

    // --- Verify ---
    console.log('');
    console.log('After cleaning:');
    console.log(`  scriptures:            ${countTable('scriptures')}`);
    console.log(`  books:                 ${countTable('books')}`);
    console.log(`  scripture_embeddings:  ${countTable('scripture_embeddings')}`);
    console.log(`  nodes:                 ${countTable('nodes')}`);
    console.log(`  edges:                 ${countTable('edges')}`);
    console.log(`  embeddings:            ${countTable('embeddings')}`);
    console.log(`  els_sessions:          ${countTable('els_sessions')}`);
    console.log(`  els_searches:          ${countTable('els_searches')}`);
    console.log(`  els_hits:              ${countTable('els_hits')}`);
    console.log(`  els_statistics:        ${countTable('els_statistics')}`);
    console.log(`  els_clusters:          ${countTable('els_clusters')}`);
    console.log(`  letter_streams:        ${countTable('letter_streams')}`);

    // Save
    const cleanData = db.export();
    const cleanBuffer = Buffer.from(cleanData);
    fs.writeFileSync(OUTPUT_DB, cleanBuffer);
    db.close();

    const cleanSize = (fs.statSync(OUTPUT_DB).size / 1024 / 1024).toFixed(1);

    console.log('');
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log(`║  Clean DB: ${OUTPUT_DB}`);
    console.log(`║  Size:     ${sourceSize}MB → ${cleanSize}MB`);
    console.log('║                                                      ║');
    console.log('║  Now build with:                                     ║');
    console.log('║  DB_PATH=dist/graph-clean.db npm run build           ║');
    console.log('║                                                      ║');
    console.log('║  (Windows PowerShell):                               ║');
    console.log('║  $env:DB_PATH="dist\\graph-clean.db"; npm run build  ║');
    console.log('╚══════════════════════════════════════════════════════╝');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
