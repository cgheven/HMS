# WhatsApp message templates (Meta WhatsApp Business Cloud API)

Source of truth for every WhatsApp template submitted to Meta for this app.
Sending code lives in `lib/whatsapp.ts` — `sendWhatsAppTemplateMessage(phoneDigits, templateName, languageCode, bodyVariables, context)`.

All templates below: **Category = Utility**, **Language = English (US)**, variable type = **Text**.

## Naming convention
`hms_<purpose>` — lowercase, underscores only (Meta requirement). If a name is deleted from
Meta, it's locked for ~30 days before reuse — pick a new name rather than waiting
(e.g. `hms_payment_reminder_partial` → `hms_rent_partial_reminder`).

## Meta template rules learned the hard way
- Body **cannot start or end with a `{{n}}` variable** — always open and close with static text.
- Needs a healthy ratio of static text to variable count, or Meta rejects it as
  "too many variables for its length" (hit this with the announcement template's first draft).
- No repeating/dynamic-length blocks — if a hostel has multiple WiFi networks, flatten them
  into one line before passing as a single variable (e.g. `Main: pass123 | Guest: pass456`).
- URLs passed as plain text auto-linkify in the delivered message — no URL-button component needed.
- A freshly created test number has no open 24-hour session with a recipient until either they
  message the business first, or a template message is sent to them — free-form `type: "text"`
  sends inside `lib/whatsapp.ts` will silently fail delivery outside that window even though the
  Graph API returns `{"ok":true}` (a 2xx only means "accepted," not "delivered").

---

## 1. `hms_payment_reminder_full`
Full/unpaid rent reminder.

```
Assalam o Alaikum {{1}},

This is a reminder that your rent of Rs. {{2}} for {{3}} at {{4}} is still pending.

Please pay at your earliest convenience.

For any questions, contact hostel management.
```

| Var | Sample |
|---|---|
| `{{1}}` | Musab Khan |
| `{{2}}` | 15,000 |
| `{{3}}` | July 2026 |
| `{{4}}` | Al Noor Boys Hostel |

## 2. `hms_rent_partial_reminder`
Partial-payment rent reminder (some amount already paid, balance remaining).

```
Assalam o Alaikum {{1}},

You've paid Rs. {{2}} of your Rs. {{3}} rent for {{4}} at {{5}}.

Rs. {{6}} is still remaining.

Please clear the balance at your earliest convenience.
```

| Var | Sample |
|---|---|
| `{{1}}` | Ali Raza |
| `{{2}}` | 10,000 |
| `{{3}}` | 15,000 |
| `{{4}}` | July 2026 |
| `{{5}}` | Al Noor Boys Hostel |
| `{{6}}` | 5,000 |

## 3. `hms_announcement`
General owner → tenants announcement broadcast.

```
📢 *Announcement from {{1}}*

{{2}}

Thank you for staying with us.
```

| Var | Sample |
|---|---|
| `{{1}}` | Al Noor Boys Hostel |
| `{{2}}` | Water Supply Notice: Water will be off Friday 8am-2pm for maintenance. |

## 4. `hms_tenant_welcome`
Sent automatically when a new tenant is added to a hostel with WhatsApp enabled.

```
Assalam o Alaikum {{1}},

Welcome to {{2}}! You have been allotted {{3}}.

📶 WiFi: {{4}}

🕐 Meal Times: {{5}}

🍽️ Monthly food menu: {{6}}

For any queries contact hostel management. We hope you enjoy your stay!
```

| Var | Sample |
|---|---|
| `{{1}}` | Musab Khan |
| `{{2}}` | Al Noor Boys Hostel |
| `{{3}}` | Room 5 |
| `{{4}}` | Name: Al Noor WiFi, Password: alnoor123 |
| `{{5}}` | Breakfast: 8:00 AM - 10:00 AM, Lunch: 1:00 PM - 3:00 PM, Dinner: 8:00 PM - 10:00 PM |
| `{{6}}` | https://hms.yourpulse.io/menu/al-noor-boys-hostel |

---

## Wiring status
None of the 4 real call sites are wired to `sendWhatsAppTemplateMessage` yet — they currently
use free-form `sendWhatsAppMessage`, deliberately deferred until every template above is
Meta-approved. Once approved (confirm exact name + language code shown in WhatsApp Manager,
since it can differ from what was submitted), wire:

- `lib/reminder-engine.ts` → `hms_payment_reminder_full` / `hms_rent_partial_reminder`
- `lib/whatsapp-welcome-action.ts` → `hms_tenant_welcome`
- `app/actions/announcements.ts` → `hms_announcement`
- `lib/leaving-reminder-engine.ts` → not yet templated (still free-text only)
