/**
 * The Extrovert Review-Loop **open contract** (HITL D14, spec §11).
 *
 * This module is the single, documented, *versioned* publication of the stable
 * agent-facing JSON shapes that the Review Loop exposes - the shapes agents and
 * third-party harnesses code against. It does **not** redesign any types: it
 * re-exports the canonical models built across M1–M8 (see `./models`) under one
 * named contract surface, stamps a {@link CONTRACT_VERSION}, and publishes a
 * machine-readable {@link CONTRACT_MANIFEST} so a harness can pin the exact set of
 * shapes + the version it built against.
 *
 * ## This is a contract, NOT a protocol (D14)
 *
 * Per resolved decision **D14**, the open surface is published **now** as an open,
 * documented **skill + SDK contract** - explicitly **not** a wire protocol and
 * **not** a standalone `/v1/contract` endpoint. The contract is exactly: these SDK
 * types + the agent skills (`extrovert-send-email`, `extrovert-writing-rules`) + the
 * docs, **versioned with the SDK** (this package). Formal protocol
 * standardization is deferred (spec §12).
 *
 * ## Provisional, pre-1.0 (0.x)
 *
 * {@link CONTRACT_VERSION} is **`0.1.0-pre.11`** - a deliberately **provisional**, pre-1.0
 * contract. It is open and documented, but it MAY still evolve before 1.0: there
 * are no external users yet, and the **D20 shared-pool auto-send governor** is a
 * hard prerequisite before onboarding external users. Pin the version; expect
 * additive 0.x changes. See {@link CONTRACT_MANIFEST}.`stability`.
 *
 * ## Identity (D10)
 *
 * Every shape keys on **opaque, typed ids** (`rr_`, `turn_`, `cat_`, `rule_`,
 * `rln_`, `ndg_`, …) and never on names. Names/descriptions are mutable display
 * metadata; renaming never breaks a reference. $0-LLM on our side - the contract
 * is pure deterministic JSON; all judgment lives in the agent skills.
 *
 * The canonical example payloads for the §11 core shapes (Intent, ReviewFeedback,
 * DiffJson, Rule, Nudge) are the conformance golden fixtures - see
 * `golang/internal/extrovertapi/testdata/contract/` and the SDK
 * `contract.test.ts` (both assert these examples parse/validate without loss).
 *
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// §11 CORE - the canonical shapes, named verbatim from the spec.
//
// Four of the five §11 core shapes already exist as M1–M8 model types; we
// re-export them here under their canonical names (NOT redefinitions), so the
// existing tests + the openapi component schemas stay the single source of truth.
// ---------------------------------------------------------------------------

/** §11 "Intent (submit time)". The agent's for-the-reviewer summary (D3). */
export type { ReviewIntent } from "./models.js";
/** §11 "Feedback". Returned by `get_review_feedback`. */
export type { ReviewFeedback, ReviewFeedbackComment } from "./models.js";
/** §11 "Rule (`get_rules` element)". A learned writing preference. */
export type { Rule } from "./models.js";
/** §11 "Nudge (`list_review_events` element)". A durable liveness nudge. */
export type { ReviewEvent } from "./models.js";

/**
 * One structured hunk of a `diff_json` (spec §11 "Diff (`diff_json`)"). A single
 * deterministic field change computed server-side in Go ($0 LLM). `op` is the
 * change verb; `before`/`after` carry the literal text.
 */
export interface DiffHunk {
  /** The Review field this hunk changed (e.g. `subject`, `body_text`). */
  field: string;
  /** The change verb (e.g. `replace`, `insert`, `delete`). */
  op: string;
  /** The text before the change. */
  before?: string;
  /** The text after the change. */
  after?: string;
}

/**
 * §11 "Diff (`diff_json`)". The structured proposed-vs-sent diff, computed
 * deterministically in Go ($0 LLM). `fields_changed` names the changed Review
 * fields; `hunks` carry the per-field before/after.
 *
 * This is the named publication of the `diff_json` object that already appears
 * (as `diff_json`) on `ReviewFeedback` and `ReviewTurn`; those fields keep their
 * permissive `Record<string, unknown>` wire type for back-compat, and a harness
 * MAY narrow them to this shape.
 */
export interface DiffJson {
  /** The Review fields that changed (e.g. `["subject","body_text"]`). */
  fields_changed: string[];
  /** Per-field structured before/after hunks. */
  hunks: DiffHunk[];
}

// ---------------------------------------------------------------------------
// FULL SURFACE - the rest of the published M1–M8 contract, re-exported as ONE
// provisional-0.x contract (no tiering; D14 "the full built surface").
// ---------------------------------------------------------------------------

