# Billing — parents pay, coverage follows the learner

**Status:** proposal · **Date:** 2026-08-31 · **Migration:** 0013 (registry in [build-sequence.md](build-sequence.md))

The decision that settles it: **parents pay, teachers and tutors never do, and
what is bought is coverage of a specific child.**

That one sentence resolves the blocker that has been sitting in the notes since
the tutor work landed. `profiles.plan` asks *"is this user Pro?"*, which has no
answer for a teacher with twenty-five students in twelve families. The right
question is **"is this learner covered?"** — and it always has an answer.

---

## 1. The model

```
  subscription  ──covers──▶  learner  ◀──linked──  parent, tutor, teacher
   (a paying parent)          (a child)              (anyone working with them)
```

- A **subscription** belongs to one paying user. Today that is always a parent
  — the person who owns the learner profiles.
- **Coverage** is a row joining a subscription to a learner. A learner is
  covered or not; there is no third state.
- **Everyone linked to a covered learner gets the covered feature set for that
  learner.** A tutor working with a covered child sees full history and the
  item-level report for that child, and pays nothing.
- A teacher with twenty-five students, twelve of them covered, gets the full
  feature set for twelve and the free set for thirteen. They are never asked to
  pay and never see a plan.

One predicate replaces every plan check in the app:

```sql
public.is_learner_covered(p_learner uuid) returns boolean
```

### Pricing

**$4 for the first learner, $2 for each additional learner on the same
subscription.** Marketed as *"$4 for one child, $8 for three"* — the same
arithmetic, and it scales to five children without inventing a new plan.

A flat family rate was the alternative and it is worse for the same money: it
prices a one-child family the same as a four-child family, and one-child
families are most of the market.

### Why this earns twice on shared content

A tutor's deck studied by six children in six families is covered six times,
because coverage is per learner. That is the correct incentive: the value
delivered scales with children, and so does the revenue, without anyone having
to meter content.

### It already accommodates districts

Coverage is granted *by a subscription* to *a learner*. A district plan is a
subscription with many covered learners and a different payer — no schema
change, no rewrite of any gate. That is the whole forward-compatibility story
and it costs nothing to have now.

---

## 2. What is gated, and the principle behind it

> **Never gate learning. Gate leverage, and gate marginal cost.**

This is the existing commitment — *"a spelling app that paywalls fourth grade
is not much use to the kid who needs fourth grade"* — extended to everything
the three specs add. A child on an uncovered learner can still learn
everything the app knows how to teach.

### Free for everyone, always

Learning, and the loop that brings people in.

| | Why it is free |
| --- | --- |
| Every activity, every ladder rung, the Mastery Path | it is the product's purpose |
| All curriculum: spelling, typing, generated banks | paywalling a grade is indefensible |
| Tracks, spaced review, retention scheduling | the engine is not a feature |
| **Setting work, and completing it** | see below |
| A learner's own view of their own progress | it is theirs |
| The last 30 days of history for a grown-up | enough to see it working |
| Three study decks and one word list of your own | unchanged from today |

**Assigning is free, deliberately and permanently.** A teacher who sets work
for twenty-five children causes twenty-five families to open the app and see
that somebody set work for their child. That is the acquisition channel, and
gating it would strangle the exact wedge this business runs on. A teacher can
run an entire class for nothing.

### Covered learner

Everything a grown-up wants *about that child*.

| | |
| --- | --- |
| Full history instead of 30 days | the record was always kept; coverage unlocks the view |
| Item-level mastery report — every miss, every word | |
| **Retention reporting** — the Checkpoint number | the headline claim, and the best reason to pay |
| **Rewards** — parent-set payouts and the ledger | grown-up leverage by definition |
| Printable progress sheets, CSV export | |
| Unlimited decks and word lists | |
| Per-track ability and level reporting | |

### Metered — real marginal cost

**Document ingestion only**, and it is metered in **credits**, not documents.

