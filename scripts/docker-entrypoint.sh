#!/usr/bin/env bash
set -euo pipefail

echo "Waiting for Postgres..."
# The app starting before the database accepts connections is the single most
# common cause of a failed first run, and it looks like a code error.
until pg_isready -h db -p 5432 -U postgres >/dev/null 2>&1; do
  sleep 1
done
echo "Postgres is up."

# `migrate deploy` applies the existing migrations and never prompts, which is
# what an unattended container needs. `migrate dev` would try to author one.
echo "Applying migrations..."
npx prisma migrate deploy

# Seeding is idempotent (the seed upserts), so a restart cannot duplicate the
# demo org — but skip it when data is already there so restarts stay quick.
# `|| echo 0` covers the first run, where the query itself may fail.
USERS=$(psql "$DATABASE_URL" -tAc 'SELECT count(*) FROM "User"' 2>/dev/null | tr -d '[:space:]' || true)
if [ -z "${USERS}" ] || [ "${USERS}" = "0" ]; then
  echo "Seeding demo data..."
  npx tsx prisma/seed.ts
else
  echo "Demo data already present (${USERS} users) — skipping seed."
fi

echo ""
echo "======================================================================"
echo "  Ready:  http://localhost:3000"
echo "  Log in: owner@demo.com  /  password123"
echo "======================================================================"
echo ""
exec npm run dev -- --hostname 0.0.0.0
