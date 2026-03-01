// ============================================================================
// KARP Bible Code — MCPB Build Script
// Version: 0.1.0
// Author: SoulDriver (Adelaide, Australia)
// Usage: node scripts/build_mcpb.js
//
// Creates a .mcpb bundle (ZIP) with the correct structure:
//   karp-bible-code.mcpb
//   ├── manifest.json
//   ├── server/
//   │   ├── index.js
//   │   ├── database.js
//   │   ├── embeddings.js
//   │   ├── search.js
//   │   ├── auth.js
//   │   ├── els_engine.js
//   │   ├── els_sessions.js
//   │   ├── els_proximity.js
//   │   └── els_stats.js
//   ├── data/
//   │   └── graph.db          (pre-loaded KJV Bible + embeddings)
//   ├── ui/
//   │   └── index.html        (ELS Matrix + Word Graph UI)
//   ├── node_modules/          (production deps only)
//   ├── package.json
//   └── icon.png               (if exists)
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const STAGE = path.join(ROOT, 'dist', 'stage');
const OUTPUT = path.join(ROOT, 'dist', 'karp-bible-code.mcpb');

// Default location of the pre-loaded database
const DEFAULT_DB = path.join(require('os').homedir(), '.karp-bible-code', 'graph.db');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

function cleanDir(dir) {
    if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
    fs.mkdirSync(dir, { recursive: true });
}

function fileSize(filepath) {
    const bytes = fs.statSync(filepath).size;
    if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
    if (bytes > 1024) return `${(bytes / 1024).toFixed(0)}KB`;
    return `${bytes}B`;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

console.log('╔══════════════════════════════════════════════════════╗');
console.log('║  KARP Bible Code — MCPB Bundle Builder               ║');
console.log('║  "It is the glory of God to conceal a thing: but     ║');
console.log('║   the honour of kings is to search out a matter."    ║');
console.log('║                                    — Proverbs 25:2   ║');
console.log('║  by SoulDriver (souldriver.com.au)                   ║');
console.log('╚══════════════════════════════════════════════════════╝');
console.log('');

// Step 1: Verify
console.log('[1/7] Checking project...');
if (!fs.existsSync(path.join(ROOT, 'package.json'))) {
    console.error('      ✗ package.json not found!');
    process.exit(1);
}
console.log('      ✓ package.json found');

const requiredFiles = [
    'config/manifest.json',
    'server/index.js',
    'server/database.js',
    'server/embeddings.js',
    'server/search.js',
    'server/auth.js',
    'server/els_engine.js',
    'server/els_sessions.js',
    'server/els_proximity.js',
    'server/els_stats.js',
    'ui/index.html'
];

for (const f of requiredFiles) {
    if (!fs.existsSync(path.join(ROOT, f))) {
        console.error(`      ✗ Missing: ${f}`);
        process.exit(1);
    }
    console.log(`      ✓ ${f}`);
}

// Step 2: Clean staging
console.log('[2/7] Preparing staging directory...');
cleanDir(STAGE);
console.log('      ✓ dist/stage cleaned');

// Step 3: Copy files
console.log('[3/7] Staging files...');

// manifest.json
fs.copyFileSync(
    path.join(ROOT, 'config', 'manifest.json'),
    path.join(STAGE, 'manifest.json')
);
console.log('      ✓ manifest.json');

// package.json
fs.copyFileSync(
    path.join(ROOT, 'package.json'),
    path.join(STAGE, 'package.json')
);
console.log('      ✓ package.json');

// server/
copyDir(path.join(ROOT, 'server'), path.join(STAGE, 'server'));
// Remove any .bak files from staging
const serverFiles = fs.readdirSync(path.join(STAGE, 'server'));
serverFiles.forEach(f => { if (f.endsWith('.bak')) fs.unlinkSync(path.join(STAGE, 'server', f)); });

const elsCoreFiles = ['els_engine.js', 'els_sessions.js', 'els_proximity.js', 'els_stats.js'];
const elsPresent = elsCoreFiles.filter(f => fs.existsSync(path.join(STAGE, 'server', f)));
console.log(`      ✓ server/ (${serverFiles.filter(f => f.endsWith('.js')).length} JS files — ${elsPresent.length} ELS modules)`);

// ui/
copyDir(path.join(ROOT, 'ui'), path.join(STAGE, 'ui'));
console.log('      ✓ ui/ (index.html — ELS Matrix + Word Graph)');

// icon.png (optional)
const iconPath = path.join(ROOT, 'assets', 'icon.png');
if (fs.existsSync(iconPath)) {
    fs.copyFileSync(iconPath, path.join(STAGE, 'icon.png'));
    console.log('      ✓ icon.png');
} else {
    console.log('      ⚠ icon.png not found (optional — add to assets/)');
}

// Step 4: Bundle pre-loaded database
console.log('[4/7] Bundling pre-loaded scripture database...');

const dbSource = process.env.DB_PATH || DEFAULT_DB;
if (fs.existsSync(dbSource)) {
    const dataDir = path.join(STAGE, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.copyFileSync(dbSource, path.join(dataDir, 'graph.db'));
    console.log(`      ✓ data/graph.db (${fileSize(dbSource)}) — KJV Bible + embeddings + ELS streams`);
} else {
    console.warn(`      ⚠ No database found at: ${dbSource}`);
    console.warn('      ⚠ Bundle will NOT include pre-loaded scripture.');
    console.warn('      ⚠ Users will need to run: npm run ingest && re_embed_scriptures');
    console.warn(`      ⚠ Set DB_PATH env var to override location.`);
}

// Step 5: Install production dependencies
console.log('[5/7] Installing production dependencies (strips dev deps)...');
execSync('npm install --omit=dev', { cwd: STAGE, stdio: 'inherit' });
console.log('      ✓ node_modules/ (production dependencies only)');

// Step 6: Create ZIP
console.log('[6/7] Creating .mcpb bundle...');

if (fs.existsSync(OUTPUT)) {
    fs.unlinkSync(OUTPUT);
}

// Ensure dist directory exists
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });

