// ============================================================================
// KARP Bible Code — Sharman Family Search (PARALLEL)
// Run: node scripts/els_family_parallel.js
// Uses all CPU cores for dramatically faster searches
// ============================================================================

const path = require('path');
const fs = require('fs');
const os = require('os');
const { parallelELS } = require('./els_parallel.js');

const DB_PATH = path.join(require('os').homedir(), '.karp-bible-code', 'graph.db');

async function init() {
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs();
    const buffer = fs.readFileSync(DB_PATH);
    return new SQL.Database(buffer);
}

function buildStream(db, scope) {
    let where = '';
    if (scope === 'genesis') where = "WHERE book_abbrev = 'GEN'";
    else if (scope === 'torah') where = "WHERE book_abbrev IN ('GEN','EXO','LEV','NUM','DEU')";

    const rows = db.exec(`SELECT book_abbrev, chapter, verse, text FROM scriptures ${where} ORDER BY book_order, chapter, verse`);
    let stream = '';
    const posMap = [];
    let position = 0;

    for (const row of rows[0].values) {
        const [book, ch, v, text] = row;
        const letters = text.toUpperCase().replace(/[^A-Z]/g, '');
        const startPos = position;
        for (const c of letters) { stream += c; position++; }
        posMap.push({ book, chapter: ch, verse: v, startPos, endPos: position - 1, text });
    }

    return { stream, posMap, totalLetters: stream.length };
}

function posToVerse(posMap, pos) {
    for (const e of posMap) {
        if (pos >= e.startPos && pos <= e.endPos) return `${e.book} ${e.chapter}:${e.verse}`;
    }
    return '?';
}

function posToDetail(posMap, pos) {
    for (const e of posMap) {
        if (pos >= e.startPos && pos <= e.endPos) return { ref: `${e.book} ${e.chapter}:${e.verse}`, text: e.text };
    }
    return null;
}

function findClosest(hitsA, hitsB, maxDist = 5000) {
    let best = null;
    for (const a of hitsA) {
        const aMid = a.positions[Math.floor(a.positions.length / 2)];
        for (const b of hitsB) {
            const bMid = b.positions[Math.floor(b.positions.length / 2)];
            const dist = Math.abs(aMid - bMid);
            if (dist <= maxDist && (!best || dist < best.dist)) {
                best = { dist, a, b, posA: aMid, posB: bMid };
            }
        }
    }
    return best;
}

