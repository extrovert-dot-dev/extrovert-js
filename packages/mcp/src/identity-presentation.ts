import type { WhoAmI } from "./types.js";

function namedID(name?: string, id?: string): string {
  return name && id && name !== id ? `${name} (${id})` : id || name || "not supplied";
}

function supportAccess(me: WhoAmI): string {
  // Top-level scopes describe the active credential, which may be narrower than its grant.
  const submit = me.scopes.includes("support:submit");
  const read = me.scopes.includes("support:read");
  const write = me.scopes.includes("support:write");
  if (!submit && !read && !write) return "Support: no reporting or case access is granted to this credential.";
  const lines = ["Support access stays within this connection's authorized resources."];
  if (submit) lines.push("support:submit: file feedback and cases, read your own or explicitly shared reports and published updates, and reply to, resolve or reopen those cases. support:read is not required to follow your own reports.");
  if (read) lines.push("support:read: read other feedback and cases within the granted resource limits.");
  if (write) lines.push("support:write: file reports and update other cases within the granted resource limits; reading them requires support:read.");
  const project = me.project_id || me.connection?.project_id;
  if ((submit || read) && project) lines.push(`To recover reports, call list_feedback or list_support_cases with ${JSON.stringify({ project_id: project })}. Read published updates with list_support_case_events using the returned case id. Use this project ID directly; project administration access is not needed.`);
  else lines.push("Choose an authorized project ID for support tools; never substitute a project name or guess an ID.");
  return lines.join("\n");
}

export function formatWhoAmI(me: WhoAmI): string {
  if (me.connection) return formatConnection(me);
  if (me.scopes.length === 1 && me.scopes[0] === "signup:verify") return [
    "Signup credential exchange is still pending. This limited key verifies signup; it cannot read mail or handle reviews yet.",
    `Agent: ${me.agent_id}. Project: ${namedID(me.project_name, me.project_id)}.`,
    'Next call: check_activation {}. If state is proven, call verify_signup {} without an OTP, then whoami {} through this same connection before recovering the practice review. If pending, keep a bounded check_activation watch running. For a legacy OTP signup, use verify_signup with the human-supplied code instead.',
    "CLI recovery: run extrovert verify in this same saved profile. An interrupted watch preserves the reservation; no browser login, broader permissions, replacement account, or full host restart is needed.",
    ...(me.signup_starter?.review_id ? [`Reserved practice review: ${me.signup_starter.review_id}. Recover it only after credential exchange; do not submit another hello.`] : []),
  ].join("\n");
  const lines = [me.signup_starter ? "Connection identity verified. Recover the practice review below." : "Connection identity verified. Next: use list_inboxes to verify the intended inbox access.", me.summary ?? "Your agent is connected to Extrovert.",
    `Agent: ${me.agent_name ? `${me.agent_name} (${me.agent_id})` : me.agent_id}`,
    `Organization: ${namedID(me.organization_name, me.org_id)}`,
    `Project: ${namedID(me.project_name, me.project_id)}`];
  lines.push(`Actions: ${me.scopes.join(", ") || "none"}.`);
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
  lines.push(supportAccess(me));
  if (me.signup_starter) lines.push(formatSignupStarter(me.signup_starter));
  return lines.join("\n");
}

