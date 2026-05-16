# Parallel groups

## What this shows

A pipeline split into two `group`s:

- **`fast`** — three structural lints (`bun-native`, `filenames`,
  `imports`) marked `parallel: true, failFast: true`. The runner fans
  them out concurrently and aborts the rest if any one of them fails.
- **`slow`** — a single `command` stage that runs the unit test suite,
  marked `parallel: false`. The runner waits for `fast` to finish (all
  green) before this group starts.

### Fail-fast semantics

Within a `failFast: true` group, the first failing stage signals the
others to abort. The pipeline still reports the partial outcome and exits
non-zero, but it doesn't waste CI minutes finishing checks you already
know are going to be discarded.

Between groups, fail-fast does **not** cross the boundary unless you set
`failFast` on the next group too. Here, if any `fast` stage fails the
`slow` group simply never starts (because the previous group failed),
which is the same outcome but expressed at a different layer.

### Where parallel buys time

The fast group is dominated by file I/O and glob expansion — three
independent walks of the workspace. Running them concurrently is roughly
1/3 the wall-clock of running them serially. The slow group's single test
command saturates CPU on its own, so parallelising siblings would just
fight for cores.

## Who it's for

Teams whose pipeline is starting to feel slow on CI and who want to
trade a bit of config complexity for a noticeably faster green-build
loop.

## Prerequisites

The `slow` group's `test:unit` stage runs `bun run test:unit`, which means
your `package.json` must define a `test:unit` script. A minimal entry:

```jsonc
{
  "scripts": {
    "test:unit": "bun test"
  }
}
```

Substitute whatever command actually runs your unit tests (e.g.
`vitest run`, `jest`, a custom script). If your project uses a different
command for unit tests, edit `.qualityrc.jsonc` to point at it directly
or keep the indirection through `package.json` — either works.

## How to use

1. Copy `.qualityrc.jsonc` to the root of your repo.
2. Make sure the prerequisites above are satisfied (a `test:unit` script
   in your `package.json`).
3. Install the package:
   ```bash
   bun add -D @codegeneai/quality
   ```
4. Run the pipeline:
   ```bash
   bun x quality check
   ```
5. (Optional) Cap concurrency at the command line for a constrained CI
   runner:
   ```bash
   QUALITY_PARALLEL_LIMIT=2 bun x quality check
   ```
