-- Earned Price schema (docs/ARCHITECTURE.md section 3.5). Idempotent: safe to apply repeatedly.

create table if not exists rules (
  id uuid primary key,
  version int not null,
  sentence text not null,
  compiled jsonb not null,
  readback text not null,
  created_at timestamptz not null default now()
);

create table if not exists orders (
  id uuid primary key,
  state text not null,
  rule_id uuid references rules(id),
  rule_version int,
  session_id text not null,
  buyer_key text,
  snapshot_json text not null,
  snapshot_hash text not null,
  list_cents int not null,
  earned_cents int not null,
  discount_cents int not null,
  paypal_order_id text unique,
  paypal_capture_id text,
  capture_status text,
  capture_reason text,
  captured_cents int,
  paypal_fee_cents int,
  capture_attempt int not null default 0,
  capture_started_at timestamptz,
  refunded_cents int not null default 0,
  licence_key text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  check (refunded_cents = 0 or (captured_cents is not null and refunded_cents <= captured_cents))
);

create index if not exists orders_session_idx on orders(session_id);

create table if not exists redemptions (
  buyer_key text primary key,
  order_id uuid not null unique references orders(id),
  state text not null,
  created_at timestamptz not null default now()
);

create table if not exists refunds (
  id uuid primary key,
  order_id uuid not null references orders(id),
  claim_buyer_key text,
  claim_snapshot_json text,
  claim_snapshot_hash text,
  captured_at_claim_cents int not null,
  claim_earned_cents int not null,
  amount_cents int not null,
  state text not null,
  paypal_refund_id text,
  paypal_amount_cents int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (amount_cents >= 1 and amount_cents <= captured_at_claim_cents - claim_earned_cents)
);

create unique index if not exists refunds_one_live_per_order on refunds(order_id) where state <> 'failed';

-- Added after the first migration, so applied with ALTER guarded for idempotency (docs/ARCHITECTURE.md section 3.5 states).
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'orders'::regclass and conname = 'orders_earned_ck') then
    alter table orders add constraint orders_earned_ck check (earned_cents = list_cents - discount_cents and earned_cents >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'orders'::regclass and conname = 'orders_state_ck') then
    alter table orders add constraint orders_state_ck check (state in (
      'quoted', 'created', 'approved', 'capturing', 'captured', 'refunding', 'refund_pending', 'refunded_partial',
      'failed', 'cancelled', 'expired', 'mismatch'));
  end if;
end $$;

create unique index if not exists orders_capture_uq on orders(paypal_capture_id) where paypal_capture_id is not null;