That distinction is not pedantry, it is the difference between a margin and a
loss. Taking the ingestion spec's own cost estimates — a 5-page worksheet
around $0.15, a 20-page chapter around $0.50, a 60-page study guide around
$1.15 — a document is not a unit of cost and a page very nearly is, at roughly
**$0.025 a page** with the big ones a little cheaper.

An allowance of *ten documents a month* therefore prices a parent uploading ten
worksheets ($1.25) identically to one uploading ten chapters ($5.00) — against
$4.00 of revenue. **The second parent is a 25% loss**, and a chapter PDF is
precisely the case this feature exists to serve.

So: **1 credit ≈ 1 page**, with a 5-credit floor because even a one-page upload
pays for a full read call.

---

## 3. Credits

Coverage includes a monthly allowance. Anything beyond it is bought in packs.
This is what keeps a heavy user from being a loss instead of a customer, and it
is the only thing in the app that behaves like consumption.

### The included allowance

| Who | Credits | Roughly |
| --- | --- | --- |
| Uncovered account | **20, once — ever** | one worksheet, or a short chapter |
| First covered learner | **30 / month** | a chapter, or six worksheets |
| Each additional covered learner | **+15 / month** | pooled on the payer |
| Teacher or tutor account | **40 / month**, free | they hold the good material |

Sized against revenue rather than guessed: $4 of subscription with AI held under
a fifth of it is about 30 pages. A family of three gets 60 a month against $8.

The teacher allowance is an **acquisition cost, not a gift** — roughly $1 a
month per active teacher, buying the thing that puts the app in front of whole
classes. It is worth watching and worth capping; it is not worth removing.

### Packs

| Pack | Price | Rough cost to us | Margin |
| --- | --- | --- | --- |
| 100 credits | $5 | ~$2.50 | ~50% |
| 300 credits | $13 | ~$7.50 | ~42% |
| 1,000 credits | $40 | ~$25 | ~37% |

**Every number on this page is provisional and is meant to be replaced.** They
are sized from estimates so that the mechanism can be built; `llm_usage` (*Cost logging*)
exists to make them measurements within a month of the first real upload.

### "No rush" costs half

The ingestion spec already names the lever: the Batch API runs at 50% and fits
*"upload the textbook on Sunday"* perfectly while fitting *"generate this while
I wait"* not at all.

So expose it as a choice the learner's grown-up makes: **standard, or half the
credits and it lands within a day.** It aligns their patience with our cost,
it makes a big upload affordable instead of forbidding, and it is the rare
lever that feels generous while reducing what we spend.

### The mechanics that keep it honest

1. **Two buckets, and included is spent first.** The monthly allowance resets
   and the remainder expires; purchased credits roll over for twelve months.
   Spending the *included* bucket first is not a detail — the reverse order
   burns a parent's bought credits while free ones expire underneath, which is
   how you generate the angriest email you will ever receive.
2. **Estimate before spending, in front of the person deciding.** A PDF's page
   count is known at upload. *"This is 24 pages — about 24 credits. You have
   30."* is shown **before** the first model call, never after.
3. **Reserve, then settle.** Reserve the estimate when the job starts, record
   actuals on completion, release the difference. A job that runs long cannot
   overdraw a balance.
4. **Hard stop. Never overage billing.** Running out offers a pack; it never
   quietly charges. This is a product bought by parents for children, and a
   surprise bill would cost more in trust than the credits are worth.
5. **A failed job is refunded in full.** The tokens were still spent and
   `llm_usage` still records them, so failure cost stays visible — but it is
   ours. Charging somebody for a run that produced nothing is how a support
   queue becomes a chargeback queue.
6. **A daily ceiling applies regardless of balance.** A compromised account
   holding a 1,000-credit pack must not be able to spend it in an hour.

### The ledger

Credits get the same treatment as attempts: **an append-only ledger, with the
balance derived.** Every dispute is then answerable from the record rather than
from a number somebody overwrote.

