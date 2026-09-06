/**
 * The Extrovert Review-Loop **open contract** (HITL D14, spec §11) - MCP mirror.
 *
 * The MCP server is a thin, stateless mirror of the agent plane; this module
 * mirrors the SDK's published contract surface so an MCP host pins the SAME
 * provisional 0.x version + manifest the SDK and openapi do. It defines no new
 * wire shapes - the §11 shapes already live in `./types` (ReviewIntent,
 * ReviewFeedback, Rule, ReviewEvent, …); here we name the `diff_json` object and
 * publish the version + manifest.
 *
 * D14: this is an SDK + skill contract, versioned WITH the SDK - NOT a wire
 * protocol and NOT a standalone protocol endpoint. {@link CONTRACT_VERSION} is a
 * PROVISIONAL, pre-1.0 (0.x) version aligned to the SDK package version, the MCP
 * `SERVER_VERSION`, and the openapi `info.version`.
 */

/**
 * One structured hunk of a `diff_json` (spec §11 "Diff (`diff_json`)"). A single
 * deterministic field change computed server-side in Go ($0 LLM).
 */
export interface DiffHunk {
  field: string;
  op: string;
  before?: string;
  after?: string;
}

/**
 * §11 "Diff (`diff_json`)". The structured proposed-vs-sent diff computed
 * deterministically in Go ($0 LLM). The named publication of the `diff_json`
 * object on `ReviewFeedback` / `ReviewTurn` (which keep their permissive
 * `Record<string, unknown>` wire type for back-compat).
 */
export interface DiffJson {
  fields_changed: string[];
  hunks: DiffHunk[];
}

// ---------------------------------------------------------------------------
// §11 CORE - re-export the canonical MCP types (mirrors the SDK contract.ts).
//
// These re-exports give the CONTRACT_MANIFEST.shapes names a COMPILE-TIME link to
// the actual MCP types in ./types: if a §11 type is renamed/removed in ./types,
// `tsc --noEmit` breaks here (and the contract.test.ts goldens-into-types test).
// Without them the manifest's shape names are inert strings and a renamed MCP type
// would NOT break the MCP build. The MCP type names match the spec verbatim
// (ReviewIntent / ReviewFeedback / Rule / ReviewEvent), so no aliasing is needed.
// ---------------------------------------------------------------------------
export type { ReviewIntent, ReviewFeedback, Rule, ReviewEvent } from "./types.js";
export type {
  CommerceBlocker,
  DomainQuote,
  CommerceRequestKind,
  CommerceRequest,
} from "./types.js";

/**
 * The published version of the Extrovert Review-Loop open contract (D14).
 * `0.1.0-pre.16` - PROVISIONAL, pre-1.0; aligned to the SDK package version + the MCP
 * `SERVER_VERSION` + the openapi `info.version`.
 */
export const CONTRACT_VERSION = "0.1.0-pre.16" as const;

/** The stability posture of a published contract version. */
export type ContractStability = "provisional" | "stable";

/** The machine-readable manifest of the open contract (D14) - mirrors the SDK. */
export interface ContractManifest {
  readonly name: "extrovert.review-loop";
  readonly version: string;
  readonly stability: ContractStability;
  readonly kind: "sdk+skill-contract";
  readonly spec_ref: "hitl-spec.md#11";
  readonly core_shapes: readonly string[];
  readonly shapes: readonly string[];
  readonly skills: readonly string[];
}

/**
 * The published manifest. Mirrors the SDK `CONTRACT_MANIFEST` (the MCP surface is
 * a subset of the SDK's, so `shapes` lists the agent-plane shapes the MCP server
 * actually returns). `core_shapes` is the five canonical §11 shapes.
 */
export const CONTRACT_MANIFEST: ContractManifest = {
  name: "extrovert.review-loop",
  version: CONTRACT_VERSION,
  stability: "provisional",
  kind: "sdk+skill-contract",
  spec_ref: "hitl-spec.md#11",
  core_shapes: ["ReviewIntent", "ReviewFeedback", "DiffJson", "Rule", "ReviewEvent"],
  shapes: [
    // §11 core
    "ReviewIntent",
    "ReviewFeedback",
    "ReviewFeedbackComment",
    "DiffJson",
    "DiffHunk",
    "Rule",
    "ReviewEvent",
    // submit / states (M1/M2)
    "ReviewMode",
    "ReviewState",
    "Review",
    "ReviewTurn",
    "SubmitForReviewResult",
    "QueuedForReviewResult",
    "SentResult",
    // realtime (M3)
    "ReviewEventReason",
    "ReviewEventsResult",
    "LearnReviewRuleRequest",
    "LearnedReviewRule",
    "ReviewEventCursor",
    // category registry (M4)
    "Category",
    // graduation + risk dial (M6)
    "AccountRiskDial",
    "EffectiveRiskDial",
    "CategoryRiskDial",
    "RiskDial",
    "GraduationStatus",
    // reconciliation + pacing (M7)
    "ScanBacklogStatus",
    "CategoryPacingState",
    "PacingItem",
    // rules + audit (M4) - "Rule" is already listed in the §11-core block above.
    "RuleAuditEntry",
    // BYO reviewer decision (M8)
    "ReviewerAction",
    "ReviewDecisionContext",
    "ReviewerDecisionResult",
    // agent commerce request plane
    "CommerceBlocker",
    "DomainQuote",
    "CommerceRequestKind",
    "CommerceRequest",
  ],
  // The complete Review Loop behavior lives in the send skill; writing-rule
  // governance remains independently installable and part of this contract.
  skills: ["extrovert-send-email", "extrovert-writing-rules"],
} as const;

export type { LearnReviewRuleRequest, LearnedReviewRule } from "./types.js";
