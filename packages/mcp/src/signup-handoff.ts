/** Human console registration is separate from reserving another agent inbox. */
export function signupConsoleHandoff(email = "the same human email you gave your agent"): string {
  return `First time in the console? Visit https://extrovert.dev and choose Sign up with ${email}, then Connect workspace if prompted. Already registered? Sign in with that same email. This connects you to the workspace already created for your agent.`;
}

export function activationHandoff(email: string, address: string): string {
  return `Send any email from ${email} to ${address} to activate your inbox. Alternatively, ${signupConsoleHandoff(email)}`;
}
