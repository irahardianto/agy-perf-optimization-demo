// Preloaded into the API process by tools/perf/profile.mjs (node --import). Records a sampling
// allocation profile — including objects that were already garbage-collected — and writes it to
// $FLASHMART_ALLOC_PROFILE when the process exits. Not used in normal runs.
import { writeFileSync } from 'node:fs';

const outFile = process.env.FLASHMART_ALLOC_PROFILE;

if (outFile) {
  try {
    const { Session } = await import('node:inspector');
    const session = new Session();
    session.connect();
    session.post('HeapProfiler.enable');
    session.post('HeapProfiler.startSampling', {
      samplingInterval: Number(process.env.FLASHMART_ALLOC_SAMPLING_INTERVAL ?? 65_536),
      includeObjectsCollectedByMajorGC: true,
      includeObjectsCollectedByMinorGC: true,
    });
    // The in-process inspector session answers synchronously, so this completes before exit.
    process.on('exit', () => {
      session.post('HeapProfiler.stopSampling', (error, result) => {
        if (error) {
          console.error(`allocation profile not written: ${error.message}`);
          return;
        }
        writeFileSync(outFile, JSON.stringify(result.profile));
      });
    });
  } catch (error) {
    console.error(`allocation profiling unavailable in this Node.js build: ${error.message}`);
  }
}