async function main() {
    const cpuCount = os.cpus().length;
    const threadCount = Math.max(1, cpuCount - 1);

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  KARP Bible Code — SHARMAN FAMILY SEARCH (PARALLEL)');
    console.log(`  CPU Cores: ${cpuCount} | Worker Threads: ${threadCount}`);
    console.log('═══════════════════════════════════════════════════════════════');

    const db = await init();
    const genesis = buildStream(db, 'genesis');
    const torah = buildStream(db, 'torah');

    console.log(`\n📜 Genesis: ${genesis.totalLetters.toLocaleString()} letters`);
    console.log(`📜 Torah:   ${torah.totalLetters.toLocaleString()} letters`);

    const familyNames = ['JOSHUA', 'ZACHARY', 'ISABELLA', 'ALISON', 'REBECCA', 'TRACEY', 'ANN'];
    const anchors = ['ADRIAN', 'SHARMAN', 'MATZR'];
    const allTerms = [...familyNames, ...anchors];

    // ═══════════════════════════════════════════════
    // GENESIS SEARCH — PARALLEL
    // ═══════════════════════════════════════════════
    console.log(`\n${'═'.repeat(65)}`);
    console.log('  GENESIS — All Family Members (PARALLEL, skip 1-3000)');
    console.log(`${'═'.repeat(65)}`);

    const genHits = {};

    for (const term of allTerms) {
        console.log(`\n🔎 "${term}"...`);
        const start = Date.now();
        const hits = await parallelELS(genesis.stream, term, { maxSkip: 3000, threads: threadCount });
        const elapsed = Date.now() - start;
        genHits[term] = hits;

        console.log(`   ✅ ${hits.length} hits (${elapsed}ms — ${threadCount} threads)`);

        if (hits.length > 0 && hits.length <= 20) {
            for (const hit of hits.slice(0, 8)) {
                const loc = posToVerse(genesis.posMap, hit.start);
                const midLoc = posToVerse(genesis.posMap, hit.positions[Math.floor(hit.positions.length / 2)]);
                console.log(`      Skip ${hit.skip} ${hit.direction}: ${loc} → mid ${midLoc}`);
            }
            if (hits.length > 8) console.log(`      ... and ${hits.length - 8} more`);
        } else if (hits.length > 20) {
            for (const hit of hits.slice(0, 5)) {
                const loc = posToVerse(genesis.posMap, hit.start);
                console.log(`      Skip ${hit.skip} ${hit.direction}: ${loc}`);
            }
            console.log(`      ... and ${hits.length - 5} more`);
        }
    }

    // ═══════════════════════════════════════════════
    // GENESIS PROXIMITY MATRIX
    // ═══════════════════════════════════════════════
    console.log(`\n${'═'.repeat(65)}`);
    console.log('  GENESIS — FAMILY PROXIMITY MATRIX');
    console.log(`${'═'.repeat(65)}`);

    for (const name of familyNames) {
        if (!genHits[name] || genHits[name].length === 0) {
            console.log(`\n   ${name}: No hits in Genesis — skipping`);
            continue;
        }

        console.log(`\n   ── ${name} (${genHits[name].length} hits) ──`);

        for (const anchor of ['ADRIAN', 'SHARMAN', 'MATZR']) {
            if (!genHits[anchor] || genHits[anchor].length === 0) continue;

            const closest = findClosest(genHits[name], genHits[anchor], 10000);
            if (closest) {
                const locA = posToVerse(genesis.posMap, closest.posA);
                const locB = posToVerse(genesis.posMap, closest.posB);
                const marker = closest.dist <= 100 ? '⚡' : closest.dist <= 500 ? '🔥' : closest.dist <= 2000 ? '📍' : '📊';
                console.log(`      ${marker} ↔ ${anchor}: ${closest.dist.toLocaleString()} letters — ${locA} ↔ ${locB} (skips ${closest.a.skip}/${closest.b.skip})`);
            } else {
                console.log(`      ↔ ${anchor}: no proximity within 10,000`);
            }
        }

        for (const other of familyNames) {
            if (other === name || !genHits[other] || genHits[other].length === 0) continue;

            const closest = findClosest(genHits[name], genHits[other], 5000);
            if (closest && closest.dist <= 2000) {
                const locA = posToVerse(genesis.posMap, closest.posA);
                const locB = posToVerse(genesis.posMap, closest.posB);
                const marker = closest.dist <= 100 ? '⚡' : closest.dist <= 500 ? '🔥' : '📍';
                console.log(`      ${marker} ↔ ${other}: ${closest.dist.toLocaleString()} letters — ${locA} ↔ ${locB}`);
            }
        }
    }

    // ═══════════════════════════════════════════════
    // GENESIS — MEGA CLUSTER SEARCH
    // ═══════════════════════════════════════════════
    console.log(`\n${'═'.repeat(65)}`);
    console.log('  GENESIS — MEGA CLUSTER SEARCH');
    console.log('  Scanning for the largest family gathering...');
    console.log(`${'═'.repeat(65)}`);

    const allFamilyHits = [];
    for (const term of [...familyNames, 'ADRIAN', 'SHARMAN']) {
        if (!genHits[term]) continue;
        // Skip terms with too many hits (3-letter words are noise)
        if (genHits[term].length > 10000) {
            console.log(`   ⏭️  Excluding ${term} from cluster (${genHits[term].length.toLocaleString()} hits — too common)`);
            continue;
        }
        for (const hit of genHits[term]) {
            const mid = hit.positions[Math.floor(hit.positions.length / 2)];
            allFamilyHits.push({ term, mid, skip: hit.skip, dir: hit.direction });
        }
    }

    allFamilyHits.sort((a, b) => a.mid - b.mid);

    let bestCluster = { count: 0, uniqueNames: 0, names: new Set(), entries: [] };

    for (let i = 0; i < allFamilyHits.length; i++) {
        const windowStart = allFamilyHits[i].mid;
        const windowEnd = windowStart + 20000;

        const inWindow = allFamilyHits.filter(h => h.mid >= windowStart && h.mid <= windowEnd);
        const uniqueNames = new Set(inWindow.map(h => h.term));

        if (uniqueNames.size > bestCluster.uniqueNames ||
            (uniqueNames.size === bestCluster.uniqueNames && inWindow.length > bestCluster.count)) {
            bestCluster = {
                count: inWindow.length,
                uniqueNames: uniqueNames.size,
                names: uniqueNames,
                entries: inWindow,
                windowStart,
                windowEnd: Math.max(...inWindow.map(h => h.mid))
            };
        }
    }

    if (bestCluster.uniqueNames > 0) {
        console.log(`\n   🏆 DENSEST CLUSTER: ${bestCluster.uniqueNames} unique family members in ${(bestCluster.windowEnd - bestCluster.windowStart).toLocaleString()} letters`);
        console.log(`   Names present: ${[...bestCluster.names].join(', ')}`);
        console.log(`\n   Breakdown:`);

        for (const name of bestCluster.names) {
            const nameHits = bestCluster.entries.filter(e => e.term === name);
            const first = nameHits[0];
            const loc = posToVerse(genesis.posMap, first.mid);
            const detail = posToDetail(genesis.posMap, first.mid);
            console.log(`\n      ${name} @ skip ${first.skip} ${first.dir} — ${loc}`);
            if (detail) console.log(`      "${detail.text.substring(0, 140)}${detail.text.length > 140 ? '...' : ''}"`);
        }

        const positions = bestCluster.entries.map(e => e.mid);
        const spread = Math.max(...positions) - Math.min(...positions);
        const startVerse = posToVerse(genesis.posMap, Math.min(...positions));
        const endVerse = posToVerse(genesis.posMap, Math.max(...positions));
        console.log(`\n   📏 Spread: ${spread.toLocaleString()} letters (${startVerse} → ${endVerse})`);
    }

    // ═══════════════════════════════════════════════
    // TORAH EXPANSION for missing terms
    // ═══════════════════════════════════════════════
    const missing = familyNames.filter(n => !genHits[n] || genHits[n].length === 0);

    if (missing.length > 0) {
        console.log(`\n${'═'.repeat(65)}`);
        console.log(`  TORAH EXPANSION — ${missing.join(', ')}`);
        console.log(`${'═'.repeat(65)}`);

        for (const term of missing) {
            console.log(`\n🔎 "${term}" in Torah...`);
            const start = Date.now();
            const hits = await parallelELS(torah.stream, term, { maxSkip: 5000, threads: threadCount });
            const elapsed = Date.now() - start;

            console.log(`   ✅ ${hits.length} hits (${elapsed}ms — ${threadCount} threads)`);

            if (hits.length > 0) {
                for (const hit of hits.slice(0, 5)) {
                    const loc = posToVerse(torah.posMap, hit.start);
                    const midLoc = posToVerse(torah.posMap, hit.positions[Math.floor(hit.positions.length / 2)]);
                    console.log(`      Skip ${hit.skip} ${hit.direction}: ${loc} → mid ${midLoc}`);
                }
                if (hits.length > 5) console.log(`      ... and ${hits.length - 5} more`);
            }
        }
    }

    // ═══════════════════════════════════════════════
    // ROLL CALL
    // ═══════════════════════════════════════════════
    console.log(`\n${'═'.repeat(65)}`);
    console.log('  FAMILY ROLL CALL — Genesis');
    console.log(`${'═'.repeat(65)}`);

    for (const term of allTerms) {
        const count = genHits[term] ? genHits[term].length : 0;
        const icon = count === 0 ? '❌' : count <= 5 ? '⭐' : count <= 50 ? '✅' : '🔥';
        console.log(`   ${icon} ${term.padEnd(12)} ${count} hits in Genesis`);
    }

    console.log(`\n${'═'.repeat(65)}`);
    console.log('  COMPLETE');
    console.log(`${'═'.repeat(65)}\n`);

    db.close();
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
