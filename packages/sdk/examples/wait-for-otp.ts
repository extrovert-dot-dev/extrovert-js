/**
 * wait_for_email - the killer primitive.
 *
 * An agent provisions an inbox, kicks off a sign-up somewhere that emails an OTP, then *blocks*
 * until the code lands - and gets it extracted as a structured field. No polling loop.
 *
 *   EXTROVERT_API_BASE_URL=mock npx tsx examples/wait-for-otp.ts
 */

import { Extrovert } from "@extrovert.dev/sdk";

async function main() {
  const extrovert = new Extrovert({ transport: process.env.EXTROVERT_API_KEY ? "http" : "mock" });

  const inbox = await extrovert.inboxes.create({ username: "signup-agent" });
  console.log(`using ${inbox.address}`);

  // ... trigger the sign-up flow that sends an OTP to inbox.address ...
  // e.g. await fetch("https://acme.test/signup", { method: "POST", body: ... })

  // Poll until the verification email arrives, up to 2 minutes.
  const result = await inbox.waitForEmail({
    from: "no-reply@acme.test",
    subject: "verification",
    timeout_seconds: 120,
  });

  if (result.timed_out) {
    console.error("no verification email arrived in time");
    process.exit(1);
  }

  console.log(`from:    ${result.message?.from.email}`);
  console.log(`subject: ${result.message?.subject}`);
  console.log(`otp:     ${result.extracted.otp ?? "(none found)"}`);
  console.log(`link:    ${result.extracted.link ?? "(none found)"}`);

  // ... submit result.extracted.otp back to the sign-up form ...
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
