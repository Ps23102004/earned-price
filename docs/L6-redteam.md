# L6 red-team (2026-11-11)

Attacker: an independent Claude Fable agent with Bash/curl against the local app (PayPal sandbox behind it), read access to the code, no edits. The owner of the app authorised the test. It could not approve a PayPal payment, so no order reached `captured` during the attack; double-capture and double-refund of a paid order were judged from the code (and are covered by the integration tests and the live runs in `docs/EVIDENCE.md`). GitHub sign-in paths and the model-backed limiters were not exercised.

**Result:** no critical or high finding. Price, redemption, refund, order ownership, Origin and OAuth state all held.

## Attacks that held
- **Change the amount:** extra price fields, duplicate keys, arrays, `__proto__`, negative/huge/string numbers on quote, create, capture and claim; extra keys on create or claim are refused with "computed server-side".
- **Redeem twice:** five concurrent creates give one PayPal order; four concurrent captures run one attempt; two orders of one buyer captured together hold one redemption.
- **Refund twice / claim abuse:** claim before capture, on cancelled or expired orders, on another session's order, and four concurrent claims were all refused.
- **Replay:** create and capture after cancel or expiry refused; capture without approval returns the order to `created` and releases the hold.
- **Origin / OAuth:** about 20 Origin variants refused; forged, unsigned, replayed or cross-session OAuth state rejected; `returnTo` redirect variants collapse to `/`.
- **Merchant:** denylisted injections refused before any model call; forged, malformed or foreign rule ids give 404; client-supplied rules ignored on tighten and publish; the validator rejected out-of-range output from the two variants that passed the filter.
- **Leaks:** no secrets or source maps in 19 served bundles; generic error bodies; HttpOnly SameSite cookie; `/.env`, `/.git`, `/data` give 404.
- **Judge reset:** keys come only from the sealed session, so one session cannot release another's redemption.
- **Tampering:** malformed, SQL-ish, NUL and traversal ids, deeply nested or non-JSON bodies handled cleanly.

## Findings and what was done
| # | Severity | Finding | Action |
|---|---|---|---|
| F1 | medium | Per-address rate limits are keyed on the rightmost `x-forwarded-for` hop; with no proxy in front (local) a client can pick it | A global cap of 1,000 PayPal order creations per hour is charged only after a request is validated as this session's own quoted order (so unauthenticated callers cannot use it up); there is deliberately no global cap on capture, because a refused capture after buyer approval is worse than extra calls. On Render the proxy appends the real address; confirm with the `TRUSTED_PROXY_HOPS` check in `docs/DEPLOY.md` |
| F2 | low | A multi-megabyte body was read and parsed before the 400; some routes unlimited | Fixed: `src/http.ts` caps bodies (1 KB on money routes, 4 KB on merchant routes) while streaming; tests added |
| F3 | low | Injection denylist bypassed by zero-width characters, look-alike forms and spaced tags (the validator still rejected every result) | Fixed: NFKC normalisation, control/zero-width stripping, wider tag check; tests added |
| F4 | low | Logout does not revoke a copied sealed cookie (stateless session) | Accepted, documented: sandbox demo, cookie holds only a sample profile or GitHub identity, 14-day lifetime |
| F5 | low | A pending payment of the same buyer cancelled their other quote | Fixed: a pending hold now answers 409 "payment in progress" without cancelling |
| F6 | low | No security headers; `/api/orders/mine` cacheable | Fixed: `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `poweredByHeader: false`, `Cache-Control: no-store` on every API response. No CSP: a wrong policy would break the PayPal SDK |
| F7 | design | Sample buyer keys are per browser session; every visitor is their own merchant and can publish any existing rule to their own checkout; a guest refund is priced under the claimer's own published rule | Accepted, documented in the README: sandbox demo, publishing is session-scoped by design |
| F8 | info | Dev HTML shows local paths (dev only); receipt for an unknown id returns 200 with an empty shell | No data leaked; not changed |
