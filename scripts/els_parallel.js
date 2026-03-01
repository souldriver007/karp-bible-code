// ============================================================================
// KARP Bible Code — Parallel ELS Search Engine
// Uses worker_threads to spread skip intervals across all CPU cores
// ============================================================================

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');

// ---------------------------------------------------------------------------
// WORKER CODE — runs inside each thread
// ---------------------------------------------------------------------------
if (!isMainThread) {
    const { stream, term, skipStart, skipEnd, directions } = workerData;
    const hits = [];
    const termLen = term.length;
    const streamLen = stream.length;

    // Build first-letter index
    const firstPositions = [];
    for (let i = 0; i < streamLen; i++) {
        if (stream[i] === term[0]) firstPositions.push(i);
    }

    for (const dir of directions) {
        for (let skip = skipStart; skip <= skipEnd; skip++) {
            for (const start of firstPositions) {
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

    parentPort.postMessage(hits);
    process.exit(0);
}

// ---------------------------------------------------------------------------
// MAIN THREAD — splits work across cores
// ---------------------------------------------------------------------------

function parallelELS(stream, term, { minSkip = 1, maxSkip = 3000, direction = 'both', threads = null } = {}) {
    term = term.toUpperCase().replace(/[^A-Z]/g, '');
    if (!term) return Promise.resolve([]);

    maxSkip = Math.min(maxSkip, Math.floor(stream.length / term.length));

    const numThreads = threads || Math.max(1, os.cpus().length - 1); // Leave 1 core free
    const totalSkips = maxSkip - minSkip + 1;
    const skipsPerThread = Math.ceil(totalSkips / numThreads);

    const directions = [];
    if (direction === 'both' || direction === 'forward') directions.push(1);
    if (direction === 'both' || direction === 'reverse') directions.push(-1);

    return new Promise((resolve, reject) => {
        const allHits = [];
        let completed = 0;
        const actualThreads = Math.min(numThreads, totalSkips);

        console.log(`   🧵 Spawning ${actualThreads} threads (${os.cpus().length} cores available)`);

        for (let t = 0; t < actualThreads; t++) {
            const skipStart = minSkip + (t * skipsPerThread);
            const skipEnd = Math.min(skipStart + skipsPerThread - 1, maxSkip);

            if (skipStart > maxSkip) {
                completed++;
                if (completed === actualThreads) resolve(allHits);
                continue;
            }

            const worker = new Worker(__filename, {
                workerData: { stream, term, skipStart, skipEnd, directions }
            });

            worker.on('message', (hits) => {
                allHits.push(...hits);
                completed++;
                if (completed === actualThreads) {
                    resolve(allHits);
                }
            });

            worker.on('error', (err) => {
                console.error(`   ❌ Worker ${t} error:`, err.message);
                completed++;
                if (completed === actualThreads) resolve(allHits);
            });
        }
    });
}

module.exports = { parallelELS };