```sql
create table public.credit_ledger (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid references public.subscriptions (id) on delete cascade,
  user_id         uuid references auth.users (id) on delete set null,  -- teacher grants
  at              timestamptz not null default now(),
  kind            text not null,      -- grant | purchase | reserve | consume
                                      -- | release | refund | expire
  bucket          text not null,      -- included | purchased
  credits         integer not null,   -- signed: grants positive, spend negative
  job_id          uuid,
  source_id       uuid,
  provider_payment_id text,
  note            text,
  constraint credit_ledger_kind_check check (kind in
    ('grant','purchase','reserve','consume','release','refund','expire')),
  constraint credit_ledger_bucket_check check (bucket in ('included','purchased'))
);

create index credit_ledger_balance on public.credit_ledger (subscription_id, at desc);
```

`credit_balance(subscription_id)` sums it, per bucket. A monthly cron writes the
`grant` and `expire` rows; nothing anywhere updates a running total in place.

## 4. Rules at the edges

These are the ones that get decided badly under time pressure, so they are
decided here.

1. **Nothing is ever deleted on lapse.** A parent who stops paying keeps every
   deck, every word list and every attempt. History beyond 30 days is *hidden*,
   not destroyed, and reappears intact on re-subscribing. Deleting a child's
   work for non-payment is not a business model.
2. **Limits apply to creating, never to keeping.** Forty decks made while
   covered stay usable after a lapse; the forty-first is refused. The message
   says which, plainly.
3. **A reward already earned is always payable.** Coverage lapsing cannot
   un-earn a promise — the same latching rule the rewards spec already sets,
   for the same reason.
4. **Coverage is checked at the moment of use, never cached in the client.**
   Every gate is `is_learner_covered()` server-side. The client may *show* a
   lock; it may never *be* the lock.
5. **A tutor may pay for a learner they do not own, if we ever choose to sell
   that.** The schema allows any subscription to cover any learner it is linked
   to. We only market to parents; that is policy, not architecture.
6. **A quota refusal happens before the money is spent.** An ingestion job that
   would breach the quota, the page cap or a deck limit is refused *before* the
   first model call, never after.

---

## 5. Cost logging — every call, from the first one

Nothing here is priced with confidence, and it should not be. The credit numbers in
*Credits* are estimates to start from and replace.

```sql
create table public.llm_usage (
  id                uuid primary key default gen_random_uuid(),
  at                timestamptz not null default now(),
  -- who and what for
  user_id           uuid references auth.users (id) on delete set null,
  learner_id        uuid references public.learners (id) on delete set null,
  subscription_id   uuid references public.subscriptions (id) on delete set null,
  feature           text not null,        -- 'ingest.read' | 'ingest.build' | 'enrich'
  source_id         uuid,                 -- the document, when there is one
  job_id            uuid,
  -- what it cost
  model             text not null,
  input_tokens          integer not null,
  output_tokens         integer not null,
  cache_creation_tokens integer not null default 0,
  cache_read_tokens     integer not null default 0,
  est_cost_usd      numeric(10,5) not null,
  duration_ms       integer,
  stop_reason       text,
  ok                boolean not null default true
);

create index llm_usage_month on public.llm_usage (subscription_id, at desc);
create index llm_usage_feature on public.llm_usage (feature, at desc);
```

**Written on every call, success or failure.** A refused or errored call still
cost tokens, and a cost model built only from successes understates reality.

Three numbers this has to be able to answer on day one:

- **Cost per document**, by page count — the number the quota is sized against.
- **Cache hit rate on the build fan-out.** The ingestion spec's caching is what
  makes a multi-topic document affordable. If `cache_read_tokens` is zero on
  the second topic call, something upstream is varying and the run costs
  roughly ten times what it should. **This should be an alert, not a dashboard
  someone remembers to look at.**
- **Cost per covered learner per month.** The gross-margin number. If it ever
  approaches $2 the pricing is wrong and we will know before it matters.

`est_cost_usd` is computed from a rate table in code, versioned, so historical
rows keep the price that was true when they were written.

