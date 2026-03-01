// ============================================================================
// KARP Bible Code — FULL FAMILY SEARCH (23 terms)
// Run: node scripts/els_full_family.js
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

function findClosest(hitsA, hitsB, maxDist = 10000) {
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

    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('  KARP Bible Code — FULL FAMILY & FRIENDS SEARCH');
    console.log(`  CPU Cores: ${cpuCount} | Worker Threads: ${threadCount}`);
    console.log('  23 Terms | Genesis + Torah Expansion');
    console.log('═══════════════════════════════════════════════════════════════════');

    const db = await init();
    const genesis = buildStream(db, 'genesis');
    const torah = buildStream(db, 'torah');

    console.log(`\n📜 Genesis: ${genesis.totalLetters.toLocaleString()} letters`);
    console.log(`📜 Torah:   ${torah.totalLetters.toLocaleString()} letters`);

    const allNames = [
        'MATZR', 'ADRIAN', 'MELANIE', 'ALISON', 'REBEKAH', 'BELLA',
        'TRACEY', 'BRENDA', 'WILLIAM', 'FRANK', 'TANYA', 'CHERIE',
        'ZACHARIAH', 'SHARMAN', 'WENDY', 'LAURIE', 'MARGARET',
        'BROADBEAR', 'MITCHELL', 'CAIL', 'ROBERT', 'STEVEN', 'DEMON'
    ];

    // ═══════════════════════════════════════════════
    // GENESIS SEARCH
    // ═══════════════════════════════════════════════
    console.log(`\n${'═'.repeat(70)}`);
    console.log('  PHASE 1: GENESIS (skip 1-3000, both directions)');
    console.log(`${'═'.repeat(70)}`);

    const genHits = {};
    const genTotalStart = Date.now();

    for (const term of allNames) {
        process.stdout.write(`  🔎 ${term.padEnd(12)}`);
        const start = Date.now();
        const hits = await parallelELS(genesis.stream, term, { maxSkip: 3000, threads: threadCount });
        const elapsed = Date.now() - start;
        genHits[term] = hits;

        const icon = hits.length === 0 ? '❌' : hits.length <= 5 ? '⭐' : hits.length <= 50 ? '✅' : '🔥';
        // Suppress the thread spawn message — just show results
        console.log(`${icon} ${String(hits.length).padStart(6)} hits  (${elapsed}ms)`);

        // Show first few locations for terms with hits
        if (hits.length > 0 && hits.length <= 30) {
            for (const hit of hits.slice(0, 3)) {
                const midLoc = posToVerse(genesis.posMap, hit.positions[Math.floor(hit.positions.length / 2)]);
                console.log(`              Skip ${String(hit.skip).padStart(4)} ${hit.direction.padEnd(7)} → ${midLoc}`);
            }
            if (hits.length > 3) console.log(`              ... and ${hits.length - 3} more`);
        } else if (hits.length > 30) {
            console.log(`              Top skips: ${hits.slice(0, 5).map(h => h.skip).join(', ')}...`);
        }
    }

    const genTotalElapsed = Date.now() - genTotalStart;
    console.log(`\n  ⏱️  Total Genesis search time: ${(genTotalElapsed / 1000).toFixed(1)}s`);

    // ═══════════════════════════════════════════════
    // ROLL CALL
    // ═══════════════════════════════════════════════
    const found = allNames.filter(n => genHits[n] && genHits[n].length > 0);
    const missing = allNames.filter(n => !genHits[n] || genHits[n].length === 0);

    console.log(`\n${'═'.repeat(70)}`);
    console.log(`  GENESIS ROLL CALL: ${found.length}/${allNames.length} PRESENT`);
    console.log(`${'═'.repeat(70)}`);
    console.log(`  ✅ Present: ${found.join(', ')}`);
    if (missing.length > 0) {
        console.log(`  ❌ Missing: ${missing.join(', ')}`);
    }

    // ═══════════════════════════════════════════════
    // PROXIMITY MATRIX — every found name vs ADRIAN and SHARMAN
    // ═══════════════════════════════════════════════
    console.log(`\n${'═'.repeat(70)}`);
    console.log('  PROXIMITY TO FAMILY ANCHORS (ADRIAN / SHARMAN / MATZR)');
    console.log(`${'═'.repeat(70)}`);

    const anchors = ['ADRIAN', 'SHARMAN', 'MATZR'];

    for (const name of found) {
        if (anchors.includes(name)) continue;
        if (genHits[name].length > 10000) {
            console.log(`\n  ${name}: too many hits (${genHits[name].length.toLocaleString()}) — skipping proximity`);
            continue;
        }

        console.log(`\n  ── ${name} (${genHits[name].length} hits) ──`);

        for (const anchor of anchors) {
            if (!genHits[anchor] || genHits[anchor].length === 0) continue;

            const closest = findClosest(genHits[name], genHits[anchor], 15000);
            if (closest) {
                const locA = posToVerse(genesis.posMap, closest.posA);
                const locB = posToVerse(genesis.posMap, closest.posB);
                const marker = closest.dist <= 50 ? '⚡' : closest.dist <= 200 ? '🔥' : closest.dist <= 1000 ? '📍' : closest.dist <= 5000 ? '📊' : '🔭';
                console.log(`      ${marker} ↔ ${anchor.padEnd(8)}: ${closest.dist.toLocaleString().padStart(6)} letters — ${locA} ↔ ${locB}`);
            } else {
                console.log(`      ↔ ${anchor.padEnd(8)}: no proximity within 15,000`);
            }
        }
    }

    // ═══════════════════════════════════════════════
    // MEGA CLUSTER — densest family gathering
    // ═══════════════════════════════════════════════
    console.log(`\n${'═'.repeat(70)}`);
    console.log('  MEGA CLUSTER — Densest Family Gathering in Genesis');
    console.log(`${'═'.repeat(70)}`);

    const allFamilyHits = [];
    for (const term of found) {
        if (genHits[term].length > 10000) continue; // Skip noise terms
        for (const hit of genHits[term]) {
            const mid = hit.positions[Math.floor(hit.positions.length / 2)];
            allFamilyHits.push({ term, mid, skip: hit.skip, dir: hit.direction });
        }
    }

    allFamilyHits.sort((a, b) => a.mid - b.mid);

    // Try multiple window sizes
    for (const windowSize of [10000, 20000, 30000]) {
        let bestCluster = { count: 0, uniqueNames: 0, names: new Set(), entries: [] };

        for (let i = 0; i < allFamilyHits.length; i++) {
            const windowStart = allFamilyHits[i].mid;
            const windowEnd = windowStart + windowSize;

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
            const positions = bestCluster.entries.map(e => e.mid);
            const spread = Math.max(...positions) - Math.min(...positions);
            const startVerse = posToVerse(genesis.posMap, Math.min(...positions));
            const endVerse = posToVerse(genesis.posMap, Math.max(...positions));

            console.log(`\n  📏 Window ${(windowSize / 1000).toFixed(0)}K letters:`);
            console.log(`     🏆 ${bestCluster.uniqueNames} unique names — ${[...bestCluster.names].join(', ')}`);
            console.log(`     📍 ${startVerse} → ${endVerse} (${spread.toLocaleString()} letters)`);

            // Show verse details for each name in the best cluster
            if (windowSize === 20000 || bestCluster.uniqueNames >= found.length * 0.6) {
                console.log(`\n     Breakdown:`);
                const shown = new Set();
                for (const name of bestCluster.names) {
                    if (shown.has(name)) continue;
                    shown.add(name);
                    const first = bestCluster.entries.find(e => e.term === name);
                    const loc = posToVerse(genesis.posMap, first.mid);
                    const detail = posToDetail(genesis.posMap, first.mid);
                    console.log(`\n        ${name} @ skip ${first.skip} ${first.dir} — ${loc}`);
                    if (detail) console.log(`        "${detail.text.substring(0, 130)}${detail.text.length > 130 ? '...' : ''}"`);
                }
            }
        }
    }

    // ═══════════════════════════════════════════════
    // INTER-FAMILY PROXIMITY — closest pairs between ALL found names
    // ═══════════════════════════════════════════════
    console.log(`\n${'═'.repeat(70)}`);
    console.log('  CLOSEST FAMILY PAIRS');
    console.log(`${'═'.repeat(70)}`);

    const pairs = [];
    const foundFiltered = found.filter(n => genHits[n].length <= 10000);

    for (let i = 0; i < foundFiltered.length; i++) {
        for (let j = i + 1; j < foundFiltered.length; j++) {
            const closest = findClosest(genHits[foundFiltered[i]], genHits[foundFiltered[j]], 500);
            if (closest) {
                pairs.push({
                    nameA: foundFiltered[i],
                    nameB: foundFiltered[j],
                    dist: closest.dist,
                    locA: posToVerse(genesis.posMap, closest.posA),
                    locB: posToVerse(genesis.posMap, closest.posB),
                    skipA: closest.a.skip,
                    skipB: closest.b.skip
                });
            }
        }
    }

    pairs.sort((a, b) => a.dist - b.dist);

    if (pairs.length > 0) {
        console.log(`\n  All pairs within 500 letters (sorted by distance):\n`);
        for (const p of pairs.slice(0, 30)) {
            const marker = p.dist === 0 ? '💥 INTERSECT' : p.dist <= 20 ? '⚡' : p.dist <= 100 ? '🔥' : p.dist <= 300 ? '📍' : '📊';
            console.log(`    ${marker} ${p.nameA} × ${p.nameB}: ${p.dist} letters — ${p.locA} ↔ ${p.locB} (skips ${p.skipA}/${p.skipB})`);
        }
        if (pairs.length > 30) console.log(`    ... and ${pairs.length - 30} more pairs`);
    } else {
        console.log(`  No pairs within 500 letters`);
    }

    // ═══════════════════════════════════════════════
    // TORAH EXPANSION for missing terms
    // ═══════════════════════════════════════════════
    if (missing.length > 0) {
        console.log(`\n${'═'.repeat(70)}`);
        console.log(`  TORAH EXPANSION — ${missing.length} missing terms`);
        console.log(`${'═'.repeat(70)}`);

        for (const term of missing) {
            process.stdout.write(`  🔎 ${term.padEnd(12)}`);
            const start = Date.now();
            const hits = await parallelELS(torah.stream, term, { maxSkip: 5000, threads: threadCount });
            const elapsed = Date.now() - start;

            const icon = hits.length === 0 ? '❌' : hits.length <= 5 ? '⭐' : '✅';
            console.log(`${icon} ${String(hits.length).padStart(6)} hits in Torah  (${elapsed}ms)`);

            if (hits.length > 0) {
                for (const hit of hits.slice(0, 3)) {
                    const midLoc = posToVerse(torah.posMap, hit.positions[Math.floor(hit.positions.length / 2)]);
                    console.log(`              Skip ${String(hit.skip).padStart(4)} ${hit.direction.padEnd(7)} → ${midLoc}`);
                }
                if (hits.length > 3) console.log(`              ... and ${hits.length - 3} more`);
            }
        }
    }

    // ═══════════════════════════════════════════════
    // FINAL SUMMARY
    // ═══════════════════════════════════════════════
    console.log(`\n${'═'.repeat(70)}`);
    console.log('  FINAL SUMMARY');
    console.log(`${'═'.repeat(70)}`);
    console.log(`  Total terms searched:   ${allNames.length}`);
    console.log(`  Found in Genesis:       ${found.length}`);
    console.log(`  Missing from Genesis:   ${missing.length}`);
    console.log(`  Close pairs (≤500):     ${pairs.length}`);
    console.log(`${'═'.repeat(70)}\n`);

    db.close();
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
