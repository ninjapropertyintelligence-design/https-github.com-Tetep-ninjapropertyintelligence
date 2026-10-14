import { logEvent } from "@/lib/observability";

/**
 * Outbound email.
 *
 * One small provider contract, the same shape as the other integrations: the
 * call sites say what to send, and which service carries it is configuration.
 *
 * - "resend"  — Resend's HTTP API. Plain `fetch`, no SDK: one endpoint is all
 *               this needs, and a dependency for it would be weight with no
 *               behaviour behind it.
 * - "log"     — writes the whole message to the server log. For development,
 *               where a developer has to be able to click a reset link without
 *               an email account. Never the default in production: a reset
 *               link in a log is a credential in a log.
 * - "none"    — drops the message and records that it did. The production
 *               default when no provider is configured, so a missing API key
 *               is a visible warning rather than a silent leak or a crash.
 *
 * Choice: EMAIL_PROVIDER if set; otherwise "resend" when RESEND_API_KEY is
 * present; otherwise "log" outside production and "none" in it.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      }),
    });
    if (!res.ok) {
      // Resend's error body names the problem ("domain is not verified"),
      // which is the one thing an operator needs from this failure.
      const detail = await res.text().catch(() => "");
      throw new Error(`Resend responded ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
    }
  }
}

export class LogEmailProvider implements EmailProvider {
  readonly name = "log";

  async send(message: EmailMessage): Promise<void> {
    console.log(`[email] to=${message.to} subject=${JSON.stringify(message.subject)}\n${message.text}`);
  }
}

export class NoEmailProvider implements EmailProvider {
  readonly name = "none";

  async send(): Promise<void> {
    // Intentionally nothing. `sendEmail` records the drop.
  }
}

let override: EmailProvider | null = null;

/** Tests swap in a recording provider; null restores the configured one. */
export function setEmailProviderForTesting(provider: EmailProvider | null) {
  override = provider;
}

export function getEmailProvider(): EmailProvider {
  if (override) return override;

  const configured = process.env.EMAIL_PROVIDER?.trim().toLowerCase();
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const choice = configured || (apiKey ? "resend" : process.env.NODE_ENV === "production" ? "none" : "log");

  switch (choice) {
    case "resend":
      if (!apiKey) return new NoEmailProvider();
      return new ResendEmailProvider(apiKey, emailFromAddress());
    case "log":
      return new LogEmailProvider();
    default:
      return new NoEmailProvider();
  }
}

export function emailFromAddress(): string {
  return process.env.EMAIL_FROM?.trim() || "Property Intelligence <no-reply@example.com>";
}

/**
 * The public origin links in emails point at. A link has to work from
 * someone's inbox, so it can never be a relative path.
 */
export function appBaseUrl(): string {
  const raw = process.env.APP_URL?.trim() || process.env.NEXTAUTH_URL?.trim() || "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

/**
 * Sends one message and reports whether it went. Never throws: every caller
 * is doing something more important than the email (resetting a password,
 * recording a review decision), and a mail outage must not fail that.
 */
export async function sendEmail(message: EmailMessage): Promise<boolean> {
  const provider = getEmailProvider();
  const startedAt = Date.now();
  if (provider.name === "none") {
    logEvent("email.send", {
      ok: false,
      provider: provider.name,
      errorMessage: "No email provider configured (set RESEND_API_KEY); message dropped",
      subject: message.subject,
    });
    return false;
  }
  try {
    await provider.send(message);
    logEvent("email.send", { ok: true, provider: provider.name, durationMs: Date.now() - startedAt });
    return true;
  } catch (err) {
    logEvent("email.send", {
      ok: false,
      provider: provider.name,
      durationMs: Date.now() - startedAt,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
