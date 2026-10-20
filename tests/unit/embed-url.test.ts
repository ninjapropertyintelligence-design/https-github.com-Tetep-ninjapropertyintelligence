import { describe, expect, it } from "vitest";
import { embedUrlProblem, opensInNewTab } from "@/lib/embed-url";

describe("embedUrlProblem", () => {
  it("accepts a Matterport share link and any https viewer", () => {
    expect(embedUrlProblem("MATTERPORT", "https://my.matterport.com/show/?m=abc123")).toBeNull();
    expect(embedUrlProblem("POINT_CLOUD", "https://bucket.s3.amazonaws.com/potree/index.html")).toBeNull();
  });

  it("refuses plain http, credentials and junk", () => {
    expect(embedUrlProblem("OTHER", "http://viewer.example.com")).toMatch(/https/);
    expect(embedUrlProblem("OTHER", "https://user:pw@viewer.example.com")).toMatch(/username or password/);
    expect(embedUrlProblem("OTHER", "javascript:alert(1)")).toMatch(/https/);
    expect(embedUrlProblem("OTHER", "not a url")).toMatch(/valid link/);
  });

  it("refuses a lookalike Matterport tour", () => {
    expect(embedUrlProblem("MATTERPORT", "https://my.matterport.com.evil.example/show/?m=x")).toMatch(/my.matterport.com\/show/);
    expect(embedUrlProblem("MATTERPORT", "https://my.matterport.com/models/x")).toMatch(/my.matterport.com\/show/);
  });
});

describe("opensInNewTab", () => {
  it("sends BIM viewers to their own tab and frames the rest", () => {
    expect(opensInNewTab("BIM")).toBe(true);
    expect(opensInNewTab("MATTERPORT")).toBe(false);
  });
});
