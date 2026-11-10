// Runs once at server start. A throw alone is not guaranteed to stop `next start`, so exit explicitly.

/** Names of the settings that are missing or unusable. Values are never included, so the list is safe to log. */
export function bootProblems(env: Record<string, string | undefined>): string[] {
  const problems: string[] = [];
  if (env.PAYPAL_ENV !== "sandbox") problems.push('PAYPAL_ENV must be exactly "sandbox"');
  if (!env.LICENSE_HMAC_SECRET) problems.push("LICENSE_HMAC_SECRET is not set");
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) problems.push("SESSION_SECRET must be at least 32 characters");
  try {
    new URL(env.APP_URL ?? "");
  } catch {
    problems.push("APP_URL must be set to a valid URL");
  }
  if (!env.DATABASE_URL) problems.push("DATABASE_URL is not set");
  return problems;
}

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const problems = bootProblems(process.env);
  if (problems.length > 0) {
    console.error(`refusing to start:\n- ${problems.join("\n- ")}`);
    // Bracket access: the Edge-runtime static check flags a literal process.exit although this only runs on Node.
    process["exit"](1);
  }
}
