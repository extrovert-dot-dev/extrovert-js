import type { Domain, DomainReadiness, DomainStatusEventPage, Inbox, WhoAmI } from "./types.js";

/** Project service-owned metadata, never recursively redact customer email or attachment content. */
function pick<T extends object>(value: T, fields: readonly string[]): T {
  return Object.fromEntries(fields.filter(key => key in value).map(key => [key, (value as Record<string, unknown>)[key]])) as T;
}

export function assistantIdentity(me: WhoAmI): Record<string, unknown> {
  const out = pick(me, ["auth_method", "connection_status", "agent_id", "agent_name", "org_id", "organization_name", "project_id", "project_name", "inbox_scope", "inbox_id", "scopes"]);
  return {
    ...out,
    capability_profile: "assistant",
    ...(me.capabilities ? { capabilities: pick(me.capabilities, ["read_domain_status", "connect_owned_domains", "create_inboxes", "read_inboxes", "submit_mail_for_review"]) } : {}),
    ...(me.connection ? { connection: pick(me.connection, ["id", "name", "identity", "agent_id", "authorizer_id", "reach", "org_id", "project_id", "inbox_ids", "scopes", "expires_at_ms", "capability_profile"]) } : {}),
  };
}

export function assistantInbox(inbox: Inbox): Inbox {
  const out = pick(inbox, ["object", "id", "org_id", "project_id", "address", "display_name", "domain", "onboarding_mode", "status", "agent_id", "daily_send_limit", "created_at", "sender_verified", "metadata", "effective_review_policy"]);
  if (inbox.human_email_review) out.human_email_review = pick(inbox.human_email_review, ["enabled", "available", "verified_email"]);
  if (inbox.internal_email_review) {
    out.internal_email_review = {
      ...pick(inbox.internal_email_review, ["project", "organization"]),
      ...(inbox.internal_email_review.project ? { project: pick(inbox.internal_email_review.project, ["enabled", "effective"]) } : {}),
      organization: pick(inbox.internal_email_review.organization, ["enabled"]),
    };
  }
  return out;
}

function safeReadiness(value: DomainReadiness): DomainReadiness {
  return {
    ...pick(value, ["status", "label", "summary", "reason", "action_required_by", "next_action", "ready_for_inboxes", "checked_at", "next_check_at", "poll_after_seconds"]),
    ...(value.inboxes ? { inboxes: pick(value.inboxes, ["scope", "total", "ready", "setting_up", "needs_attention"]) } : {}),
  };
}

export function assistantDomain(domain: Domain): Domain {
  return {
    ...pick(domain, ["id", "domain", "mode", "verification_status", "dkim_status", "shared", "created_at"]),
    ...(domain.readiness ? { readiness: safeReadiness(domain.readiness) } : {}),
    // Only the delegated records needed for owned-domain setup are returned.
    ...(domain.mode === "ns_delegated" ? {
      delegation_ns: domain.delegation_ns?.map(record => pick(record, ["type", "name", "value", "ttl"])),
      records: domain.records?.map(record => pick(record, ["type", "name", "value", "ttl"])),
    } : {}),
  };
}

export function assistantDomainEvents(page: DomainStatusEventPage): DomainStatusEventPage {
  return {
    ...pick(page, ["next_cursor", "has_more", "poll_after_seconds"]),
    items: page.items.map(event => ({
      ...pick(event, ["id", "type", "domain", "summary", "created_at"]),
      data: { domain: event.data.domain, readiness: safeReadiness(event.data.readiness) },
    })),
  };
}
