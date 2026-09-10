import { afterEach, describe, expect, it, vi } from "vitest";

const { Pool } = vi.hoisted(() => ({ Pool: vi.fn(function () { return { end: vi.fn() }; }) }));
vi.mock("pg", () => ({ default: { Pool } }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: vi.fn(() => ({})) }));
import { createNavDb } from "./db.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("NAV database TLS configuration", () => {
  it("keeps the supplied CA and certificate verification when the URL has SSL options", () => {
    vi.stubEnv("DATABASE_CA_CERT", "test-ca");
    createNavDb("postgresql://user:password@db.example/postgres?sslmode=verify-full&application_name=steward");
    expect(Pool).toHaveBeenCalledWith({
      connectionString: "postgresql://user:password@db.example/postgres?application_name=steward",
      ssl: { ca: "test-ca", rejectUnauthorized: true },
      max: 4,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 20_000,
    });
  });

  it("preserves URL-driven TLS when no custom CA is configured", () => {
    vi.stubEnv("DATABASE_CA_CERT", "");
    const url = "postgresql://user:password@db.example/postgres?sslmode=verify-full";
    createNavDb(url);
    expect(Pool).toHaveBeenCalledWith({ connectionString: url, max: 4, connectionTimeoutMillis: 10_000, statement_timeout: 20_000 });
  });

  it("does not require TLS for an unconfigured local development database", () => {
    vi.stubEnv("DATABASE_CA_CERT", "");
    createNavDb("postgresql://localhost:5432/liqsteward");
    expect(Pool).toHaveBeenCalledWith({ connectionString: "postgresql://localhost:5432/liqsteward", max: 4, connectionTimeoutMillis: 10_000, statement_timeout: 20_000 });
  });
});
