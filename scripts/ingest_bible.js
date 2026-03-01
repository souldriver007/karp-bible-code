// ============================================================================
// KARP Word Graph — Bible Ingestion Script
// Version: 0.1.0
// Author: SoulDriver (Adelaide, Australia)
// Description: Parses aruljohn/Bible-kjv JSON files and loads them into
//              the Word Graph SQLite database. Run once after downloading
//              the Bible data, or again to refresh/update.
//
// Usage:   npm run ingest
//    or:   node scripts/ingest_bible.js [path-to-bible-kjv-folder]
//
// Default path: looks for Bible-kjv-master in parent directory or
//               prompts via BIBLE_DATA_PATH env var.
// ============================================================================

const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PROJECT_ROOT = path.join(__dirname, '..');

// Look for Bible data in common locations
function findBibleData() {
    const candidates = [
        process.argv[2],                                                    // CLI argument
        process.env.BIBLE_DATA_PATH,                                        // Env var
        path.join(PROJECT_ROOT, '..', 'Bible-kjv-master'),                 // Sibling folder
        path.join(PROJECT_ROOT, 'data', 'Bible-kjv-master'),               // data subfolder
        path.join(require('os').homedir(), 'Bible-kjv-master'),            // Home dir
    ].filter(Boolean);

    for (const dir of candidates) {
        const resolved = path.resolve(dir);
        if (fs.existsSync(path.join(resolved, 'Books.json'))) {
            return resolved;
        }
    }
    return null;
}

// Book abbreviation map (must match database.js)
const BOOK_ABBREVS = {
    'Genesis': 'GEN', 'Exodus': 'EXO', 'Leviticus': 'LEV', 'Numbers': 'NUM',
    'Deuteronomy': 'DEU', 'Joshua': 'JOS', 'Judges': 'JDG', 'Ruth': 'RUT',
    '1 Samuel': '1SA', '2 Samuel': '2SA', '1 Kings': '1KI', '2 Kings': '2KI',
    '1 Chronicles': '1CH', '2 Chronicles': '2CH', 'Ezra': 'EZR', 'Nehemiah': 'NEH',
    'Esther': 'EST', 'Job': 'JOB', 'Psalms': 'PSA', 'Proverbs': 'PRO',
    'Ecclesiastes': 'ECC', 'Song of Solomon': 'SOS', 'Isaiah': 'ISA', 'Jeremiah': 'JER',
    'Lamentations': 'LAM', 'Ezekiel': 'EZK', 'Daniel': 'DAN', 'Hosea': 'HOS',
    'Joel': 'JOL', 'Amos': 'AMO', 'Obadiah': 'OBA', 'Jonah': 'JON',
    'Micah': 'MIC', 'Nahum': 'NAH', 'Habakkuk': 'HAB', 'Zephaniah': 'ZEP',
    'Haggai': 'HAG', 'Zechariah': 'ZEC', 'Malachi': 'MAL',
    'Matthew': 'MAT', 'Mark': 'MRK', 'Luke': 'LUK', 'John': 'JHN',
    'Acts': 'ACT', 'Romans': 'ROM', '1 Corinthians': '1CO', '2 Corinthians': '2CO',
    'Galatians': 'GAL', 'Ephesians': 'EPH', 'Philippians': 'PHP', 'Colossians': 'COL',
    '1 Thessalonians': '1TH', '2 Thessalonians': '2TH', '1 Timothy': '1TI', '2 Timothy': '2TI',
    'Titus': 'TIT', 'Philemon': 'PHM', 'Hebrews': 'HEB', 'James': 'JAS',
    '1 Peter': '1PE', '2 Peter': '2PE', '1 John': '1JN', '2 John': '2JN',
    '3 John': '3JN', 'Jude': 'JUD', 'Revelation': 'REV'
};

// Filename mapping for books with spaces/special chars
function bookNameToFilename(bookName) {
    // The aruljohn repo uses filenames without spaces
    return bookName.replace(/\s+/g, '') + '.json';
}

// ---------------------------------------------------------------------------
// Main Ingestion
// ---------------------------------------------------------------------------