export type {
  // submit / states / intent (M1/M2)
  ReviewMode,
  ReviewState,
  Review,
  ReviewTurn,
  SubmitForReviewResult,
  QueuedForReviewResult,
  SentResult,
  // realtime / nudge queue (M3)
  ReviewEventReason,
  ReviewEventsResult,
  ReviewEventCursor,
  // chat / revision / restamp (M5, M7)
  PostReviewChatRequest,
  SubmitRevisionRequest,
  RestampReviewRequest,
  // category registry (M4)
  Category,
  ProposeCategoryRequest,
  UpdateCategoryRequest,
  // graduation + risk dial (M6)
  AccountRiskDial,
  EffectiveRiskDial,
  CategoryRiskDial,
  RiskDial,
  GraduationStatus,
  ProposeGraduationRequest,
  // reconciliation + pacing (M7)
  ScanBacklogStatus,
  CategoryPacingState,
  PacingItem,
  // rules + audit (M4)
  SaveRuleRequest,
  RuleAuditEntry,
  // BYO reviewer decision (M8)
  ReviewerAction,
  ReviewDecisionContext,
  ReviewerDecisionRequest,
  ReviewerDecisionResult,
  // agent commerce request plane
  CommerceBlocker,
  QuoteDomainRequest,
  DomainQuote,
  CommerceRequestKind,
  RequestDomainPurchaseRequest,
  RequestPlanChangeRequest,
  ListCommerceRequestsParams,
  CommerceRequest,
} from "./models.js";

// ---------------------------------------------------------------------------
// Contract version + machine-readable manifest.
// ---------------------------------------------------------------------------

/**
 * The published version of the Extrovert Review-Loop open contract (D14).
 *
 * **`0.1.0-pre.11` - PROVISIONAL, pre-1.0.** Versioned *with the SDK* (this package's
 * `package.json` version) and aligned to the openapi `info.version`. Open and
 * documented, but MAY still evolve before 1.0 (no external users yet; the D20
 * shared-pool governor is required before external users). Pin it.
 */
export const CONTRACT_VERSION = "0.1.0-pre.11" as const;

/** The stability posture of a published contract version. */
export type ContractStability = "provisional" | "stable";

/**
 * The machine-readable manifest of the open contract (D14) - what a harness pins.
 *
 * It enumerates the canonical §11 **core** shapes and the **full** M1–M8 surface
 * by name, stamps {@link CONTRACT_VERSION}, and marks the {@link ContractStability}
 * posture so a consumer can reason about evolution risk. It carries no runtime
 * behavior (M9 adds none - types + a version + a test + docs) and no LLM.
 */
export interface ContractManifest {
  /** Stable contract name (NOT a protocol name - D14). */
  readonly name: "extrovert.review-loop";
  /** The published contract version (== {@link CONTRACT_VERSION}). */
  readonly version: string;
  /**
   * `provisional` (0.x) until the D20 shared-pool governor lands + external users
   * exist. Provisional ⇒ additive evolution before 1.0 is expected.
   */
  readonly stability: ContractStability;
  /**
   * D14: this is an SDK + skill contract, versioned WITH the SDK - never a wire
   * protocol or a standalone protocol endpoint.
   */
  readonly kind: "sdk+skill-contract";
  /** Cross-reference to the spec section that froze these shapes. */
  readonly spec_ref: "hitl-spec.md#11";
  /** The five canonical §11 shapes, named verbatim from the spec. */
  readonly core_shapes: readonly string[];
  /** The full published M1–M8 agent-facing contract surface (one 0.x contract; no tiering). */
  readonly shapes: readonly string[];
  /** The agent skills that are part of the contract (D14 - "skill + SDK"). */
  readonly skills: readonly string[];
}

/**
 * The published manifest instance. Frozen so a harness can compare it
 * structurally. The `core_shapes` are the five §11 canonical shapes; `shapes` is
 * the full provisional-0.x surface. Keep this list in sync with the re-exports
 * above - the `contract.test.ts` drift test asserts every named shape resolves.
 */
export const CONTRACT_MANIFEST: ContractManifest = {
  name: "extrovert.review-loop",
  version: CONTRACT_VERSION,
  stability: "provisional",
  kind: "sdk+skill-contract",
  spec_ref: "hitl-spec.md#11",
  // §11 core - the five canonical example shapes.
  core_shapes: ["ReviewIntent", "ReviewFeedback", "DiffJson", "Rule", "ReviewEvent"],
  // The FULL published surface (the §11 core plus the rest of M1–M8). Adding a
  // name here without a matching re-export (or vice-versa) breaks the drift test.
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
    // chat / revision / restamp (M5/M7)
    "PostReviewChatRequest",
    "SubmitRevisionRequest",
    "RestampReviewRequest",
    // category registry (M4)
    "Category",
    "ProposeCategoryRequest",
    "UpdateCategoryRequest",
    // graduation + risk dial (M6)
    "AccountRiskDial",
    "EffectiveRiskDial",
    "CategoryRiskDial",
    "RiskDial",
    "GraduationStatus",
    "ProposeGraduationRequest",
    // reconciliation + pacing (M7)
    "ScanBacklogStatus",
    "CategoryPacingState",
    "PacingItem",
    // rules + audit (M4)
    "SaveRuleRequest",
    "RuleAuditEntry",
    // BYO reviewer decision (M8)
    "ReviewerAction",
    "ReviewDecisionContext",
    "ReviewerDecisionRequest",
    "ReviewerDecisionResult",
    // agent commerce request plane
    "CommerceBlocker",
    "QuoteDomainRequest",
    "DomainQuote",
    "CommerceRequestKind",
    "RequestDomainPurchaseRequest",
    "RequestPlanChangeRequest",
    "ListCommerceRequestsParams",
    "CommerceRequest",
  ],
  // The complete Review Loop behavior lives in the send skill; writing-rule
  // governance remains independently installable and part of this contract.
  skills: ["extrovert-send-email", "extrovert-writing-rules"],
} as const;

export type { LearnReviewRuleRequest, LearnedReviewRule } from "./models.js";
