/**
 * Thin typed bridge to the deployer pipeline that lives in ../../static/pipeline.js —
 * the same module the Node tests use, so the page and the tests can never drift apart.
 */
// @ts-expect-error — plain ESM module shared with the Node tests (no type declarations)
import * as pipeline from "../../../static/pipeline.js";

export interface Account {
  id: string;
  name: string;
}

export interface DeployResult {
  name: string;
  url: string;
  loginUrl: string;
  apiBaseUrl: string;
  health: string;
  status: number;
  accountId: string;
  release: string;
  password: string;
  streamed?: boolean;
  dryRun?: boolean;
}

export type PipelineEvent =
  | { type: "step"; id: string; state: "active" | "done" | "error"; note?: string }
  | { type: "event"; key: string; data: Record<string, unknown> }
  | { type: "progress"; id: string; received: number; total: number }
  | { type: "result"; result: DeployResult };

export interface DeployOptions {
  cfToken: string;
  accountId: string;
  name: string;
  subdomain: string;
  jwtSecret: string;
  password: string;
  release?: string;
  dryRun?: boolean;
  foregroundMs?: number;
  onEvent?: (event: PipelineEvent) => void;
}

export const runDeploy = pipeline.runDeploy as (options: DeployOptions) => Promise<DeployResult>;
export const listAccounts = pipeline.listAccounts as (options: {
  cfToken: string;
}) => Promise<{ accounts: Account[] }>;
export const getSubdomain = pipeline.getSubdomain as (options: {
  cfToken: string;
  accountId: string;
  set?: string;
}) => Promise<{ subdomain: string | null }>;
export const DeployError = pipeline.DeployError as new (message: string, status?: number) => Error;
