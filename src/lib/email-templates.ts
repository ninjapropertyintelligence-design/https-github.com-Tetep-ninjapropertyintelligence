import type { EmailMessage } from "@/lib/email";

/**
 * Every email this product sends. Plain text first — it is what arrives intact
 * in every client — with a minimal HTML version alongside. Anything that came
 * from a user (a name, an issue title, a rejection reason) is escaped before
 * it goes into HTML.
 */

const PRODUCT_NAME = "Property Intelligence";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function layout(paragraphs: string[], action?: { label: string; url: string }, footerHtml = ""): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px">${escapeHtml(p)}</p>`).join("");
  const button = action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="background:#2563eb;color:#ffffff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">${escapeHtml(action.label)}</a></p>` +
      `<p style="margin:0 0 16px;font-size:12px;color:#6b7280">Or paste this link into your browser:<br>${escapeHtml(action.url)}</p>`
    : "";
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827;font-size:14px;line-height:1.5"><div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px">${body}${button}<p style="margin:24px 0 0;font-size:12px;color:#6b7280">${PRODUCT_NAME}${footerHtml}</p></div></body></html>`;
}

export function passwordResetEmail(params: { to: string; name: string; resetUrl: string; expiresInMinutes: number }): EmailMessage {
  const lines = [
    `Hi ${params.name},`,
    `Someone asked to reset the password for your ${PRODUCT_NAME} account. If it was you, use the link below to choose a new one. It works once and expires in ${params.expiresInMinutes} minutes.`,
    "If you did not ask for this, you can ignore this email. Your password has not changed.",
  ];
  return {
    to: params.to,
    subject: `Reset your ${PRODUCT_NAME} password`,
    text: [lines[0], "", lines[1], "", params.resetUrl, "", lines[2]].join("\n"),
    html: layout(lines, { label: "Choose a new password", url: params.resetUrl }),
  };
}

export function passwordChangedEmail(params: { to: string; name: string; loginUrl: string }): EmailMessage {
  const lines = [
    `Hi ${params.name},`,
    `The password for your ${PRODUCT_NAME} account was just changed, and every device that was signed in has been signed out.`,
    "If you did not do this, reset your password straight away and tell your administrator.",
  ];
  return {
    to: params.to,
    subject: `Your ${PRODUCT_NAME} password was changed`,
    text: [lines[0], "", lines[1], "", lines[2], "", params.loginUrl].join("\n"),
    html: layout(lines, { label: "Sign in", url: params.loginUrl }),
  };
}

/** The email copy of an in-app notification. */
export function notificationEmail(params: {
  to: string;
  name: string;
  title: string;
  body?: string | null;
  url?: string | null;
  /** Where the recipient can turn this kind of email off. */
  settingsUrl?: string | null;
}): EmailMessage {
  const lines = [`Hi ${params.name},`, params.title, ...(params.body ? [params.body] : [])];
  const footerText = params.settingsUrl ? `Choose which emails you get: ${params.settingsUrl}` : null;
  return {
    to: params.to,
    subject: params.title,
    text: [...lines.flatMap((l) => [l, ""]), ...(params.url ? [params.url, ""] : []), ...(footerText ? [footerText] : [])]
      .join("\n")
      .trimEnd(),
    html: layout(
      lines,
      params.url ? { label: "Open in " + PRODUCT_NAME, url: params.url } : undefined,
      params.settingsUrl
        ? ` · <a href="${escapeHtml(params.settingsUrl)}" style="color:#6b7280">Choose which emails you get</a>`
        : "",
    ),
  };
}

export function invitationEmail(params: {
  to: string;
  inviterName: string;
  organizationName: string;
  roleLabel: string;
  acceptUrl: string;
  expiresInDays: number;
}): EmailMessage {
  const lines = [
    "Hi,",
    `${params.inviterName} has invited you to join ${params.organizationName} on ${PRODUCT_NAME} as ${params.roleLabel}.`,
    `Use the link below to accept. It expires in ${params.expiresInDays} days.`,
    "If you were not expecting this, you can ignore this email.",
  ];
  return {
    to: params.to,
    subject: `${params.inviterName} invited you to ${params.organizationName}`,
    text: [lines[0], "", lines[1], "", lines[2], "", params.acceptUrl, "", lines[3]].join("\n"),
    html: layout(lines, { label: "Accept invitation", url: params.acceptUrl }),
  };
}

export function roleChangedEmail(params: {
  to: string;
  name: string;
  organizationName: string;
  roleLabel: string;
  changedBy: string;
  appUrl: string;
}): EmailMessage {
  const lines = [
    `Hi ${params.name},`,
    `${params.changedBy} changed your access in ${params.organizationName}. You are now ${params.roleLabel}.`,
    "What you can see and do has changed to match. If this looks wrong, contact your administrator.",
  ];
  return {
    to: params.to,
    subject: `Your access in ${params.organizationName} changed`,
    text: [lines[0], "", lines[1], "", lines[2], "", params.appUrl].join("\n"),
    html: layout(lines, { label: "Open " + PRODUCT_NAME, url: params.appUrl }),
  };
}

export function removedFromOrganizationEmail(params: {
  to: string;
  name: string;
  organizationName: string;
  removedBy: string;
}): EmailMessage {
  const lines = [
    `Hi ${params.name},`,
    `${params.removedBy} removed you from ${params.organizationName} on ${PRODUCT_NAME}. You no longer have access to its properties.`,
    "If you think this is a mistake, contact your administrator.",
  ];
  return {
    to: params.to,
    subject: `You were removed from ${params.organizationName}`,
    text: lines.join("\n\n"),
    html: layout(lines),
  };
}
