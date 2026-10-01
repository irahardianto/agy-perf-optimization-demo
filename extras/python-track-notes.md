# Python track notes (optional variant)

The kit's live demo is **Node.js**. It needs zero dependencies, profiling is built into the
runtime (`--cpu-prof`, `--heap-prof`, `perf_hooks.monitorEventLoopDelay`), and the agent gets a
finished toolchain (`npm run profile`, `npm run bench`). If your audience is Python-first, or the
laptop turns out to have Python but no usable Node, here's how the same workshop maps to Python
using the **standard library only**.

> [!IMPORTANT]
> A Python twin of FlashMart is **not included** in this kit. Building and calibrating one is
> about 1–2 days of work: API, load generator, profile summarizer, tests, planted issues. Decide
> early (see the open decisions in the plan).

## Why the Python skill module isn't enough on a locked-down laptop

awesome-agv's `perf-optimization/languages/python.md` recommends `py-spy`, `scalene`, `memray`,
`snakeviz` and `pytest-benchmark`. All of them need `pip install`, which the restricted laptop
can't do. The stdlib equivalents:

| Need | Node kit today | Python stdlib equivalent |
|---|---|---|
| HTTP API | `node:http` | `http.server.ThreadingHTTPServer` (or `asyncio` streams) |
| CPU profile | `node --cpu-prof` + `tools/perf/analyze-cpuprofile.mjs` | `cProfile` + `pstats` (sort by `cumulative` and `tottime`), dumped to text for the agent |
| Allocation profile | `node --heap-prof` + analyzer | `tracemalloc` snapshots (`compare_to`, grouped by `lineno`) |
| Hot lines | cpuprofile line ticks | `cProfile` is per-function. For lines, sample `sys._current_frames()` from a thread every 1 ms (≈ 40 lines, stdlib only) |
| Event-loop delay | `monitorEventLoopDelay` | For asyncio: a 10 ms ticker measuring lag. For threads: queueing time (accept → handler start) |
| Load generator | `bench/lib/load.mjs` (keep-alive, 16 connections) | `http.client.HTTPConnection` per thread with `concurrent.futures`, or `asyncio` + raw streams |
| Tests | `node --test` | `unittest` (`python -m unittest`) |
| Retained heap | `--expose-gc` + `process.memoryUsage()` | `gc.collect()` + `tracemalloc.get_traced_memory()` |

## Planted issues, one-to-one

| # | Node (this kit) | Python analogue |
|---|---|---|
| 1 | `JSON.parse(readFileSync(catalog))` per request | `json.load(open(path))` per request; the fix is `os.stat` → `(st_ino, st_size, st_mtime_ns)` version check |
| 2 | Re-tokenizing 12,000 products per search | `re.split` + `unicodedata.normalize` per product per query; the fix is an inverted index per snapshot (`weakref`-keyed or version-keyed dict) |
| 3 | `pbkdf2Sync` per request (SEC-112) | `hashlib.pbkdf2_hmac('sha512', …, 10_000)` per request; the fix is the same digest-keyed, bounded, TTL cache with the status checked every request |
| 4 | `new Date(startsAt)` × 300 promotions | `datetime.fromisoformat` × 300 per line; the fix is a SKU index with pre-parsed timestamps, windows still checked per request |
| 5 | Sequential `await getStock()` per line | Sequential `time.sleep`/`asyncio.sleep` calls per line; the fix is a batch + `asyncio.gather` for loyalty, shipping after stock |
| 6 | Unbounded `entries.push` | Unbounded `list.append`; the fix is `collections.deque(maxlen=1000)` |

The naive traps carry over too: `functools.lru_cache` on the loader (load-once), a watchdog-style
watcher (not available offline anyway), `lru_cache` on `authenticate(key_id)`.

## Python-specific twists worth teaching

- **The GIL:** with `ThreadingHTTPServer`, CPU-bound handlers serialize, so the "event loop is
  drowning" story becomes "threads are queueing behind the GIL". Measure queueing time instead
  of loop delay.
- **`hashlib.pbkdf2_hmac` releases the GIL** during hashing, so threads *can* hash in parallel.
  The cache still wins, but the baseline is less dramatic than Node's single thread.
- **The profile's order changes.** `json` parsing runs in C, while tokenizing and scoring run
  as pure Python, which is many times slower than V8-compiled JavaScript. The catalog parse's
  *share* of the profile therefore shrinks and tokenization tends to top it. Recalibrate the
  catalog size and planted costs so the story still opens with a cross-dimension CRITICAL.

## Recommendation

Keep Node for the live session: it's the fastest path to a reliable 60-minute demo on a locked-down
laptop. Offer the Python mapping above as a take-home exercise, or build the Python twin as a
follow-up if the audience asks for it.