function formatConnection(me: WhoAmI): string {
  const grant = me.connection!;
  const reach = { inboxes: "Selected inboxes", project: "Project (including future inboxes)", organization: "Organization (including future resources)", full_account: "Full account control across organizations the authorizer currently administers" };
  const lines = [
    me.signup_starter ? "Connection identity verified. Recover the practice review below." : "Connection identity verified. Next: use list_inboxes to verify the intended inbox access.",
    `Connection: ${grant.name} (${grant.id})`,
    `Acting identity: ${grant.identity === "personal_assistant" ? `Personal assistant for ${grant.authorizer_id}` : `Dedicated agent ${grant.agent_id}`}`,
    `Resource access: ${reach[grant.reach]}.`,
    `Actions: ${me.scopes.join(", ")}.`,
    `Expires: ${grant.expires_at_ms === 0 ? "Until revoked" : new Date(grant.expires_at_ms).toISOString()}. Refresh does not extend this deadline.`,
  ];
  if (grant.org_id) lines.push(`Organization: ${namedID(me.organization_name, grant.org_id)}`);
  if (grant.project_id) lines.push(`Project: ${namedID(me.project_name, grant.project_id)}`);
  if (grant.reach === "inboxes") lines.push(`Selected inbox IDs: ${grant.inbox_ids.join(", ")}. Use list_inboxes to resolve their addresses and current readiness.`);
  if (grant.reach === "full_account") lines.push("This connection can change permissions and policies, use other agents' inboxes, and approve requests including its own. Credentials it creates expire or revoke independently.");
  if (grant.created_by_connection_id) lines.push(`Created by connection: ${grant.created_by_connection_id}; this grant has its own expiry and revocation.`);
  lines.push(supportAccess(me));
  if (me.signup_starter) lines.push(formatSignupStarter(me.signup_starter));
  return lines.join("\n");
}

export function formatSignupStarter(starter: NonNullable<WhoAmI["signup_starter"]>): string {
  const lines = [`First practice review: ${starter.review_id} (${starter.status}).`, `Review destination: ${starter.review_path}`];
  if (starter.status === "pending_activation") lines.push("Show the activation instructions and keep a bounded activation watch running, then verify_signup. Do not submit a hello message.");
  else if (starter.status === "preparing") lines.push("Extrovert is preparing the same practice draft. Check whoami again shortly; do not submit another hello message.");
  else if (["sent", "auto_sent", "failed", "cancelled"].includes(starter.status)) lines.push(`Recover get_review {"id":"${starter.review_id}"} and list_review_events before concluding. This practice review is closed; do not create a replacement.`);
  else lines.push(
    `Extrovert prepared this fixed practice draft; you are its composer and receive the human’s feedback. First call get_review {"id":"${starter.review_id}"} to read the actual draft. This identity summary does not replace that read. Do not submit a second hello or start waiting before recovering the draft.`,
    `After reading the draft, if you have not already shown it to the human, say: “Draft awaiting review. Open https://app.extrovert.dev${starter.review_path} to approve your first practice draft or coach me on revisions to teach me your taste. For example: ${starter.coaching_prompt}” Do not repeat an already delivered handoff. This is optional; the example itself is not permission to save a rule.`,
    "After authenticated reviewer feedback asks for a reusable rule, load extrovert-writing-rules. Use learn_review_rule with that source_turn_id, target org_house and kind hard for the all-messages no-em-dashes request. Read back the saved rule and confirm its scope. Fetch fresh rules and revise this SAME review. One-message edits are not reusable rules.",
    'After reading the draft and showing its review link, actually call wait_for_review_event {"wait_seconds":55,"limit":100}; promising to monitor is not a tool call. Keep one shared wait active across your reviews. Recover other outstanding work with list_reviews {"composer":"me"} and list_review_events {}. Handle feedback, acknowledge after handling, and continue until confirmed sent or another terminal outcome.',
  );
  lines.push("Explain briefly: messages initially wait for review. Agents organize categories and save reusable feedback as Extrovert rules. House rules cover all categories; projects can have their own rules shared by their agents. Later, the owner can choose direct sending or authorize a review agent. Describe only the access returned by whoami, and offer to help the human explore the console and capabilities with separately approved access.");
  lines.push("Report the observed milestone and its next action: inbox claimed → verify the connection; agent connected → recover the draft; draft awaiting review → show its review link before waiting; message sent → ask the human to check their inbox. Say message sent only after a confirmed sent result. Setup complete is too vague, and sending does not confirm receipt.");
  return lines.join("\n");
}
