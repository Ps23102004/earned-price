# L8 multi-model QA on the live site (Nov 11 2026)

Five independent testers, given the same written brief and safety rules (no payments, no credentials, no new live compiles, no redemption release, rate limits shared with the owner), tested the frozen live site https://earned-price.onrender.com:

| Tester | Model | How |
|---|---|---|
| Functional walkthrough | Claude Sonnet 5.5 | Playwright in a real browser, every README and video-script step that needs no payment |
| Visual, responsive, accessibility | Claude Haiku 5.5 | Playwright, 375 to 1920 px, dark and light mode, keyboard-only, landmarks, contrast, console |
| Adversarial and abuse | Claude Fable | Playwright and curl: injection, numeric edge cases, malformed and oversized bodies, tampered ids, headers, JSON-RPC edge cases |
| Exploratory | GPT-6.1 Terra (Codex CLI) | curl and source reading (its browser could not start in its sandbox) |
| Copy and consistency (text only) | Gemini 3.8 Flash, Claude Opus 4.6 Thinking, GPT-6.1 Sol | the rendered page text plus README and the submission pack |

Muse Spark 1.3 was requested but is not reachable from this environment, so it did not run.

**Held:** price tampering refused; Origin checks on every POST; tier names with HTML or script render as text; numeric validation server-side; more than 3 tiers or conditions refused; malformed, nested and 20 KB bodies refused cleanly; per-session JSON not cached; session cookie HttpOnly, Secure, SameSite; a second browser cannot see another's quotes or published rule except through its checkout link; path traversal and probes return 404; no console errors from app code; one h1 per page; landmarks and labels present; no horizontal scroll from 320 to 1920 px in normal use.

**Fixed (deployed in commit `96e2106`):**
- **Stale rule (GPT-6.1 Terra, the most important finding):** clicking another example changed the sentence but kept the old compiled rule, so Publish could publish a rule the page no longer showed. A compiled rule now belongs to its sentence; when the sentence changes, Hunt and Publish are disabled with a note until it is compiled again.
- The sentence box allowed 600 characters but the server accepts 500; the box and counter now say 500.
- Builder errors named JSON paths ("tiers[0].conditions[0]: value must be an integer"); they now read "Tier 1, condition 1: "At least" must be a whole number…", and say "Nothing was saved or published".
- The hunt listed four strategies but showed examples for one; it now says the others were searched and no account was found.
- The cost preview's "average discount across them" was an average over all 42 accounts; it now says so ("across all 42, counting those who get none"; table row "Average discount (all sampled accounts)").
- The checkout link was plain text; it is now a link that opens in a new tab, and the copy says Revert to default changes only this browser and shared links keep working.
- Sample cards made claims that hold only under the default rule; they now say so. The "only your 300 most recent merged PRs were checked" notice on a recorded sample now reads "This recorded sample was capped at its 300 most recent merged PRs".
- Long unbroken tier names widened the page at 375 px; they now wrap.
- "No orders yet" was below AA contrast in dark mode; fixed. A short note says PayPal's buttons take a few seconds to appear.
- JSON-RPC: a message without an id is a notification and now gets no response for any method; batches over 10 messages get explicit errors instead of being dropped silently.
- `Strict-Transport-Security` header added.

**Not changed (accepted or out of scope):** unknown `/shop/<id>` and `/receipt/<id>` pages return HTTP 200 with a "not valid" or "not found" body (a streaming-render limitation); malformed percent-encoding in a path gets a platform 500/520 page; no Content-Security-Policy (a wrong one would break the PayPal SDK); the OAuth `state` carries the session id signed, not encrypted (it is useless without the server's sealing secret); duplicate conditions are accepted; the rule-builder form has no PR filters (the hunt adds them); the text-only reviewers flagged the model names and 2026 dates as fictional, which reflects their training cutoff, not the project.
