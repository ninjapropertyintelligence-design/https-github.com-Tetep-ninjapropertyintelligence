import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { verifyMfaCode } from "@/lib/mfa-service";
import { AUTH_RULE, checkRateLimit, clientIpFromRequest, resetRateLimit } from "@/lib/rate-limit";

/**
 * Authentication: email + password, optional TOTP second factor (spec §43),
 * JWT sessions. SSO (Enterprise plan, feature flag `enterprise_sso`) plugs
 * in here later as an additional provider without touching the rest of the
 * app, because everything downstream reads from the same `session.user`
 * shape.
 *
 * The MFA step is signalled back to the login form through a distinguishable
 * error code rather than a separate "does this account have MFA?" endpoint —
 * that endpoint would be a password oracle, and this way there is exactly one
 * place where a password is checked.
 */

/**
 * A valid bcrypt hash of a string nothing will ever match, used to keep the
 * unknown-account path as expensive as the wrong-password path (measured:
 * ~76ms vs ~79ms at cost factor 10).
 */
const DUMMY_PASSWORD_HASH = "$2b$10$py.N9nKbay68EIdKuZ3DQekybmP8ajzV3XfSC4wMztCucmERYR7qu";

/** Password was correct, but a TOTP/recovery code is still needed. */
class MfaRequiredError extends CredentialsSignin {
  code = "mfa_required";
}

/** A code was supplied and it was wrong or already used. */
class MfaInvalidError extends CredentialsSignin {
  code = "mfa_invalid";
}

/** Too many attempts against this account or from this address. */
class TooManyAttemptsError extends CredentialsSignin {
  code = "too_many_attempts";
}

/**
 * Two keys per attempt: one per account (an attacker cannot escape it by
 * rotating IPs) and one per source address (a single host cannot spray many
 * accounts). Either tripping is enough to refuse.
 */
function rateLimitKeys(email: string, req: Request | undefined): string[] {
  const keys = [`login:email:${email}`];
  if (req) keys.push(`login:ip:${clientIpFromRequest(req)}`);
  return keys;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  /**
   * NextAuth refuses to honour the request's Host header in production unless
   * told to, and fails the whole auth flow with `UntrustedHost` when it is not.
   * Development trusts it implicitly, which is why this never surfaced locally
   * or in the e2e suite — both run `next dev`. The first production build to
   * serve a login rejected every attempt.
   *
   * Trusting the host is correct for a platform deployed behind a host we
   * control (Vercel and equivalents terminate TLS and set Host from the real
   * request). `AUTH_TRUST_HOST` is honoured as an override so an operator can
   * turn it off for a deployment sitting behind a proxy they do not trust,
   * where the header really can be forged.
   */
  trustHost: (process.env.AUTH_TRUST_HOST ?? "true") !== "false",
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        mfaCode: { label: "Authentication code", type: "text" },
      },
      async authorize(credentials, request) {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") {
          return null;
        }
        const normalizedEmail = email.toLowerCase().trim();
        const mfaCode = typeof credentials?.mfaCode === "string" ? credentials.mfaCode.trim() : "";

        const keys = rateLimitKeys(normalizedEmail, request);
        if (keys.some((key) => !checkRateLimit(key, AUTH_RULE).allowed)) {
          await recordFailedLogin(normalizedEmail, "rate_limited", request);
          throw new TooManyAttemptsError();
        }

        const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (!user || !user.isActive) {
          // Compare against a real hash of an unguessable string so an
          // unknown account costs the same bcrypt work as a wrong password
          // and cannot be distinguished by response time.
          await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
          await recordFailedLogin(normalizedEmail, "unknown_or_inactive_user", request);
          return null;
        }

        if (!(await bcrypt.compare(password, user.passwordHash))) {
          await recordFailedLogin(normalizedEmail, "bad_password", request, user.id);
          return null;
        }

        if (user.mfaEnabledAt) {
          if (!mfaCode) throw new MfaRequiredError();
          const result = await verifyMfaCode({ userId: user.id, code: mfaCode });
          if (!result.ok) {
            await recordFailedLogin(normalizedEmail, "bad_mfa_code", request, user.id);
            throw new MfaInvalidError();
          }
        }

        // Only a fully successful authentication clears the counters, so a
        // password-correct-but-MFA-failing attempt still consumes budget.
        for (const key of keys) resetRateLimit(key);

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) {
        token.userId = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && typeof token.userId === "string") {
        session.user.id = token.userId;
      }
      return session;
    },
  },
  events: {
    // Spec §44 requires login and logout in the audit trail.
    async signIn({ user }) {
      if (user?.id) await recordAuthEvent(user.id, "login");
    },
    async signOut(message) {
      const userId =
        "token" in message && typeof message.token?.userId === "string" ? message.token.userId : null;
      if (userId) await recordAuthEvent(userId, "logout");
    },
  },
});

/**
 * Audit writes must never be able to fail a login — an unavailable audit
 * table would otherwise become an authentication outage. Failures are
 * logged to the process log, which is itself collected (lib/observability).
 */
async function safeAudit(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    console.error("Failed to write auth audit log", err);
  }
}

async function recordAuthEvent(userId: string, action: "login" | "logout") {
  await safeAudit(async () => {
    const membership = await prisma.membership.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { organizationId: true },
    });
    await writeAuditLog({
      organizationId: membership?.organizationId ?? null,
      actorUserId: userId,
      action,
      entityType: "User",
      entityId: userId,
    });
  });
}

/**
 * Failed attempts are recorded with the *reason*, because "many
 * bad_password rows for one email" and "many unknown_or_inactive_user rows
 * from one address" are different attacks and a security reviewer needs to
 * tell them apart. The submitted password is never recorded.
 */
async function recordFailedLogin(
  email: string,
  reason: string,
  request: Request | undefined,
  userId?: string,
) {
  await safeAudit(async () => {
    const membership = userId
      ? await prisma.membership.findFirst({ where: { userId }, orderBy: { createdAt: "asc" }, select: { organizationId: true } })
      : null;
    await prisma.auditLog.create({
      data: {
        organizationId: membership?.organizationId ?? null,
        actorUserId: userId ?? null,
        action: "login.failed",
        entityType: "User",
        entityId: userId,
        metadata: { email, reason },
        ipAddress: request ? clientIpFromRequest(request) : null,
      },
    });
  });
}