async function main() {
    console.log('='.repeat(70));
    console.log('KARP Word Graph — Bible Ingestion');
    console.log('"Search the scriptures" — John 5:39');
    console.log('='.repeat(70));
    console.log('');

    // 1. Find Bible data
    const bibleDir = findBibleData();
    if (!bibleDir) {
        console.error('❌ Bible data not found!');
        console.error('');
        console.error('Please provide the path to the Bible-kjv-master folder:');
        console.error('  node scripts/ingest_bible.js /path/to/Bible-kjv-master');
        console.error('');
        console.error('Or set BIBLE_DATA_PATH environment variable.');
        console.error('Download from: https://github.com/aruljohn/Bible-kjv');
        process.exit(1);
    }
    console.log(`📁 Bible data: ${bibleDir}`);

    // 2. Initialize database
    const database = require('../server/database');
    const DATA_PATH = process.env.DATA_PATH || path.join(require('os').homedir(), '.karp-bible-code');
    console.log(`💾 Database: ${DATA_PATH}`);
    await database.configure(DATA_PATH);

    // 3. Check if already ingested
    const existingStats = database.getScriptureStats();
    if (existingStats.total_verses > 0) {
        console.log(`\n⚠️  Database already contains ${existingStats.total_verses} verses across ${existingStats.total_books} books.`);
        console.log('   Re-ingesting will replace existing scripture data.');
        console.log('   (Study notes and personal data are NOT affected.)');
        console.log('');
    }

    // 4. Read Books.json for canonical ordering
    const booksJson = JSON.parse(fs.readFileSync(path.join(bibleDir, 'Books.json'), 'utf8'));
    console.log(`📚 Found ${booksJson.length} books in Books.json`);
    console.log('');

    // 5. Ingest each book
    let totalVerses = 0;
    let totalChapters = 0;
    const errors = [];
    const startTime = Date.now();

    for (let bookIdx = 0; bookIdx < booksJson.length; bookIdx++) {
        const bookName = booksJson[bookIdx];
        const bookOrder = bookIdx + 1;  // 1-indexed
        const abbrev = BOOK_ABBREVS[bookName];
        const testament = bookOrder <= 39 ? 'OT' : 'NT';
        const filename = bookNameToFilename(bookName);
        const filePath = path.join(bibleDir, filename);

        if (!abbrev) {
            console.error(`  ❌ No abbreviation mapping for "${bookName}" — skipping!`);
            errors.push(`No abbreviation for: ${bookName}`);
            continue;
        }

        if (!fs.existsSync(filePath)) {
            console.error(`  ❌ File not found: ${filename} — skipping!`);
            errors.push(`File not found: ${filename}`);
            continue;
        }

        // Parse book JSON
        const bookData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const chapters = bookData.chapters;
        let bookVerseCount = 0;

        // Prepare batch of verses
        const verseBatch = [];

        for (const chapter of chapters) {
            const chapterNum = parseInt(chapter.chapter);

            for (const verse of chapter.verses) {
                const verseNum = parseInt(verse.verse);
                const verseId = `${abbrev}.${chapterNum}.${verseNum}`;

                verseBatch.push({
                    id: verseId,
                    book: bookName,
                    bookAbbrev: abbrev,
                    bookOrder: bookOrder,
                    chapter: chapterNum,
                    verse: verseNum,
                    text: verse.text,
                    translation: 'KJV'
                });

                bookVerseCount++;
            }
        }

        // Batch insert all verses for this book
        try {
            database.insertScriptureBatch(verseBatch);
        } catch (err) {
            console.error(`  ❌ Error inserting ${bookName}: ${err.message}`);
            errors.push(`Insert error for ${bookName}: ${err.message}`);
            continue;
        }

        // Insert book metadata
        database.insertBook({
            bookOrder,
            name: bookName,
            abbrev,
            testament,
            chapterCount: chapters.length,
            verseCount: bookVerseCount,
            translation: 'KJV'
        });

        totalVerses += bookVerseCount;
        totalChapters += chapters.length;

        const testamentIcon = testament === 'OT' ? '📜' : '✝️';
        const progress = `${String(bookOrder).padStart(2)}/${booksJson.length}`;
        console.log(`  ${testamentIcon} [${progress}] ${abbrev.padEnd(3)} ${bookName.padEnd(20)} ${chapters.length} ch, ${bookVerseCount} verses`);
    }

    // 6. Force save to disk
    database.immediateSave();

    // 7. Summary
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('');
    console.log('='.repeat(70));
    console.log('INGESTION COMPLETE');
    console.log('='.repeat(70));
    console.log(`  Books:     ${booksJson.length}`);
    console.log(`  Chapters:  ${totalChapters}`);
    console.log(`  Verses:    ${totalVerses}`);
    console.log(`  Time:      ${elapsed}s`);
    console.log(`  Errors:    ${errors.length}`);

    if (errors.length > 0) {
        console.log('');
        console.log('⚠️  Errors:');
        errors.forEach(e => console.log(`    - ${e}`));
    }

    // 8. Verify
    const finalStats = database.getScriptureStats();
    console.log('');
    console.log('📊 Verification:');
    console.log(`  DB reports: ${finalStats.total_verses} verses, ${finalStats.total_books} books`);

    if (finalStats.total_verses === 31102) {
        console.log('  ✅ Perfect — matches standard KJV verse count (31,102)');
    } else if (finalStats.total_verses > 30000) {
        console.log(`  ⚠️  Close to expected 31,102 — difference of ${Math.abs(31102 - finalStats.total_verses)} verses`);
    } else {
        console.log('  ❌ Verse count seems low — check for missing files');
    }

    console.log('');
    console.log('📋 Next steps:');
    console.log('  1. Start the MCP server:  npm start');
    console.log('  2. Scripture embeddings will be generated automatically on first search');
    console.log('  3. Or run full embedding:  (use re_embed_scriptures tool via Claude)');
    console.log('');
    console.log('"Thy word is a lamp unto my feet, and a light unto my path." — Psalm 119:105');
    console.log('');
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
