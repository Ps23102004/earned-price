# EVIDENCE — real PayPal sandbox and GitHub calls

_A money feature is not done until its row is here. Every row is read back from PayPal (or GitHub), never from our database. Sandbox only._

| Date (UTC) | Proof / feature | Call | IDs | Amounts as PayPal/GitHub returned them | Result |
|---|---|---|---|---|---|
| 2026-11-10T16:40Z | P3 GitHub facts query (server token) | POST /graphql user + search "is:pr is:merged author:gaearon merged:>=2026-01-01 sort:created-desc" + rateLimit | user gaearon (databaseId 810438) | 67 PRs returned of 67; top repo react/react 252479★ owner react (Organization); cost 1, remaining 4997/5000 | PASS |
