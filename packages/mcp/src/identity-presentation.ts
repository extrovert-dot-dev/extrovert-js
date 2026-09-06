import type { WhoAmI } from "./types.js";

export function formatWhoAmI(me: WhoAmI): string {
  if (me.connection) return formatConnection(me);
  const lines = [me.summary ?? "Your agent is connected to Extrovert.",
    `Agent: ${me.agent_name ? `${me.agent_name} (${me.agent_id})` : me.agent_id}`,
    `Organization: ${me.organization_name || me.org_id || "not supplied"}`,
    `Project: ${me.project_name || me.project_id || "not supplied"}`];
  lines.push(`Connection: ${me.auth_method ?? "authentication method unavailable"} · ${me.key_id}`);
  if (me.inbox_scope) lines.push(`Inbox access: ${me.inbox_scope}${me.inbox_id ? ` (${me.inbox_id})` : ""}.`);
  if (me.capabilities) {
    const labels: Record<keyof NonNullable<WhoAmI["capabilities"]>, string> = {
      read_domain_status: "check domain readiness", connect_owned_domains: "connect domains you own",
      create_inboxes: "create inboxes", read_inboxes: "read authorized inboxes", submit_mail_for_review: "submit mail for review",
      request_purchases: "request purchases for human approval",
      administer_account: "administer the account", approve_requests: "approve requests", create_credentials: "create independent credentials",
    };
    const allowed = (Object.keys(labels) as Array<keyof typeof labels>).filter((key) => me.capabilities![key]).map((key) => labels[key]);
    lines.push(`This connection can ${allowed.length ? allowed.join(", ") : "not use these mail features yet"}.`);
    lines.push("If a capability you need is missing, ask the account owner for the appropriate access; reconnecting or retrying does not add permission.");
  } else lines.push("This server did not return a capability summary. Use --json for granted permissions; do not assume every operation is available.");
  return lines.join("\n");
}

function formatConnection(me: WhoAmI): string {
  const grant = me.connection!;
  const reach = { inboxes: "Selected inboxes", project: "Project (including future inboxes)", organization: "Organization (including future resources)", full_account: "Full account control across organizations the authorizer currently administers" };
  const lines = [
    `Connection: ${grant.name} (${grant.id})`,
    `Acting identity: ${grant.identity === "personal_assistant" ? `Personal assistant for ${grant.authorizer_id}` : `Dedicated agent ${grant.agent_id}`}`,
    `Resource access: ${reach[grant.reach]}.`,
    `Actions: ${grant.scopes.join(", ")}.`,
    `Expires: ${grant.expires_at_ms === 0 ? "Until revoked" : new Date(grant.expires_at_ms).toISOString()}. Refresh does not extend this deadline.`,
  ];
  if (grant.org_id) lines.push(`Organization: ${me.organization_name || grant.org_id} (${grant.org_id})`);
  if (grant.project_id) lines.push(`Project: ${me.project_name || grant.project_id} (${grant.project_id})`);
  if (grant.reach === "inboxes") lines.push(`Selected inbox IDs: ${grant.inbox_ids.join(", ")}. Use list_inboxes to resolve their addresses and current readiness.`);
  if (grant.reach === "full_account") lines.push("This connection can change permissions and policies, use other agents' inboxes, and approve requests including its own. Credentials it creates expire or revoke independently.");
  if (grant.created_by_connection_id) lines.push(`Created by connection: ${grant.created_by_connection_id}; this grant has its own expiry and revocation.`);
  return lines.join("\n");
}
