/**
 * Microbenchmark: measure actual performance of the Bun-native API migrations.
 *
 * Run: bun packages/quality/bench/bun-api-bench.ts
 */
import { stat } from "fs/promises";
import fg from "../src/utils/bun-glob";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const ITERATIONS = 500;
const WARM_UP = 200;

const time = async (label: string, fn: () => Promise<void> | void) => {
  // warm-up
  for (let i = 0; i < WARM_UP; i++) await fn();

  const start = performance.now();
  for (let i = 0; i < ITERATIONS; i++) await fn();
  const elapsed = performance.now() - start;
  const perOp = elapsed / ITERATIONS;
  console.log(
    `  ${label}: ${elapsed.toFixed(1)}ms total, ${perOp.toFixed(3)}ms/op`,
  );
  return perOp;
};

// Use the repo root package.json as a target — always exists, always valid JSON.
const ROOT = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "");
const TARGET = `${ROOT}/package.json`;
const MISSING = `${ROOT}/__does_not_exist__`;

console.log(`Root: ${ROOT}`);
console.log(`Iterations per test: ${ITERATIONS} (+ ${WARM_UP} warm-up)\n`);

// ---------------------------------------------------------------------------
// 1. pathExists: fs.stat vs Bun.file().exists()
// ---------------------------------------------------------------------------
console.log("=== pathExists (file that exists) ===");

const statExists = await time("fs.stat (old)", async () => {
  try {
    await stat(TARGET);
  } catch {}
});

const bunExists = await time("Bun.file().exists() (new)", async () => {
  await Bun.file(TARGET).exists();
});

console.log(`  Speedup: ${(statExists / bunExists).toFixed(2)}x\n`);

console.log("=== pathExists (file that does NOT exist) ===");

const statMissing = await time("fs.stat (old)", async () => {
  try {
    await stat(MISSING);
  } catch {}
});

const bunMissing = await time("Bun.file().exists() (new)", async () => {
  await Bun.file(MISSING).exists();
});

console.log(`  Speedup: ${(statMissing / bunMissing).toFixed(2)}x\n`);

// ---------------------------------------------------------------------------
// 2. readJsonFile: text+parse vs .json()
// ---------------------------------------------------------------------------
console.log("=== readJsonFile ===");

const textParse = await time(
  "Bun.file().text() + JSON.parse (old)",
  async () => {
    const text = await Bun.file(TARGET).text();
    JSON.parse(text);
  },
);

const directJson = await time("Bun.file().json() (new)", async () => {
  await Bun.file(TARGET).json();
});

console.log(`  Speedup: ${(textParse / directJson).toFixed(2)}x\n`);

// ---------------------------------------------------------------------------
// 3. Sequential vs parallel file reads (simulating barrel-exports)
// ---------------------------------------------------------------------------
// Find some real package.json files to read
const pkgJsonPaths = await fg("packages/*/package.json", {
  cwd: ROOT,
  dot: false,
});
const samplePaths = pkgJsonPaths.slice(0, 20).map((p) => `${ROOT}/${p}`);
const PARALLEL_ITERS = 100;

if (samplePaths.length >= 5) {
  console.log(
    `=== Sequential vs Parallel reads (${samplePaths.length} files) ===`,
  );

  // warm-up
  for (let i = 0; i < 10; i++) {
    for (const p of samplePaths) await Bun.file(p).json();
  }

  const seqStart = performance.now();
  for (let i = 0; i < PARALLEL_ITERS; i++) {
    for (const p of samplePaths) {
      await Bun.file(p).json();
    }
  }
  const seqElapsed = performance.now() - seqStart;
  const seqPerOp = seqElapsed / PARALLEL_ITERS;
  console.log(
    `  Sequential (old): ${seqElapsed.toFixed(1)}ms total, ${seqPerOp.toFixed(3)}ms/op`,
  );

  // warm-up
  for (let i = 0; i < 10; i++) {
    await Promise.all(samplePaths.map((p) => Bun.file(p).json()));
  }

  const parStart = performance.now();
  for (let i = 0; i < PARALLEL_ITERS; i++) {
    await Promise.all(samplePaths.map((p) => Bun.file(p).json()));
  }
  const parElapsed = performance.now() - parStart;
  const parPerOp = parElapsed / PARALLEL_ITERS;
  console.log(
    `  Parallel (new):   ${parElapsed.toFixed(1)}ms total, ${parPerOp.toFixed(3)}ms/op`,
  );
  console.log(`  Speedup: ${(seqPerOp / parPerOp).toFixed(2)}x\n`);
} else {
  console.log(
    "=== Skipped parallel bench (not enough package.json files) ===\n",
  );
}

