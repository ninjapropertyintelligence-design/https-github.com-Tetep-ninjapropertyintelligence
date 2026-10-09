import { config } from "dotenv";

config({ path: ".env" });

// Integration tests must never run against the dev database.
if (process.env.DATABASE_URL_TEST) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
}

// No test sends real email, and none should fill the output with the "log"
// provider's message bodies. Tests that care what was sent install their own
// recording provider with `setEmailProviderForTesting`.
import { setEmailProviderForTesting } from "@/lib/email";
setEmailProviderForTesting({ name: "silent", send: async () => {} });
