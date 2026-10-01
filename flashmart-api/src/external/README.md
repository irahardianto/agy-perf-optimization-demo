# External service clients (simulated)

These modules stand in for services owned by other teams:

| Module | Real system | Simulated cost |
|---|---|---|
| `inventory-client.js` | Warehouse inventory API | `getStock`: ~3 ms per call · `getStockBatch`: ~3 ms + 0.05 ms/SKU (max 100 SKUs) |
| `shipping-client.js` | FlashExpress carrier rating API | ~12 ms per quote |
| `loyalty-client.js` | FlashMart Rewards API | ~8 ms per lookup |

**Do not modify this directory.** In production these are network calls whose latency we
don't control; the simulated latency is part of every benchmark. Change *how FlashMart calls
them*, not the clients themselves.

Set `SIMULATE_EXTERNAL_LATENCY=0` to disable the waits (the test suite does this).
