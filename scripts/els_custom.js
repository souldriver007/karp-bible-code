// ============================================================================
// KARP Bible Code — Custom ELS Search: MATZR + ADRIAN + SHARMAN
// Run: node scripts/els_custom.js
// ============================================================================

const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(require('os').homedir(), '.karp-bible-code', 'graph.db');

async function init() {
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs();
    const buffer = fs.readFileSync(DB_PATH);
    return new SQL.Database(buffer);
}

function buildLetterStream(db, scope = 'torah') {
    let query = scope === 'torah'
        ? "SELECT book_abbrev, chapter, verse, text FROM scriptures WHERE book_abbrev IN ('GEN','EXO','LEV','NUM','DEU') ORDER BY book_order, chapter, verse"
        : 'SELECT book_abbrev, chapter, verse, text FROM scriptures ORDER BY book_order, chapter, verse';

    const rows = db.exec(query);
    let stream = '';
    const posMap = [];  // FULL position map for verse lookup
    let position = 0;
    const letterFreq = {};

    for (const row of rows[0].values) {
        const [bookAbbrev, chapter, verse, text] = row;
        const letters = text.toUpperCase().replace(/[^A-Z]/g, '');
        const startPos = position;

        for (let i = 0; i < letters.length; i++) {
            const ch = letters[i];
            stream += ch;
            letterFreq[ch] = (letterFreq[ch] || 0) + 1;
            position++;
        }

        posMap.push({ book: bookAbbrev, chapter, verse, startPos, endPos: position - 1, text });
    }

    return { stream, posMap, letterFreq, totalLetters: stream.length };
}

function positionToVerse(posMap, pos) {
    for (const entry of posMap) {
        if (pos >= entry.startPos && pos <= entry.endPos) {
            return `${entry.book} ${entry.chapter}:${entry.verse}`;
        }
    }
    return '?';
}

function positionToVerseDetail(posMap, pos) {
    for (const entry of posMap) {
        if (pos >= entry.startPos && pos <= entry.endPos) {
            return { ref: `${entry.book} ${entry.chapter}:${entry.verse}`, text: entry.text };
        }
    }
    return null;
}

function elsSearch(stream, term, { minSkip = 1, maxSkip = 5000, direction = 'both' } = {}) {
    term = term.toUpperCase().replace(/[^A-Z]/g, '');
    if (!term) return [];

    maxSkip = Math.min(maxSkip, Math.floor(stream.length / term.length));
    const hits = [];
    const termLen = term.length;
    const streamLen = stream.length;

    const directions = [];
    if (direction === 'both' || direction === 'forward') directions.push(1);
    if (direction === 'both' || direction === 'reverse') directions.push(-1);

    // First-letter index
    const firstLetterPositions = [];
    for (let i = 0; i < streamLen; i++) {
        if (stream[i] === term[0]) firstLetterPositions.push(i);
    }

    for (const dir of directions) {
        for (let skip = minSkip; skip <= maxSkip; skip++) {
            for (const start of firstLetterPositions) {
                const endPos = start + dir * ((termLen - 1) * skip);
                if (endPos < 0 || endPos >= streamLen) continue;

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
                    hits.push({ term, start, skip, direction: dir === 1 ? 'forward' : 'reverse', positions });
                }
            }
        }
    }

    return hits;
}

