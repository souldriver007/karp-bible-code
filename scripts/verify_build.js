// ============================================================================
// KARP Bible Code — Verify Clean Build
// Version: 1.0.0
// Author: SoulDriver (Adelaide, Australia)
// Usage: node scripts/verify_build.js
//
// Opens dist/graph-clean.db and verifies:
//   ✓ KJV scripture data persisted (31,102 verses, 66 books)
//   ✓ Scripture embeddings persisted (15,857 vectors)
//   ✓ Base type definitions present
//   ✓ All schema tables exist (Word Graph + ELS)
//   ✓ Personal data stripped (nodes, edges, embeddings = 0)
//   ✓ ELS research stripped (sessions, searches, hits = 0)
//   ✓ Letter streams stripped (rebuild on first boot)
//
// No install required — checks the artifact directly.
// ============================================================================

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const ROOT = path.join(__dirname, '..');
const CLEAN_DB = process.argv[2] || path.join(ROOT, 'dist', 'graph-clean.db');

async function main() {
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║  KARP Bible Code — Verify Clean Build                    ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log('');

    if (!fs.existsSync(CLEAN_DB)) {
        console.error(`✗ Clean DB not found: ${CLEAN_DB}`);
        console.error('  Run: node scripts/clean_for_dist.js first');
        process.exit(1);
    }

    const dbSize = (fs.statSync(CLEAN_DB).size / 1024 / 1024).toFixed(1);
    console.log(`Database: ${CLEAN_DB} (${dbSize}MB)`);
    console.log('');

    const SQL = await initSqlJs();
    const buffer = fs.readFileSync(CLEAN_DB);
    const db = new SQL.Database(buffer);

    let passed = 0;
    let failed = 0;
    let warnings = 0;

    function check(label, condition, detail) {
        if (condition) {
            console.log(`  ✅ ${label}${detail ? ' — ' + detail : ''}`);
            passed++;
        } else {
            console.log(`  ❌ ${label}${detail ? ' — ' + detail : ''}`);
            failed++;
        }
    }

    function warn(label, detail) {
        console.log(`  ⚠️  ${label}${detail ? ' — ' + detail : ''}`);
        warnings++;
    }

    function count(table) {
        try {
            const result = db.exec(`SELECT COUNT(*) FROM ${table}`);
            return result.length > 0 ? result[0].values[0][0] : -1;
        } catch {
            return -1;  // table doesn't exist
        }
    }

    function tableExists(table) {
        try {
            db.exec(`SELECT 1 FROM ${table} LIMIT 0`);
            return true;
        } catch {
            return false;
        }
    }

    // ─── SCRIPTURE DATA (must persist) ───────────────────────────────
    console.log('── Scripture Data ──────────────────────────────────────');
    const verseCount = count('scriptures');
    const bookCount = count('books');
    const embeddingCount = count('scripture_embeddings');

    check('KJV Verses', verseCount === 31102, `${verseCount}/31102`);
    check('Books', bookCount === 66, `${bookCount}/66`);
    check('Scripture Embeddings', embeddingCount === 15857, `${embeddingCount}/15857`);

    // Spot-check a few verses
    const gen1 = db.exec("SELECT text FROM scriptures WHERE book_abbrev='GEN' AND chapter=1 AND verse=1");
    const jhn316 = db.exec("SELECT text FROM scriptures WHERE book_abbrev='JHN' AND chapter=3 AND verse=16");
    const rev2221 = db.exec("SELECT text FROM scriptures WHERE book_abbrev='REV' AND chapter=22 AND verse=21");

    check('Genesis 1:1 present', gen1.length > 0 && gen1[0].values[0][0].includes('In the beginning'));
    check('John 3:16 present', jhn316.length > 0 && jhn316[0].values[0][0].includes('For God so loved'));
    check('Revelation 22:21 present', rev2221.length > 0);

    // Check OT/NT split
    const otBooks = db.exec("SELECT COUNT(*) FROM books WHERE testament='OT'");
    const ntBooks = db.exec("SELECT COUNT(*) FROM books WHERE testament='NT'");
    const otCount = otBooks[0]?.values[0][0] || 0;
    const ntCount = ntBooks[0]?.values[0][0] || 0;
    check('OT Books', otCount === 39, `${otCount}/39`);
    check('NT Books', ntCount === 27, `${ntCount}/27`);

    // ─── PERSONAL DATA (must be stripped) ────────────────────────────
    console.log('');
    console.log('── Personal Data (should be empty) ────────────────────');
    check('Nodes stripped', count('nodes') === 0, `${count('nodes')} remaining`);
    check('Edges stripped', count('edges') === 0, `${count('edges')} remaining`);
    check('Personal embeddings stripped', count('embeddings') === 0, `${count('embeddings')} remaining`);
    check('Proposals stripped', count('pending_proposals') === 0, `${count('pending_proposals')} remaining`);

    // ─── ELS RESEARCH DATA (must be stripped) ────────────────────────
    console.log('');
    console.log('── ELS Research Data (should be empty) ────────────────');

    if (tableExists('els_sessions')) {
        check('ELS sessions stripped', count('els_sessions') === 0, `${count('els_sessions')} remaining`);
    } else {
        warn('els_sessions table missing', 'will be created by ensureSchema() on boot');
    }

    if (tableExists('els_searches')) {
        check('ELS searches stripped', count('els_searches') === 0, `${count('els_searches')} remaining`);
    } else {
        warn('els_searches table missing', 'will be created by ensureSchema() on boot');
    }

    if (tableExists('els_hits')) {
        check('ELS hits stripped', count('els_hits') === 0, `${count('els_hits')} remaining`);
    } else {
        warn('els_hits table missing', 'will be created by ensureSchema() on boot');
    }

    if (tableExists('els_statistics')) {
        check('ELS statistics stripped', count('els_statistics') === 0, `${count('els_statistics')} remaining`);
    } else {
        warn('els_statistics table missing', 'will be created by ensureSchema() on boot');
    }

    if (tableExists('els_clusters')) {
        check('ELS clusters stripped', count('els_clusters') === 0, `${count('els_clusters')} remaining`);
    } else {
        warn('els_clusters table missing', 'will be created by ensureSchema() on boot');
    }

    if (tableExists('letter_streams')) {
        check('Letter streams stripped', count('letter_streams') === 0, `${count('letter_streams')} remaining`);
    } else {
        warn('letter_streams table missing', 'will be created by ensureSchema() on boot');
    }

    // ─── SCHEMA TABLES (must exist) ─────────────────────────────────
    console.log('');
    console.log('── Schema Tables (must exist) ─────────────────────────');

    // Word Graph core tables
    const coreTables = [
        'nodes', 'edges', 'embeddings', 'type_definitions',
        'pending_proposals', 'migrations',
        'books', 'scriptures', 'scripture_embeddings',
        'study_sessions', 'reading_plans'
    ];

    for (const t of coreTables) {
        check(`Table: ${t}`, tableExists(t));
    }

    // ELS tables (created by ensureSchema on boot — OK if missing in clean DB)
    const elsTables = [
        'letter_streams', 'els_sessions', 'els_searches',
        'els_hits', 'els_clusters', 'els_statistics'
    ];

    for (const t of elsTables) {
        if (tableExists(t)) {
            check(`Table: ${t}`, true, 'present (will be empty)');
        } else {
            warn(`Table: ${t} not in clean DB`, 'OK — ensureSchema() creates it on first boot');
        }
    }

    // ─── TYPE DEFINITIONS ────────────────────────────────────────────
    console.log('');
    console.log('── Type Definitions ────────────────────────────────────');
    const typeDefs = count('type_definitions');
    const baseTypes = db.exec("SELECT COUNT(*) FROM type_definitions WHERE is_base_type = 1");
    const baseCount = baseTypes[0]?.values[0][0] || 0;
    const customTypes = db.exec("SELECT COUNT(*) FROM type_definitions WHERE is_base_type = 0");
    const customCount = customTypes[0]?.values[0][0] || 0;

    check('Base type definitions', baseCount >= 12, `${baseCount} base types`);
    check('Custom types stripped', customCount === 0, `${customCount} custom types remaining`);

    // List base types
    const typeList = db.exec("SELECT type_name, icon FROM type_definitions WHERE is_base_type = 1 ORDER BY type_name");
    if (typeList.length > 0) {
        const types = typeList[0].values.map(r => `${r[1]} ${r[0]}`).join(', ');
        console.log(`  📋 Base types: ${types}`);
    }

    // ─── INDEXES ─────────────────────────────────────────────────────
    console.log('');
    console.log('── Indexes ─────────────────────────────────────────────');
    const indexes = db.exec("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'");
    const indexCount = indexes.length > 0 ? indexes[0].values.length : 0;
    check('Indexes present', indexCount >= 7, `${indexCount} custom indexes`);

    // ─── SUMMARY ─────────────────────────────────────────────────────
    console.log('');
    console.log('════════════════════════════════════════════════════════');
    console.log(`  ✅ Passed: ${passed}`);
    if (warnings > 0) console.log(`  ⚠️  Warnings: ${warnings}`);
    if (failed > 0) console.log(`  ❌ Failed: ${failed}`);
    console.log(`  📦 DB Size: ${dbSize}MB`);
    console.log('════════════════════════════════════════════════════════');

    if (failed > 0) {
        console.log('');
        console.log('  ⛔ BUILD VERIFICATION FAILED — do NOT publish this build');
        process.exit(1);
    } else if (warnings > 0) {
        console.log('');
        console.log('  ⚠️  Warnings present but non-blocking (ELS tables auto-create on boot)');
        console.log('  ✅ Safe to build: $env:DB_PATH="dist\\graph-clean.db"; npm run build');
    } else {
        console.log('');
        console.log('  🎉 All checks passed!');
        console.log('  ✅ Safe to build: $env:DB_PATH="dist\\graph-clean.db"; npm run build');
    }

    db.close();
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
