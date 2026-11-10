# EVIDENCE — real PayPal sandbox and GitHub calls

_A money feature is not done until its row is here. Every row is read back from PayPal (or GitHub), never from our database. Sandbox only._

| Date (UTC) | Proof / feature | Call | IDs | Amounts as PayPal/GitHub returned them | Result |
|---|---|---|---|---|---|
| 2026-11-10T16:40Z | P3 GitHub facts query (server token) | POST /graphql user + search "is:pr is:merged author:gaearon merged:>=2026-01-01 sort:created-desc" + rateLimit | user gaearon (databaseId 810438) | 67 PRs returned of 67; top repo react/react 252479★ owner react (Organization); cost 1, remaining 4997/5000 | PASS |
| 2026-11-10T16:42Z | P1 discount order, capture, GET, capture replay (sandbox test card as payment_source) | POST /v2/checkout/orders (breakdown.discount) → buyer approval → POST capture ×2 same PayPal-Request-Id → GET order | order 7HT35474CA086072T; capture 0RU419430U5477308 | item_total 49.00, discount 24.50, amount 24.50, captured 24.50 USD, fee 1.12, net 23.38; capture HTTP 201, replay HTTP 200 | PASS |
| 2026-11-10T16:43Z | P2 idempotent partial refund | POST /v2/payments/captures/{id}/refund ×3 same PayPal-Request-Id (3rd with a different amount) → GET refund → GET capture → GET order | capture 0RU419430U5477308; refund 4MN41497MU618320E; order 7HT35474CA086072T | requested 5.00; HTTP 201/200/200; refund ids 4MN41497MU618320E/4MN41497MU618320E/4MN41497MU618320E; GET refund COMPLETED 5.00; capture now PARTIALLY_REFUNDED; refunds on order 1 | PASS |
