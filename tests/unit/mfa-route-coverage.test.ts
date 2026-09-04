import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * The org MFA policy (spec §43) is enforced inside `withApiHandler`. Any
 * route that resolves the session itself — the file-download routes, which
 * must not be JSON-enveloped — steps outside that guard and has to re-check
 * the policy by hand.
 *
 * This is a structural test rather than a behavioural one because the bug it
 * guards is *forgetting*: three report routes shipped without the check and
 * nothing failed. A test that only covered the routes I remembered to cover
 * would have missed them too, so this walks every route file instead.
 */
const API_ROOT = path.join(process.cwd(), "src/app/api");

/** Removes block and line comments so a mention in prose can't satisfy a check. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full));
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

describe("MFA policy enforcement covers every API route", () => {
  it("no route resolves a session without either withApiHandler or an explicit policy check", () => {
    const offenders: string[] = [];

    for (const file of routeFiles(API_ROOT)) {
      // Comments are stripped first. The first version of this test matched
      // the bare word anywhere in the file, so a comment *explaining* why a
      // route sits outside `withApiHandler` was enough to make the test skip
      // that route — it passed against a deliberately broken file.
      const source = stripComments(readFileSync(file, "utf8"));
      if (!source.includes("getSessionContext")) continue;
      if (/withApiHandler\s*[(<]/.test(source)) continue;
      if (/mfaPolicySatisfied\s*\(/.test(source)) continue;
      offenders.push(path.relative(process.cwd(), file));
    }

    expect(offenders, `these routes bypass the org MFA policy:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });
});
