import type { WhoAmI } from "./types.js";

export function formatWhoAmI(me: WhoAmI): string {
  const lines = [me.summary ?? "Your agent is connected to Extrovert.",
    `Agent: ${me.agent_name || me.agent_id}`,
    `Organization: ${me.organization_name || me.org_id || "not supplied"}`,
    `Project: ${me.project_name || me.project_id || "not supplied"}`];
  if (me.capabilities) {
    const labels: Record<keyof NonNullable<WhoAmI["capabilities"]>, string> = {
      read_domain_status: "check domain readiness", connect_owned_domains: "connect domains you own",
      create_inboxes: "create inboxes", read_inboxes: "read its inboxes", submit_mail_for_review: "submit mail for review",
      request_purchases: "request purchases for human approval",
    };
    const allowed = (Object.keys(labels) as Array<keyof typeof labels>).filter((key) => me.capabilities![key]).map((key) => labels[key]);
    lines.push(`This connection can ${allowed.length ? allowed.join(", ") : "not use these mail features yet"}.`);
    lines.push("If a capability you need is missing, ask the account owner for the appropriate access; reconnecting or retrying does not add permission.");
  } else lines.push("This server did not return a capability summary. Use --json for granted permissions; do not assume every operation is available.");
  return lines.join("\n");
}
