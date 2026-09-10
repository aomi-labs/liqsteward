import {
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const navPolicies = pgTable(
  "nav_policies",
  {
    id: serial("id").primaryKey(),
    policyId: text("policy_id").notNull(),
    version: integer("version").notNull(),
    digest: text("digest").notNull(),
    vault: text("vault").notNull(),
    body: jsonb("body").notNull(),
    uploadedBy: text("uploaded_by").notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("nav_policies_id_version").on(table.policyId, table.version)],
);

export const navDags = pgTable("nav_dags", {
  dagId: text("dag_id").primaryKey(),
  aomiSessionId: text("aomi_session_id").notNull(),
  vaultChainId: integer("vault_chain_id").notNull(),
  vaultAddress: text("vault_address").notNull(),
  vaultLabel: text("vault_label").notNull(),
  pinBlock: integer("pin_block").notNull(),
  pinBlockHash: text("pin_block_hash").notNull(),
  pinnedAt: timestamp("pinned_at", { withTimezone: true }).notNull(),
  policyId: text("policy_id").notNull(),
  policyVersion: integer("policy_version").notNull(),
  policyDigest: text("policy_digest").notNull(),
  phase: text("phase").notNull(),
  parentDagId: text("parent_dag_id"),
  world: jsonb("world"),
  plan: jsonb("plan"),
  baseAsset: jsonb("base_asset"),
  status: text("status").notNull(),
  rootNodeIds: jsonb("root_node_ids").notNull(),
  dagDigest: text("dag_digest"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const navNodes = pgTable(
  "nav_nodes",
  {
    dagId: text("dag_id").notNull(),
    nodeId: text("node_id").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    unresolved: jsonb("unresolved"),
    chainId: integer("chain_id").notNull(),
    contract: text("contract").notNull(),
    account: text("account").notNull(),
    marketId: text("market_id"),
    quantity: jsonb("quantity"),
    semantic: jsonb("semantic").notNull(),
    boundary: jsonb("boundary").notNull(),
    evidence: jsonb("evidence").notNull(),
    valuation: jsonb("valuation"),
    postedViews: jsonb("posted_views").notNull(),
    childHints: jsonb("child_hints").notNull(),
    expectedReads: jsonb("expected_reads"),
    stage: integer("stage").notNull(),
    attempts: integer("attempts").notNull(),
    discoveredBy: text("discovered_by").notNull(),
    writtenAt: timestamp("written_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.dagId, table.nodeId] })],
);

export const navEdges = pgTable(
  "nav_edges",
  {
    dagId: text("dag_id").notNull(),
    parent: text("parent").notNull(),
    child: text("child").notNull(),
    relation: text("relation").notNull(),
  },
  (table) => [primaryKey({ columns: [table.dagId, table.parent, table.child] })],
);

export const navReports = pgTable("nav_reports", {
  dagId: text("dag_id").primaryKey(),
  body: jsonb("body").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const navBreaks = pgTable("nav_breaks", {
  breakId: text("break_id").primaryKey(),
  dagId: text("dag_id").notNull(),
  status: text("status").notNull(),
  body: jsonb("body").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const navEvents = pgTable("nav_events", {
  seq: serial("seq").primaryKey(),
  dagId: text("dag_id").notNull(),
  name: text("name").notNull(),
  data: jsonb("data").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});
