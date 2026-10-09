import { afterEach, describe, expect, it, vi } from "vitest";
import { ResendEmailProvider, appBaseUrl, getEmailProvider, sendEmail, setEmailProviderForTesting } from "@/lib/email";

describe("choosing a provider", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function configured() {
    // The test setup installs a silent override; this asks what the
    // environment alone would choose.
    setEmailProviderForTesting(null);
    try {
      return getEmailProvider().name;
    } finally {
      setEmailProviderForTesting({ name: "silent", send: async () => {} });
    }
  }

  it("uses Resend when an API key is set", () => {
    vi.stubEnv("EMAIL_PROVIDER", "");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    expect(configured()).toBe("resend");
  });

  it("never writes messages to the log in production by default", () => {
    vi.stubEnv("EMAIL_PROVIDER", "");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(configured()).toBe("none");
  });

  it("logs messages in development so reset links can be clicked", () => {
    vi.stubEnv("EMAIL_PROVIDER", "");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(configured()).toBe("log");
  });

  it("does not claim Resend without a key", () => {
    vi.stubEnv("EMAIL_PROVIDER", "resend");
    vi.stubEnv("RESEND_API_KEY", "");
    expect(configured()).toBe("none");
  });

  it("builds links from APP_URL without a trailing slash", () => {
    vi.stubEnv("APP_URL", "https://app.example.com/");
    expect(appBaseUrl()).toBe("https://app.example.com");
  });
});

describe("the Resend provider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the message with the API key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await new ResendEmailProvider("re_key", "Ops <ops@example.com>").send({
      to: "pat@example.com",
      subject: "Hello",
      text: "Body",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.Authorization).toBe("Bearer re_key");
    expect(JSON.parse(init.body)).toMatchObject({ from: "Ops <ops@example.com>", to: ["pat@example.com"], subject: "Hello" });
  });

  it("reports a rejected send as not sent, without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("domain not verified", { status: 403 })));
    setEmailProviderForTesting(new ResendEmailProvider("re_key", "a@example.com"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(sendEmail({ to: "pat@example.com", subject: "x", text: "y" })).resolves.toBe(false);
      expect(errorSpy.mock.calls[0][0]).toContain("domain not verified");
    } finally {
      errorSpy.mockRestore();
      setEmailProviderForTesting({ name: "silent", send: async () => {} });
    }
  });
});
