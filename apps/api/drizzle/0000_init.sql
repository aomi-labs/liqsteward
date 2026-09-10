CREATE TABLE "nav_breaks" (
	"break_id" text PRIMARY KEY NOT NULL,
	"dag_id" text NOT NULL,
	"status" text NOT NULL,
	"body" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nav_dags" (
	"dag_id" text PRIMARY KEY NOT NULL,
	"aomi_session_id" text NOT NULL,
	"vault_chain_id" integer NOT NULL,
	"vault_address" text NOT NULL,
	"vault_label" text NOT NULL,
	"pin_block" integer NOT NULL,
	"pin_block_hash" text NOT NULL,
	"pinned_at" timestamp with time zone NOT NULL,
	"policy_id" text NOT NULL,
	"policy_version" integer NOT NULL,
	"policy_digest" text NOT NULL,
	"phase" text NOT NULL,
	"parent_dag_id" text,
	"world" jsonb,
	"plan" jsonb,
	"base_asset" jsonb,
	"status" text NOT NULL,
	"root_node_ids" jsonb NOT NULL,
	"dag_digest" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nav_edges" (
	"dag_id" text NOT NULL,
	"parent" text NOT NULL,
	"child" text NOT NULL,
	"relation" text NOT NULL,
	CONSTRAINT "nav_edges_dag_id_parent_child_pk" PRIMARY KEY("dag_id","parent","child")
);
--> statement-breakpoint
CREATE TABLE "nav_events" (
	"seq" serial PRIMARY KEY NOT NULL,
	"dag_id" text NOT NULL,
	"name" text NOT NULL,
	"data" jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nav_nodes" (
	"dag_id" text NOT NULL,
	"node_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"unresolved" jsonb,
	"chain_id" integer NOT NULL,
	"contract" text NOT NULL,
	"account" text NOT NULL,
	"market_id" text,
	"quantity" jsonb,
	"semantic" jsonb NOT NULL,
	"boundary" jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"valuation" jsonb,
	"posted_views" jsonb NOT NULL,
	"child_hints" jsonb NOT NULL,
	"expected_reads" jsonb,
	"stage" integer NOT NULL,
	"attempts" integer NOT NULL,
	"discovered_by" text NOT NULL,
	"written_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nav_nodes_dag_id_node_id_pk" PRIMARY KEY("dag_id","node_id")
);
--> statement-breakpoint
CREATE TABLE "nav_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"policy_id" text NOT NULL,
	"version" integer NOT NULL,
	"digest" text NOT NULL,
	"vault" text NOT NULL,
	"body" jsonb NOT NULL,
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nav_reports" (
	"dag_id" text PRIMARY KEY NOT NULL,
	"body" jsonb NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "nav_policies_id_version" ON "nav_policies" USING btree ("policy_id","version");