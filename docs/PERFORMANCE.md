# Performance and load testing (spec §98/§103)

## What this measures, and what it deliberately does not

The implementation report carried this gap for several phases:

> the scoring engine's `getLatestHealthSnapshots()` uses a `DISTINCT ON` raw
> query designed for portfolio scale, but no load test was run against
> 1,000+/10,000+ synthetic properties

A design *intended* for scale that has never *met* scale is an assumption, not
a property. This closes that.

**The absolute millisecond figures below are not production numbers and must
not be quoted as such.** They come from a development container sharing a CPU
with an untuned Postgres, no connection pooler, cold caches. Publishing them as
"the platform responds in Xms" would be a fabrication dressed as evidence.

What *does* transfer between environments is the **shape of the curve**. A
query that takes ~10x longer for 10x the data is linear and will grow
predictably; one that takes ~100x longer is quadratic and will fall over at a
portfolio size nobody tested. That ratio is a property of the query, not of the
machine. It is the thing measured, reported and asserted on.

## Running it

```bash
# Generate a deterministic synthetic portfolio (fixed seed: two runs at the
# same scale produce identical data, so a timing difference is a code change)
npx tsx scripts/perf-seed.ts --properties 10000 --reset

# Measure the hot read paths at two scales and report how each one grows
npx tsx scripts/perf-benchmark.ts --small 1000 --large 10000
```

At 10,000 properties the generator produces 100,000 assets, 60,000 issues and
50,000 health snapshots — five snapshots per property, so that "newest per
property" is a real choice rather than a free one.

## Results

Measured 1,000 → 10,000 properties (10x the data), after the fixes below:

| Path | 1,000 | 10,000 | Ratio | Verdict |
|---|---|---|---|---|
| Portfolio dashboard | 30.1 ms | 146.8 ms | 4.9x | sub-linear |
| Latest health snapshots (`DISTINCT ON`) | 8.8 ms | 75.2 ms | 8.5x | ~linear |
| Property list (scoped, paged 50) | 2.2 ms | 6.8 ms | 3.1x | sub-linear |
| Spatial radius search (100 mi) | 4.2 ms | 3.1 ms | 0.7x | sub-linear |
| Property COGS report (30 d) | 2.6 ms | 2.9 ms | 1.1x | sub-linear |

Every measured path grows at most linearly with the data. The `DISTINCT ON`
query the report singled out does behave as designed: 8.5x for 10x the data,
served by the `[propertyId, computedAt]` index.

The spatial search is flat-to-faster at 10x because the GiST index bounds the
work by the *radius*, not by the table — which is the whole reason §11 uses
`ST_DWithin` over a distance comparison.

## The bug this found: a hard ceiling at ~65,000 properties

Scaling was not the real finding. This was.

Postgres sends bind parameters with a **16-bit count**, so one statement
cannot carry more than 65,535 of them. The dashboard spent one parameter per
property — `propertyId: { in: [...] }` in five queries, plus
`IN (${Prisma.join(propertyIds)})` in the raw snapshot query.

Measured directly:

| Property ids | Prisma `in:` | Raw `$queryRaw` |
|---|---|---|
| 10,000 | OK | OK (260 ms) |
| 32,000 | OK | OK (169 ms) |
| 65,000 | **FAILED** — "The query parameter limit supported by your database is exceeded" | OK (191 ms) |
| 70,000 | FAILED | **FAILED** — `08P01 bind message has 4464 parameter formats but 0 parameters` |
| 100,000 | FAILED | FAILED |

So an organization that grew past roughly 65,000 properties would have found
its dashboard simply stopped loading. Not slowly — at all. And the raw query's
failure is a bare protocol error that says nothing about the cause, so
diagnosing it in production would have been miserable.

### Fix

1. **The dashboard filters through the `property` relation, not an id list.**
   `{ property: scopedWhere }` pushes the same scope into a join, so the
   statement carries a handful of parameters regardless of portfolio size.
   `propertyScopeWhere` remains the single authority on what is visible.
2. **`getLatestHealthSnapshots` chunks at 20,000 ids.** It stays id-based
   because it is raw SQL, and keeping the scope in Prisma is what stops the
   access rule existing in two languages. Chunking makes the ceiling
   unreachable rather than merely distant. Chunks run sequentially — the point
   is to bound work in flight, and firing them all at once would put the load
   straight back.

After the fix, 100,000 ids succeeds in 246 ms.

## A gap this exposed

`getPortfolioDashboard` describes itself as the one source of truth for every
portfolio KPI — the API route, the AI gateway and reports all read it — and it
had **no test coverage at all**. The rewrite above was therefore unverified by
anything.

`tests/integration/dashboard.test.ts` now covers it: the counts, exclusion of
other organizations, region-grant scoping, deny-by-default for an ungranted
role, and agreement with the same counts computed independently. Mutation
tested — dropping the tenant scope from a relation filter fails five of the
six.

## Known limits, not yet addressed

- **The dashboard still materialises one snapshot row per scoped property** to
  aggregate in JavaScript. At 10,000 properties that is 10,000 rows into
  memory per request. It no longer *fails*, but the aggregation belongs in SQL
  before a single organization reaches six figures.
- **Writes are not load-tested.** Everything here measures read paths. Bulk
  import, drone registration and the scoring recomputation have not been
  measured under concurrency.
- **No concurrency testing.** Every measurement is sequential. Connection-pool
  exhaustion and lock contention are exactly what a serverless deployment on a
  transaction pooler is most likely to hit, and nothing here exercises them.
- **Not measured against production infrastructure.** See the first section.
  Supabase's pooler, its instance size and its network are all absent from
  these numbers.
