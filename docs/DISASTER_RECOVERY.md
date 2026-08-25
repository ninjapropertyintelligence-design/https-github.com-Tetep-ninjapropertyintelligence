# Backup and Disaster Recovery

Spec §55 asks for two definitions (RPO, RTO) and four things to be *tested*
(database restoration, file restoration, queue recovery, vendor outage
behavior). This document holds the definitions. The tests are executable:
`npm run dr:verify` performs a real backup and restore and checks all four.

A recovery plan nobody has run is a hypothesis. The point of the script is
that the numbers below come from measurement rather than from a target
somebody wrote down.

---

## RPO — how much data can be lost?

**Target: 15 minutes.**

| Data | Mechanism | Exposure |
| --- | --- | --- |
| Database | Point-in-time recovery from WAL archiving, plus a daily base backup | Up to the WAL archive interval — 15 min at the target setting |
| Object storage | Versioned bucket with cross-region replication | Replication lag, typically seconds |
| Derived files (orthomosaics, point clouds, meshes) | Not backed up | Zero data loss risk: they are reproducible from the source images, at the cost of reprocessing time |

The 15-minute figure is a **deployment configuration**, not something this
repository enforces. It requires WAL archiving on the managed Postgres
instance and versioning + replication on the storage bucket. Neither is
code, and neither is on by default — treat this row as a checklist item for
whoever provisions the environment, not as a property the application
guarantees.

## RTO — how quickly must service recover?

**Target: 4 hours for full service, 1 hour for read-only access.**

Restore time is dominated by database size. Measured on the seeded
development dataset (217 rows across 14 tables) with `npm run dr:verify`:

```
Backup:  ~110ms
Restore: ~430ms
```

Those numbers are **not** an RTO. They establish that the procedure works
end to end and that the tooling is correct; they say nothing about a
production-sized database. Re-run `dr:verify` against a production-scale
restore to get a figure worth committing to, and update this section with it.

What the 4-hour target assumes:

1. Provision a replacement Postgres instance — 15–30 min on a managed service.
2. Restore the most recent base backup, then replay WAL to the target point.
3. Point the application at the restored database (`DATABASE_URL`) and redeploy.
4. Object storage needs no restore step if the bucket survived; if not,
   fail over to the replica bucket.
5. Re-queue any processing jobs left in a resumable state (see below).

---

## What `npm run dr:verify` actually checks

It takes a `pg_dump`, restores it into a scratch database, runs the checks,
and drops the scratch database. It exits non-zero on any failure, so it can
gate a pipeline.

| Check | What would fail it |
| --- | --- |
| Row counts match across 14 tables | A partial or truncated restore |
| Migration history restored | A restored database that cannot be migrated forward — a dead end |
| Foreign key constraints intact | A restore that drops constraints; looks fine until the first write |
| Every referenced object exists in storage | A database-only backup: rows restore perfectly and every photo 404s |
| Processing jobs restored with their state | Losing in-flight work |
| Every provider degrades correctly with no credentials | A vendor outage surfacing as a 500 instead of an honest state |

A check that runs against an empty table reports **INCONCLUSIVE**, not PASS.
"Nothing to restore" is not evidence that restoration works, and reporting it
as a pass would claim coverage the run did not have.

Verified to actually catch failures, not merely to pass: removing a single
object from storage turns the file-restoration check red and the script exits
1.

### Queue recovery

This system has no message broker. Processing jobs are `DroneProcessingJob`
rows with a status, so restoring the database *is* restoring the queue —
which is a genuine architectural advantage for recovery, not a gap. After a
restore, jobs left in `UPLOADING` or `PROCESSING` are the ones to re-drive;
`dr:verify` reports how many are in that state.

If a broker is introduced later, it becomes a seventh surface here and a
separate recovery step — messages in flight at the moment of failure are not
covered by a database backup.

### Vendor outage behavior

Every external provider in this codebase has a null/manual fallback that
reports an explicit not-configured state. `dr:verify` instantiates each with
no credentials — the state an outage or a revoked key leaves the app in — and
confirms it fails the way callers already handle:

- **Matterport** — `isConfigured()` false; the interior tab shows the honest state.
- **Mapbox** — `isConfigured()` false; the map degrades and geocoding is skipped rather than failing a property save.
- **AI** — throws the typed `AIProviderNotConfiguredError`. It deliberately does *not* answer: fabricating during an outage would be worse than failing.
- **Photogrammetry** — falls back to the manual upload provider.

---

## Running it

```bash
npm run dr:backup            # pg_dump + a manifest of every referenced object key
npm run dr:verify            # backup, restore into a scratch DB, check, clean up
```

`dr:backup` writes two files. The manifest is the part that makes file
restoration verifiable: a database dump alone restores rows pointing at
objects with no way to tell whether those objects still exist.

## What is not covered

Stated plainly rather than left to be discovered during an incident:

- **The backups themselves are not scheduled by this repository.** `dr:backup`
  is a command; running it on a timer and shipping the output off-host is a
  deployment concern.
- **No cross-region failover is automated.** The RTO above assumes a human
  runs the procedure.
- **Backup encryption and access control** are properties of wherever the
  dumps are stored, which is outside this repo.
- **Deleted data survives in backups** until they expire — see the
  `BACKUP_RETENTION` surface of a deletion request, which records the date
  it actually ages out (spec §54).