// ---------------------------------------------------------------------------
// 4. Sync vs Async glob
// ---------------------------------------------------------------------------
console.log("=== Sync vs Async glob ===");
const GLOB_ITERS = 50;

// warm-up
for (let i = 0; i < 5; i++) {
  fg.sync("packages/*/package.json", { cwd: ROOT, dot: false });
}

const syncStart = performance.now();
for (let i = 0; i < GLOB_ITERS; i++) {
  fg.sync("packages/*/package.json", { cwd: ROOT, dot: false });
}
const syncElapsed = performance.now() - syncStart;
const syncPerOp = syncElapsed / GLOB_ITERS;
console.log(
  `  fg.sync (old): ${syncElapsed.toFixed(1)}ms total, ${syncPerOp.toFixed(3)}ms/op`,
);

// warm-up
for (let i = 0; i < 5; i++) {
  await fg("packages/*/package.json", { cwd: ROOT, dot: false });
}

const asyncStart = performance.now();
for (let i = 0; i < GLOB_ITERS; i++) {
  await fg("packages/*/package.json", { cwd: ROOT, dot: false });
}
const asyncElapsed = performance.now() - asyncStart;
const asyncPerOp = asyncElapsed / GLOB_ITERS;
console.log(
  `  fg async (new): ${asyncElapsed.toFixed(1)}ms total, ${asyncPerOp.toFixed(3)}ms/op`,
);
console.log(`  Speedup: ${(syncPerOp / asyncPerOp).toFixed(2)}x`);
console.log(
  "  NOTE: sync is faster for single sequential calls due to async scheduling overhead.",
);
console.log(
  "  Async only helps when multiple independent operations can overlap (not the case here).\n",
);

// ---------------------------------------------------------------------------
// 5. findSubjectFile: sequential vs parallel Bun.file().exists()
// ---------------------------------------------------------------------------
console.log("=== Sequential vs Parallel exists() checks (8 extensions) ===");
console.log(
  "  NOTE: These measure DIFFERENT algorithms — sequential has early exit, parallel checks ALL.",
);
const EXTENSIONS = ["ts", "tsx", "js", "jsx", "mjs", "mts", "cjs", "cts"];
const BASE = `${ROOT}/packages/quality/src/utils/fs`; // fs.ts exists
const EXISTS_ITERS = 200;

// warm-up
for (let i = 0; i < 20; i++) {
  for (const ext of EXTENSIONS) await Bun.file(`${BASE}.${ext}`).exists();
}

const seqExStart = performance.now();
for (let i = 0; i < EXISTS_ITERS; i++) {
  for (const ext of EXTENSIONS) {
    if (await Bun.file(`${BASE}.${ext}`).exists()) break;
  }
}
const seqExElapsed = performance.now() - seqExStart;
const seqExPerOp = seqExElapsed / EXISTS_ITERS;
console.log(
  `  Sequential (old): ${seqExElapsed.toFixed(1)}ms total, ${seqExPerOp.toFixed(3)}ms/op`,
);

// warm-up
for (let i = 0; i < 20; i++) {
  await Promise.all(
    EXTENSIONS.map((ext) => Bun.file(`${BASE}.${ext}`).exists()),
  );
}

const parExStart = performance.now();
for (let i = 0; i < EXISTS_ITERS; i++) {
  const results = await Promise.all(
    EXTENSIONS.map((ext) => Bun.file(`${BASE}.${ext}`).exists()),
  );
  results.find(Boolean);
}
const parExElapsed = performance.now() - parExStart;
const parExPerOp = parExElapsed / EXISTS_ITERS;
console.log(
  `  Parallel (new):   ${parExElapsed.toFixed(1)}ms total, ${parExPerOp.toFixed(3)}ms/op`,
);
console.log(`  Speedup: ${(seqExPerOp / parExPerOp).toFixed(2)}x\n`);