const isWindows = process.platform === 'win32';

try {
    if (isWindows) {
        const zipPath = OUTPUT.replace(/\.mcpb$/, '.zip');
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
        const psCmd = `Compress-Archive -Path '${STAGE}\\*' -DestinationPath '${zipPath}' -Force`;
        execSync(`powershell -Command "${psCmd}"`, { stdio: 'inherit' });
        fs.renameSync(zipPath, OUTPUT);
    } else {
        execSync(`cd "${STAGE}" && zip -r "${OUTPUT}" .`, { stdio: 'inherit' });
    }
    console.log(`      ✓ Bundle created: ${OUTPUT}`);
} catch (e) {
    console.error(`      ✗ ZIP creation failed: ${e.message}`);
    console.log('');
    console.log('      Manual alternative:');
    console.log(`      1. Open: ${STAGE}`);
    console.log('      2. Select all files → right-click → Send to → Compressed folder');
    console.log(`      3. Rename to: karp-bible-code.mcpb`);
    process.exit(1);
}

// Step 7: Summary
console.log('[7/7] Build complete!');
console.log('');
console.log('╔══════════════════════════════════════════════════════╗');
console.log('║  BUILD SUMMARY                                       ║');
console.log('╠══════════════════════════════════════════════════════╣');
console.log(`║  Output:  ${path.basename(OUTPUT)}`);
console.log(`║  Size:    ${fileSize(OUTPUT)}`);
console.log(`║  Path:    ${OUTPUT}`);
console.log('╠══════════════════════════════════════════════════════╣');
console.log('║  TO INSTALL:                                         ║');
console.log('║  1. Open Claude Desktop                              ║');
console.log('║  2. Settings → Extensions → Install Extension        ║');
console.log('║  3. Select the .mcpb file                            ║');
console.log('║  4. Done! Scripture + ELS engine pre-loaded.          ║');
console.log('║  5. Open localhost:3458 for the web UI               ║');
console.log('║     (ELS Matrix tab for visual research)             ║');
console.log('╚══════════════════════════════════════════════════════╝');

// Cleanup
console.log('');
console.log('Cleaning up staging directory...');
fs.rmSync(STAGE, { recursive: true, force: true });
console.log('Done! 🚀');
