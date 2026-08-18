import { config } from "dotenv";

config({ path: ".env" });

// Integration tests must never run against the dev database.
if (process.env.DATABASE_URL_TEST) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
}
