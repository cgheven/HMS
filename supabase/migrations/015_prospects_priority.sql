-- Add priority fields
alter table hms_prospects
  add column if not exists wave            integer,
  add column if not exists priority_score  integer not null default 0,
  add column if not exists priority_reason text,
  add column if not exists is_avoid        boolean not null default false,
  add column if not exists avoid_reason    text;

-- ─────────────────────────────────────────────────────────────────
-- WAVE 1 — Lighthouse Pilots (priority_score 92-100)
-- ─────────────────────────────────────────────────────────────────
update hms_prospects set wave = 1, priority_score = 100,
  priority_reason = 'Manager Ms. Sana named in reviews as helpful + professional. 4.5★. Walking distance from office for unlimited pilot support. Small (~15-20 beds) — no scale issues.'
  where name ilike '%6 Star Girls%Hostel%';

update hms_prospects set wave = 1, priority_score = 95,
  priority_reason = 'Owners Tayyab & Faisal named in reviews. 4.7★ premium operation. Backup Lighthouse if 6 Star declines.'
  where name = 'New Misali Boys Hostel';

update hms_prospects set wave = 1, priority_score = 92,
  priority_reason = '4.8★, 51 reviews, DHA Phase 5. Tech-active operation. Strong third Lighthouse option.'
  where name = 'Elite Boys Hostel';

-- ─────────────────────────────────────────────────────────────────
-- WAVE 2 — Multi-Property Owners (priority_score 86-94)
-- ─────────────────────────────────────────────────────────────────
update hms_prospects set wave = 2, priority_score = 94,
  priority_reason = 'Same phone +92 333 0033666 runs 3 properties. Single sale = Rs. 24K-30K MRR. Pitch Premium tier.'
  where name = 'The United Girls Hostels (DHA branch)';

update hms_prospects set wave = 2, priority_score = 93,
  priority_reason = 'Same operator as DHA branch — multi-property goldmine. Pitch all 3 properties together for bundle deal.'
  where name = 'The United Girls Hostel' and location = 'Gulistan-e-Johar';

update hms_prospects set wave = 2, priority_score = 92,
  priority_reason = 'Same United Girls operator — 3rd property. Bundle with DHA + Gulistan branches for maximum LTV.'
  where name = 'The United Girls Hostel (Gulshan Block 6)';

update hms_prospects set wave = 2, priority_score = 90,
  priority_reason = 'Brothers Shujahat & Wajahat run 4 buildings (C-14 to C-17). 88 reviews, 4.2★. Single sale = 4 properties.'
  where name = 'Syed Boys Hostel';

update hms_prospects set wave = 2, priority_score = 87,
  priority_reason = 'Owner Arsalan Tariq runs 2 branches. Pitch carefully — has management complaints; lead with efficiency gains.'
  where name = 'Student Housing Hostel (Jauhar Branch)';

update hms_prospects set wave = 2, priority_score = 86,
  priority_reason = 'Same Arsalan Tariq operator as Jauhar. Bundle both properties for double MRR in one conversation.'
  where name = 'Student Housing Boys Hostel (Gulshan Branch)';

-- ─────────────────────────────────────────────────────────────────
-- WAVE 3 — Cluster Wins (priority_score 70-82)
-- Defence View cluster — visit all in one trip
-- ─────────────────────────────────────────────────────────────────
update hms_prospects set wave = 3, priority_score = 82,
  priority_reason = '4.2★, 115 reviews. Ahsan Bhai named in reviews. Visit alongside Dua + Abiha''s in one Defence View trip.'
  where name = 'Professional Stay Boys Hostel';

update hms_prospects set wave = 3, priority_score = 80,
  priority_reason = '116 reviews, Rs. 12K/bed confirmed. Iqra University hub. Bundle with Professional Stay + Abiha''s.'
  where name = 'Dua Boys Hostel DHA';

update hms_prospects set wave = 3, priority_score = 78,
  priority_reason = '4.5★, 53 reviews. Premium girls hostel Phase 3. Part of Defence View one-trip cluster.'
  where name ilike 'Abiha%Girls Hostel%';

update hms_prospects set wave = 3, priority_score = 72,
  priority_reason = '185 reviews — large operation but management criticized. Pitch as solution to their visible operational pain.'
  where name = 'Noor Boys Hostel';

-- Tariq Road cluster — 6 hostels in 200m, hit New Misali first then use as reference
update hms_prospects set wave = 3, priority_score = 76,
  priority_reason = '3.9★, 66 reviews. Active operation in Tariq Road cluster. Lead with New Misali as reference.'
  where name = 'Hostel Hub - PECHS';

