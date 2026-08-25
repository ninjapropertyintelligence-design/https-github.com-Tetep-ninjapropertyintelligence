import { describe, expect, it } from "vitest";
import { libpqUrl } from "../../scripts/backup";

/**
 * The pure part of the backup tooling. The restore itself is exercised by
 * `npm run dr:verify`, which performs a real pg_dump/pg_restore — that
 * cannot be a unit test, but the URL handling below can, and it is the part
 * that silently broke the first run.
 */
describe("libpqUrl", () => {
  it("strips Prisma-only parameters that libpq rejects", () => {
    // pg_dump fails outright on `?schema=public` — "invalid URI query
    // parameter" — which is how the first dr:verify run died.
    expect(libpqUrl("postgresql://u:p@localhost:5432/db?schema=public")).toBe("postgresql://u:p@localhost:5432/db");
    expect(libpqUrl("postgresql://u:p@h:5432/db?connection_limit=5&pool_timeout=10")).toBe(
      "postgresql://u:p@h:5432/db",
    );
  });

  it("keeps parameters libpq does understand", () => {
    const result = libpqUrl("postgresql://u:p@h:5432/db?schema=public&sslmode=require&connect_timeout=10");
    expect(result).toContain("sslmode=require");
    expect(result).toContain("connect_timeout=10");
    expect(result).not.toContain("schema=");
  });

  it("leaves a URL with nothing to strip unchanged", () => {
    expect(libpqUrl("postgresql://u:p@localhost:5432/db")).toBe("postgresql://u:p@localhost:5432/db");
  });

  it("preserves credentials, host, port and database name", () => {
    const parsed = new URL(libpqUrl("postgresql://user:pass@db.example.com:6543/prod?schema=public"));
    expect(parsed.username).toBe("user");
    expect(parsed.password).toBe("pass");
    expect(parsed.hostname).toBe("db.example.com");
    expect(parsed.port).toBe("6543");
    expect(parsed.pathname).toBe("/prod");
  });
});
