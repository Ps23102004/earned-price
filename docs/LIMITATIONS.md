# Limitations (plainly)

- **Live compile is local-only by default.** The hosted demo serves cached compiles and hunts for the example sentences; a new sentence answers "unavailable" there. Anyone can still build any rule with the hand-built form (same validator, read-back, cost preview and publish), but the loophole hunt for a brand-new rule needs the model. A hosted free-tier model can be switched on with `AI_BASE_URL` / `AI_API_KEY` / `AI_LIVE=1` (docs/DEPLOY.md); no paid API is used.
- **A refund does not return PayPal's fee.** On a buy-then-refund order the merchant still pays the processing fee on the full amount (2.20 USD on 49.00 in the evidence log).
- **The compiler score is optimistic** (see the caveat above), and the model is a small local one. The hosted demo serves recorded compiles and recorded refusals (each labelled with its date) for the example sentences; any other sentence answers "unavailable" there.
- **Facts**: live GitHub facts come from one server token, so hourly rate limits apply (the app falls back to labelled sample profiles). A repository controlled through an organisation is invisible to the "not my own repo" check; more than 300 merged PRs are truncated and flagged.
- **Samples** are anonymised (no logins, URLs, repo names or exact dates; bucketed counts) but a distinctive account's month of creation and bucketed history can still narrow candidates. The sample profiles and the 40-account cost sample are recorded Nov 2026, not live.
- **Cost preview** runs over 42 recorded accounts of GitHub developers with a public repository (three follower bands), not a random sample of GitHub and not your customers, so its percentages are for illustration.
- **PENDING payments or refunds** resolve when a page loads or a button is pressed (no webhooks by design).
- **Rate limits** are in memory, per process, keyed on the client address as the host's proxy reports it, with shared caps behind them.
- **Every visitor is their own merchant.** A rule published on `/merchant` changes only that browser's checkout. A refund is always priced under the rule the order was bought under (or the shop default), never a rule the buyer published afterwards. Sample profiles are recorded stand-ins for GitHub sign-in so judges can try the flow; they are keyed per browser session, so "one redemption per buyer" is per GitHub account but per session for samples. Sessions are stateless sealed cookies, so logout does not revoke a copied cookie (`docs/L6-redteam.md`).
- **Judge mode** shows the sandbox buyer's credentials and a reset button on purpose; sandbox only.
- A receipt URL is bearer access to its order and licence for that browser session.

See ARCHITECTURE.md §3.9 and the L2 log for the full accepted-risk list.

