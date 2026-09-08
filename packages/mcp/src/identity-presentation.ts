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
  if (me.signup_starter) lines.push(formatSignupStarter(me.signup_starter));
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
  if (me.signup_starter) lines.push(formatSignupStarter(me.signup_starter));
  return lines.join("\n");
}

export function formatSignupStarter(starter: NonNullable<WhoAmI["signup_starter"]>): string {
  const lines = [`First practice review: ${starter.review_id} (${starter.status}).`, `Review destination: ${starter.review_path}`];
  if (starter.status === "pending_activation") lines.push("Show the activation instructions and keep a bounded activation watch running, then verify_signup. Do not submit a hello message.");
  else if (starter.status === "preparing") lines.push("Extrovert is preparing the same practice draft. Check whoami again shortly; do not submit another hello message.");
  else if (["sent", "auto_sent", "failed", "cancelled"].includes(starter.status)) lines.push(`Recover get_review {"id":"${starter.review_id}"} and list_review_events before concluding. This practice review is closed; do not create a replacement.`);
  else lines.push(
    `Extrovert prepared this fixed practice draft; you are its composer and receive the human’s feedback. Call get_review {"id":"${starter.review_id}"}, list_reviews {"composer":"me"}, and list_review_events {} now. Do not submit a second hello.`,
    `Before waiting, tell the human: “Your first practice draft is waiting for review at https://app.extrovert.dev${starter.review_path}. Coach me on revisions to teach me your taste. For example: ${starter.coaching_prompt}” This is optional; the example itself is not permission to save a rule.`,
    "After authenticated reviewer feedback asks for a reusable rule, load extrovert-writing-rules. Use learn_review_rule with that source_turn_id, target org_house and kind hard for the all-messages no-em-dashes request. Read back the saved rule and confirm its scope. Fetch fresh rules and revise this SAME review. One-message edits are not reusable rules.",
    'Keep one wait_for_review_event {"wait_seconds":55,"limit":100} active across your reviews. Handle feedback, acknowledge after handling, and continue until confirmed sent or another terminal outcome.',
  );
  lines.push("Explain briefly: messages initially wait for review. Agents organize categories and save reusable feedback as Extrovert rules. House rules cover all categories; projects can have their own rules shared by their agents. Later, the owner can choose direct sending or authorize a review agent. Describe only the access returned by whoami, and offer to help the human explore the console and capabilities with separately approved access.");
  return lines.join("\n");
}
