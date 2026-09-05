import type { Domain } from "./types.js";

/** One outcome-first presentation for MCP and CLI. Never guess from legacy flags. */
export function renderDomain(d: Domain, diagnostics = false): string {
  const r = d.readiness;
  const lines = [`${d.domain}: ${r?.label ?? "Readiness unavailable"}.`];
  if (!r) {
    lines.push("This server has not returned a readiness result. Do not infer that mail is ready from verification or signing settings. Retry with a current server or contact support.");
  } else {
    lines.push(r.summary);
    if (r.inboxes) {
      const counts = r.inboxes;
      const scope = counts.scope === "agent" ? "this agent" : counts.scope === "project" ? "this project" : "this organization";
      if (counts.total === 0) {
        lines.push(`No inboxes visible to ${scope} on this domain.`);
      } else {
        lines.push(`${counts.total} inbox${counts.total === 1 ? "" : "es"} visible to ${scope}: ${counts.ready} ready, ${counts.setting_up} setting up, ${counts.needs_attention} needing attention.`);
      }
    }
    if (r.next_action === "create_inbox") lines.push("Next: create an inbox on this domain when you are ready. Your permissions and plan limits still apply.");
    if (r.next_action === "ask_owner_to_create_inbox") lines.push("Next: ask the account owner to create an inbox or grant this connection permission to do so.");
    if (r.next_action === "use_inbox" && r.inboxes?.ready) lines.push("Your ready inboxes can send and receive mail. Sending follows your account's review rules.");
    if (r.action_required_by === "extrovert") lines.push("Next steps are with Extrovert; no DNS changes are needed from you.");
    if (r.checked_at) lines.push(`DNS last checked: ${r.checked_at}.`);
    if (!r.ready_for_inboxes) lines.push(`Check status again in ${r.poll_after_seconds} seconds. Automatic setup continues even if you disconnect; an agent must stay connected or resume checking to receive an update.`);
  }
  if (r?.action_required_by === "customer" || diagnostics) {
    const records = [...(d.delegation_ns ?? []), ...(d.records ?? [])];
    if (records.length) {
      lines.push(diagnostics ? "Required DNS entries:" : "DNS entries to add or restore:");
      for (const record of records) lines.push(`${record.type} ${record.name} → ${record.value} (TTL ${record.ttl})`);
    }
  }
  if (diagnostics) lines.push(`Diagnostic details: id=${d.id}; mode=${d.mode}; verification=${d.verification_status}; signing=${d.dkim_status}. These fields alone do not establish readiness.`);
  return lines.join("\n");
}

export function domainResult(d: Domain, diagnostics = false): Record<string, unknown> {
  if (diagnostics) return d as unknown as Record<string, unknown>;
  return {
    id: d.id,
    domain: d.domain,
    readiness: d.readiness ?? null,
    ...(d.readiness?.action_required_by === "customer" ? { dns_entries: [...(d.delegation_ns ?? []), ...(d.records ?? [])] } : {}),
  };
}