---

## 6. Data model

```sql
create table public.subscriptions (
  id                  uuid primary key default gen_random_uuid(),
  payer_id            uuid not null references auth.users (id) on delete cascade,
  status              text not null default 'active',   -- active | past_due | canceled
  seats               integer not null default 1,       -- learners paid for
  provider            text,                             -- 'stripe' | 'comp' | 'promo'
  provider_customer_id text,
  provider_sub_id     text,
  current_period_end  timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint subscriptions_status_check
    check (status in ('active','past_due','canceled'))
);

create table public.learner_coverage (
  learner_id      uuid primary key references public.learners (id) on delete cascade,
  subscription_id uuid not null references public.subscriptions (id) on delete cascade,
  since           timestamptz not null default now()
);
```

`learner_coverage.learner_id` is the primary key, so **a learner is covered by
at most one subscription.** Two parents cannot both be billed for the same
child by accident, and "who is paying for this child?" has exactly one answer.

```sql
create or replace function public.is_learner_covered(p_learner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.learner_coverage c
      join public.subscriptions s on s.id = c.subscription_id
     where c.learner_id = p_learner
       and s.status in ('active', 'past_due')
  );
$$;
```

`past_due` counts as covered on purpose. A failed card is a payment problem,
not a reason to take a child's progress report away mid-week; Stripe's dunning
window resolves most of them.

### What happens to `profiles.plan`

It stays, unused, until nothing reads it — then it goes. Every gate moves to
`is_learner_covered()`. `plans.ts` stops being `PlanId → limits` and becomes
two things: **what is free** and **what coverage adds**, with quota separate
because quota is per payer rather than per learner.

Seat count is derived from `learner_coverage`, never typed by anyone; Stripe's
quantity is updated when coverage rows change.

---

## 7. What this changes in the other specs

- **Activities spec, Plans** — rewritten around coverage. Rewards move from
  unstated to covered-learner. The "whole curriculum is free" commitment stands
  and now extends to every new activity.
- **Ingestion spec, *Quota and abuse*** — credits replace the document count,
  and the allowance becomes a pooled, coverage-derived balance rather than a
  `PlanLimits` constant. The spec's own "refuse before the money is spent" rule
  becomes precise: a PDF's page count is known at upload, so the estimate is
  shown and the reservation taken before the first model call.
- **Structure spec** — nothing. Tracks are free; a taxonomy is not a feature.
- **Build sequence** — the *schema* lands in **stage 0.5**: coverage,
  `llm_usage` and `credit_ledger`, because ingestion cannot be metered against
  a model that does not exist and cost logging written after the fact is cost
  logging that never happened. **Stripe wiring — subscriptions and pack
  purchases — is not stage 0.5.** It is weeks of external integration that
  helps no learner and blocks nothing until stage 3. Put the schema in early,
  take the money later.

---

## 8. Open questions

1. **Are the credit numbers right?** Almost certainly not. They are sized from
   estimates against a $4 subscription; `llm_usage` replaces them with
   measurements within a month of the first real upload. The mechanism is the
   thing being committed to here, not the numbers.
2. **Should teachers be able to buy packs?** They never pay for the product,
   but a teacher wanting more than 40 credits is revenue nobody expected and it
   does not weaken "teachers never pay" — the base is still free. Probably yes,
   and it costs nothing to allow.
3. **Annual pricing?** Probably, at two months free, but not before there is a
   renewal cohort to measure.
4. **What does a lapsed parent see?** A lock with the number behind it —
   *"Ava has retained 87% of what she has mastered"* with the detail grayed —
   is more honest and more effective than hiding that the number exists. Worth
   testing rather than assuming.
5. **Does a teacher ever want to pay** to cover an uncovered student they care
   about? The schema allows it. Whether to offer it is a product decision that
   can wait for someone to ask.
6. **The district model's payer** is an organization, not a user. That is the
   only real schema addition it needs, and it is one nullable column on
   `subscriptions`. Not now.
