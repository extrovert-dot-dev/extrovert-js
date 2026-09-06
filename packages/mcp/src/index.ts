/**
 * Public library surface for `@extrovert.dev/mcp`.
 *
 * Import this when embedding the Extrovert MCP server in another process, or to
 * reuse the typed client / extraction helpers directly.
 */

export { createExtrovertServer, type CreateExtrovertServerOptions } from "./server.js";
export { runStdio } from "./stdio.js";
export {
  createHttpApp,
  runHttp,
  type CreateHttpAppOptions,
  type HttpApp,
  type HttpServerOptions,
} from "./http.js";
export {
  createHostedTokenVerifier,
  discoverOAuthMetadata,
  ExtrovertTokenVerifier,
  loadHostedAuthConfig,
  type ExtrovertTokenVerifierOptions,
  type HostedAuthConfig,
} from "./auth.js";

export {
  ExtrovertClient,
  ExtrovertApiError,
  type CreateInboxInput,
  type UpdateInboxInput,
  type SendEmailInput,
  type ReplyEmailInput,
  type WaitForEmailInput,
  type RedeemEnrollmentInput,
  type DurableCredentialPersistenceStatus,
  type ExtrovertClientOptions,
} from "./client.js";

export {
  createCredentialStore,
  credentialPaths,
  credentialFingerprint,
  type CredentialPaths,
  type CredentialStore,
  type PendingSignup,
  type StoredCredential,
  type OAuthCredentialInput,
  type PendingOAuth,
} from "./credentials.js";
export { createLocalCredentialProvider, logoutLocalCredential, type LocalCredentialProviderOptions, type LocalLogoutResult } from "./local-oauth.js";

export { loadConfig, SERVER_NAME, SERVER_VERSION, type ExtrovertConfig } from "./config.js";
export { registerTools, TOOL_NAMES } from "./tools.js";
export { extractOtpCode, extractVerificationLink, extractSignals } from "./extract.js";

// Open contract (HITL D14) - the published, versioned Review-Loop surface. The
// MCP server mirrors the SDK contract: same provisional 0.x version + manifest so
// an MCP host can pin it. Not a wire protocol (D14).
export { CONTRACT_VERSION, CONTRACT_MANIFEST } from "./contract.js";
export type { ContractManifest, ContractStability, DiffJson, DiffHunk } from "./contract.js";

export type {
  Inbox,
  AgentScope,
  Message,
  Thread,
  Address,
  EnrollmentResult,
  WaitForEmailResult,
  Page,
  OnboardingMode,
  InboxStatus,
  MessageDirection,
} from "./types.js";

export type { LearnReviewRuleRequest, LearnedReviewRule } from "./types.js";
export type { ReviewWorkflow } from "./review-workflow.js";
