// Runs once at server start. A throw alone is not guaranteed to stop `next start`, so exit explicitly.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertSandbox } = await import("./paypal/client");
  try {
    assertSandbox();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    // Bracket access: the Edge-runtime static check flags a literal process.exit although this only runs on Node.
    process["exit"](1);
  }
}