update hms_prospects set wave = 3, priority_score = 75,
  priority_reason = '4.4★, 31 reviews. Near Tariq Center. Tariq Road cluster — one-trip with 5 other hostels.'
  where name ilike '%Karachi Boys Hostel (Jheel%';

update hms_prospects set wave = 3, priority_score = 73,
  priority_reason = '4.6★, small but quality. In Tariq Road cluster — leverage New Misali as reference.'
  where name = 'Boys Hostel Tariq Road';

update hms_prospects set wave = 3, priority_score = 71,
  priority_reason = '3.7★. Liberty Signal location. In Tariq Road cluster — sweep on same visit.'
  where name = 'Tariq Road Hostel';

update hms_prospects set wave = 3, priority_score = 70,
  priority_reason = '5.0★ (only 3 reviews). Liberty Signal. In Tariq Road cluster.'
  where name = 'Karachi Hostel 2';

-- ─────────────────────────────────────────────────────────────────
-- WAVE 4 — Premium Picks (priority_score 50-68)
-- Approach AFTER landing 2-3 testimonials
-- ─────────────────────────────────────────────────────────────────
update hms_prospects set wave = 4, priority_score = 68,
  priority_reason = '4.8★, 90 reviews. Owner Najam named in reviews. Premium positioning — needs social proof first.'
  where name ilike '%Bilal Boys Hostel%';

update hms_prospects set wave = 4, priority_score = 66,
  priority_reason = '185 reviews — biggest single-property operation in Gulistan. Very established. Needs testimonials.'
  where name = 'Murad Boys Hostel';

update hms_prospects set wave = 4, priority_score = 64,
  priority_reason = '93 reviews. Established girls'' brand. Will demand references — have 2-3 testimonials ready.'
  where name = 'Iffat Girls University Hostel';

update hms_prospects set wave = 4, priority_score = 62,
  priority_reason = '4.7★, 32 reviews. High quality operation. Approach after testimonials are in hand.'
  where name ilike '%Nation%Girls Hostel%';

update hms_prospects set wave = 4, priority_score = 60,
  priority_reason = '5.0★, 17 reviews. High standards — approach only with strong social proof.'
  where name ilike '%Al Hasnain Boys Hostel%';

update hms_prospects set wave = 4, priority_score = 58,
  priority_reason = '4.8★, 37 reviews. Well-managed. Needs social proof first.'
  where name ilike '%City Boys Hostel%';

update hms_prospects set wave = 4, priority_score = 56,
  priority_reason = '4.4★, 119 reviews. Strong operation — approach after Wave 1 testimonials close.'
  where name ilike '%HY Boys Hostel%';

update hms_prospects set wave = 4, priority_score = 54,
  priority_reason = '4.9★, 12 reviews. Premium operation. Approach after testimonials secured.'
  where name ilike '%Yar Boys Hostel%';

update hms_prospects set wave = 4, priority_score = 52,
  priority_reason = '4.7★, 63 reviews. Has own website — higher software awareness. Approach after testimonials.'
  where name ilike '%Harmain Boys Hostel%';

update hms_prospects set wave = 4, priority_score = 51,
  priority_reason = '4.4★, 66 reviews. Approach after testimonials are in hand.'
  where name = 'Lavish Boys Hostel';

update hms_prospects set wave = 4, priority_score = 50,
  priority_reason = '4.8★, 5 reviews. Small premium girls operation — approach after testimonials.'
  where name ilike '%KyZee Hostel%';

-- ─────────────────────────────────────────────────────────────────
-- AVOID — Do not approach
-- ─────────────────────────────────────────────────────────────────
update hms_prospects set is_avoid = true, wave = null, priority_score = 0,
  avoid_reason = '2.5★ — cockroaches and deposit-stealing complaints in reviews. Will not pay for software.'
  where name ilike '%EB Girls Hostel%';

update hms_prospects set is_avoid = true, wave = null, priority_score = 0,
  avoid_reason = '3.4★ — owner described as "greedy" and "shows true colors" in multiple reviews. High churn risk.'
  where name ilike '%Park Lane Girl%Hostel%';

update hms_prospects set is_avoid = true, wave = null, priority_score = 0,
  avoid_reason = '2.5★ — multiple reviews calling it "pathetic". Not worth pursuing.'
  where name ilike '%Al Jannat Girls Hostel%';

update hms_prospects set is_avoid = true, wave = null, priority_score = 0,
  avoid_reason = 'No phone listed + multiple management complaints. Not actionable — revisit only if they reach out.'
  where name ilike '%Karachi Boys Hostel (Saddar)%';