// Check proximity between two hit sets
function findProximity(hitsA, hitsB, maxDistance = 5000) {
    const clusters = [];

    for (const a of hitsA) {
        for (const b of hitsB) {
            // Check if any letter positions overlap or are near each other
            for (const posA of a.positions) {
                for (const posB of b.positions) {
                    const dist = Math.abs(posA - posB);
                    if (dist <= maxDistance) {
                        clusters.push({
                            termA: a.term, termB: b.term,
                            skipA: a.skip, skipB: b.skip,
                            dirA: a.direction, dirB: b.direction,
                            closestDistance: dist,
                            posA, posB,
                            intersect: dist === 0
                        });
                        // Only record closest match per pair
                        break;
                    }
                }
            }
        }
    }

    // Sort by distance, deduplicate by skip pair
    clusters.sort((a, b) => a.closestDistance - b.closestDistance);
    const seen = new Set();
    return clusters.filter(c => {
        const key = `${c.skipA}-${c.skipB}-${c.dirA}-${c.dirB}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

async function main() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  KARP Bible Code — Custom Search');
    console.log('  Terms: MATZR + ADRIAN + SHARMAN');
    console.log('═══════════════════════════════════════════════════════════');

    const db = await init();

    // Build both streams
    const torah = buildLetterStream(db, 'torah');
    const genesis = buildLetterStream(db, 'genesis');
    const full = buildLetterStream(db, 'full');

    // Override genesis scope
    const genRows = db.exec("SELECT book_abbrev, chapter, verse, text FROM scriptures WHERE book_abbrev = 'GEN' ORDER BY book_order, chapter, verse");
    let genStream = '';
    const genPosMap = [];
    let genPos = 0;
    const genFreq = {};
    for (const row of genRows[0].values) {
        const [book, ch, v, text] = row;
        const letters = text.toUpperCase().replace(/[^A-Z]/g, '');
        const startPos = genPos;
        for (const c of letters) {
            genStream += c;
            genFreq[c] = (genFreq[c] || 0) + 1;
            genPos++;
        }
        genPosMap.push({ book, chapter: ch, verse: v, startPos, endPos: genPos - 1, text });
    }
    console.log(`\n📜 Genesis stream: ${genStream.length.toLocaleString()} letters`);
    console.log(`📜 Torah stream:   ${torah.stream.length.toLocaleString()} letters`);
    console.log(`📜 Full Bible:     ${full.stream.length.toLocaleString()} letters`);

    const terms = ['MATZR', 'ADRIAN', 'SHARMAN'];
    const allHits = {};

    // Search each stream
    for (const [label, stream, posMap] of [
        ['Genesis', genStream, genPosMap],
        ['Torah', torah.stream, torah.posMap],
        ['Full Bible', full.stream, full.posMap]
    ]) {
        console.log(`\n${'═'.repeat(60)}`);
        console.log(`  ${label.toUpperCase()} — ELS Search (skip 1-5000, both directions)`);
        console.log(`${'═'.repeat(60)}`);

        for (const term of terms) {
            const maxSkip = label === 'Genesis' ? 2000 : 5000;
            console.log(`\n🔎 "${term}" in ${label} (skip 1-${maxSkip})...`);
            const start = Date.now();
            const hits = elsSearch(stream, term, { maxSkip, direction: 'both' });
            const elapsed = Date.now() - start;

            console.log(`   ✅ ${hits.length} hits (${elapsed}ms)`);

            const key = `${label}:${term}`;
            allHits[key] = hits;

            if (hits.length > 0) {
                // Show first 5 with verse locations
                const shown = hits.slice(0, 5);
                for (const hit of shown) {
                    const loc = positionToVerse(posMap, hit.start);
                    const midPos = hit.positions[Math.floor(hit.positions.length / 2)];
                    const midLoc = positionToVerse(posMap, midPos);
                    console.log(`      Skip ${hit.skip} ${hit.direction}: start ${loc} → mid ${midLoc}`);
                }
                if (hits.length > 5) console.log(`      ... and ${hits.length - 5} more`);

                // Show skip distribution
                const fwd = hits.filter(h => h.direction === 'forward').length;
                const rev = hits.filter(h => h.direction === 'reverse').length;
                console.log(`   📊 Forward: ${fwd} | Reverse: ${rev}`);
            }
        }

        // Proximity analysis — do any of the terms cluster?
        console.log(`\n   ${'─'.repeat(50)}`);
        console.log(`   PROXIMITY ANALYSIS — ${label}`);
        console.log(`   ${'─'.repeat(50)}`);

        const pairs = [['MATZR', 'ADRIAN'], ['MATZR', 'SHARMAN'], ['ADRIAN', 'SHARMAN']];

        for (const [termA, termB] of pairs) {
            const keyA = `${label}:${termA}`;
            const keyB = `${label}:${termB}`;
            const hA = allHits[keyA] || [];
            const hB = allHits[keyB] || [];

            if (hA.length === 0 || hB.length === 0) {
                console.log(`\n   ${termA} × ${termB}: skipped (no hits for one term)`);
                continue;
            }

            console.log(`\n   ${termA} × ${termB}:`);
            const clusters = findProximity(hA, hB, 10000);

            if (clusters.length === 0) {
                console.log(`      No proximity within 10,000 letters`);
            } else {
                const intersections = clusters.filter(c => c.intersect);
                const close = clusters.filter(c => c.closestDistance <= 1000);

                if (intersections.length > 0) {
                    console.log(`      ⚡ INTERSECTIONS: ${intersections.length}`);
                    for (const c of intersections.slice(0, 3)) {
                        const loc = positionToVerse(posMap, c.posA);
                        console.log(`         At position ${c.posA} (${loc}) — ${termA}@skip${c.skipA} × ${termB}@skip${c.skipB}`);
                    }
                }

                if (close.length > 0) {
                    console.log(`      🔥 Within 1,000 letters: ${close.length} clusters`);
                    for (const c of close.slice(0, 5)) {
                        const locA = positionToVerse(posMap, c.posA);
                        const locB = positionToVerse(posMap, c.posB);
                        console.log(`         ${c.closestDistance} letters apart — ${termA}@skip${c.skipA}(${locA}) ↔ ${termB}@skip${c.skipB}(${locB})`);
                    }
                }

                console.log(`      📊 Total within 10,000 letters: ${clusters.length}`);

                // Show the single closest match
                const closest = clusters[0];
                if (closest && !closest.intersect) {
                    const locA = positionToVerse(posMap, closest.posA);
                    const locB = positionToVerse(posMap, closest.posB);
                    console.log(`      🎯 Closest: ${closest.closestDistance} letters — ${locA} ↔ ${locB}`);
                }
            }
        }

        // Triple proximity — all three terms near each other
        console.log(`\n   ${'─'.repeat(50)}`);
        console.log(`   TRIPLE CLUSTER — All three terms`);
        console.log(`   ${'─'.repeat(50)}`);

        const mHits = allHits[`${label}:MATZR`] || [];
        const aHits = allHits[`${label}:ADRIAN`] || [];
        const sHits = allHits[`${label}:SHARMAN`] || [];

        if (mHits.length > 0 && aHits.length > 0 && sHits.length > 0) {
            let tripleFound = false;

            for (const m of mHits) {
                for (const a of aHits) {
                    // Quick check: are M and A within range?
                    const mCenter = m.positions[Math.floor(m.positions.length / 2)];
                    const aCenter = a.positions[Math.floor(a.positions.length / 2)];
                    if (Math.abs(mCenter - aCenter) > 20000) continue;

                    for (const s of sHits) {
                        const sCenter = s.positions[Math.floor(s.positions.length / 2)];

                        const distMA = Math.abs(mCenter - aCenter);
                        const distMS = Math.abs(mCenter - sCenter);
                        const distAS = Math.abs(aCenter - sCenter);
                        const maxDist = Math.max(distMA, distMS, distAS);

                        if (maxDist <= 15000) {
                            const mLoc = positionToVerse(posMap, mCenter);
                            const aLoc = positionToVerse(posMap, aCenter);
                            const sLoc = positionToVerse(posMap, sCenter);

                            console.log(`\n   ⚡⚡⚡ TRIPLE CLUSTER FOUND ⚡⚡⚡`);
                            console.log(`      MATZR   @ skip ${m.skip} ${m.direction} — ${mLoc}`);
                            console.log(`      ADRIAN  @ skip ${a.skip} ${a.direction} — ${aLoc}`);
                            console.log(`      SHARMAN @ skip ${s.skip} ${s.direction} — ${sLoc}`);
                            console.log(`      Spread: ${maxDist.toLocaleString()} letters`);
                            console.log(`      M↔A: ${distMA.toLocaleString()} | M↔S: ${distMS.toLocaleString()} | A↔S: ${distAS.toLocaleString()}`);

                            // Get the verse text for the center of each
                            const mDetail = positionToVerseDetail(posMap, mCenter);
                            const aDetail = positionToVerseDetail(posMap, aCenter);
                            const sDetail = positionToVerseDetail(posMap, sCenter);

                            if (mDetail) console.log(`\n      MATZR verse:   ${mDetail.ref}`);
                            if (mDetail) console.log(`      "${mDetail.text.substring(0, 120)}..."`);
                            if (aDetail) console.log(`\n      ADRIAN verse:  ${aDetail.ref}`);
                            if (aDetail) console.log(`      "${aDetail.text.substring(0, 120)}..."`);
                            if (sDetail) console.log(`\n      SHARMAN verse: ${sDetail.ref}`);
                            if (sDetail) console.log(`      "${sDetail.text.substring(0, 120)}..."`);

                            tripleFound = true;
                            break;
                        }
                    }
                    if (tripleFound) break;
                }
                if (tripleFound) break;
            }

            if (!tripleFound) {
                console.log(`   No triple cluster within 15,000 letters`);
            }
        } else {
            console.log(`   Cannot check — need hits for all three terms`);
        }
    }

    console.log(`\n${'═'.repeat(60)}`);
    console.log('  SEARCH COMPLETE');
    console.log(`${'═'.repeat(60)}\n`);

    db.close();
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
