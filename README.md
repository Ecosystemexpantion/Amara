# Amara — EEM26 4-Day Student Coaching Bot

Amara is a Telegram bot that guides paid EEM26 students through a structured 4-day business setup program. She acts as a warm, human female coach — using Google Gemini to handle Q&A, verify screenshots, transcribe voice messages, and generate personalized files for each student.

## Architecture

```
supabase/
├── functions/
│   ├── amara-bot/          ← Main webhook (one message = one invocation)
│   └── amara-day-unlock/   ← Cron job: unlocks next day at 8AM Nigeria time
└── migrations/
    └── 001_amara_tables.sql
```

**Tech stack:**
- Supabase Edge Functions (Deno/TypeScript)
- Telegram Bot API
- Google Gemini API (`gemini-2.5-flash-lite`) — text, vision, audio
- Supabase PostgreSQL — student state + conversation history
- npm:pdf-lib — certificate generation

## Environment Variables

Set these via `supabase secrets set` or the Supabase Dashboard → Edge Functions → Secrets:

| Variable | Required | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | ✅ | Amara's bot token from @BotFather |
| `GEMINI_API_KEY` | ✅ | Google AI Studio API key (free at aistudio.google.com) |
| `ADMIN_CHAT_ID` | ✅ | Your Telegram chat ID for admin notifications (default: 5870771695) |
| `SUPABASE_URL` | Auto | Auto-injected by Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto | Auto-injected by Supabase |

## Deployment

### 1. Create a Telegram bot

1. Open Telegram → search @BotFather
2. Send `/newbot`
3. Choose a name (e.g. "Amara EEM26 Coach") and username (e.g. `amaraeem26bot`)
4. Save the bot token

### 2. Set up Supabase project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Note your **Project Reference ID** from the dashboard URL: `https://supabase.com/dashboard/project/<PROJECT_REF>`

### 3. Install Supabase CLI

```bash
npm install -g supabase
```

### 4. Link your project

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

### 5. Run the database migration

```bash
supabase db push
```

Or paste the content of `supabase/migrations/001_amara_tables.sql` into your Supabase SQL Editor and run it.

### 6. Set secrets

```bash
supabase secrets set TELEGRAM_BOT_TOKEN=your_bot_token_here
supabase secrets set GEMINI_API_KEY=your_gemini_key_here
supabase secrets set ADMIN_CHAT_ID=5870771695
```

### 7. Deploy the Edge Functions

```bash
supabase functions deploy amara-bot --no-verify-jwt
supabase functions deploy amara-day-unlock --no-verify-jwt
```

### 8. Set the Telegram Webhook

Replace `YOUR_BOT_TOKEN` and `YOUR_PROJECT_REF`:

```bash
curl -X POST "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://YOUR_PROJECT_REF.supabase.co/functions/v1/amara-bot"}'
```

Expected response: `{"ok":true,"result":true,"description":"Webhook was set"}`

### 9. Set up the Day Unlock Cron Job

In Supabase Dashboard → Database → Cron Jobs → New Cron Job:

| Field | Value |
|---|---|
| Name | `amara-day-unlock` |
| Schedule | `*/5 * * * *` (every 5 minutes) |
| Type | HTTP Request |
| URL | `https://YOUR_PROJECT_REF.supabase.co/functions/v1/amara-day-unlock` |
| Method | POST |
| Headers | `Authorization: Bearer YOUR_SERVICE_ROLE_KEY` |

### 10. Test

Send a message to your bot on Telegram. You should see Amara's greeting and onboarding questions start.

## The 4-Day Program

### Day 0 — Onboarding
Amara collects: full name → email → phone → country, then immediately starts Day 1.

### Day 1 — Understanding the Business
1. Q&A about AAM (Automate & Attract Method) and SRE (Smart Reply Engine)
2. Create Selar creator account (screenshot verified)
3. Confirm Selar dashboard (screenshot verified)
4. Create Payhip account via special affiliate link (screenshot + store link collected)
5. Day 1 complete → schedules Day 2 unlock for 8AM Nigeria time

### Day 2 — Sales Page Setup
1. GitHub account creation + username selection
2. Create `EEM26page` repository
3. Amara sends customized `index.html` (normal sales page with student's Payhip link)
4. Upload to GitHub + enable GitHub Pages
5. Repeat for `EEM26premium` (premium sales page)
6. Day 2 complete → two live sales pages

### Day 3 — Bot Creation & Supabase Setup
1. Create Telegram bot with BotFather → collect token
2. Supabase account via GitHub
3. Create Supabase project
4. Get API keys (Gemini vision extracts URL and anon key from screenshot)
5. Run SQL for bot tables
6. Deploy customized bot code (generated `index.ts` sent as file)
7. Day 3 complete

### Day 4 — Go Live & Certificate
1. Set environment variables in Supabase
2. Set Telegram webhook
3. Test bot is responding
4. Collect student signature photo
5. Generate and send PDF certificate (with SD Digital Academy logo + student signature)
6. Grand finale + admin notification

## State Machine

```
current_day=0, current_step=1..4   → Onboarding
current_day=1..4, current_step=1+  → Day in progress
current_day=1..3, current_step=0   → Day complete, waiting for next-day unlock (cron job handles this)
current_day=5 or status=COMPLETED  → Program complete
```

The cron job (`amara-day-unlock`) runs every 5 minutes. When it finds a student with `current_step=0` and `next_day_unlocks_at <= now()`, it advances them to the next day (`current_day+1, current_step=1`) and sends the day unlock message.

## Screenshot Verification

Every required screenshot is analyzed by Gemini vision with a specific verification prompt. Students get up to 3 attempts per step. On the 3rd failure, Amara re-explains from scratch and the admin is notified.

## Voice Message Handling

Voice messages are downloaded from Telegram (`.oga` format), sent to Gemini audio API for transcription, then processed as text. Amara responds naturally without drawing attention to the fact it was a voice message.

## Admin Notifications

Admin (chat ID: 5870771695) receives Telegram messages for:
- New student registered
- Each day completed (with asset summary)
- Student stuck after 3 failed screenshot attempts
- Certificate issued (with all student links)

## File Generation

**Sales page HTML** (`html-modifier.ts`): The coach's sales page templates are customized per student by:
- Removing the Paystack payment modal
- Replacing all buy buttons with the student's Payhip store link
- Adding a client-side redirect script as backup

**Student bot code** (`alex-template.ts`): A complete Gemini-based sales bot is generated with the student's `ADMIN_CHAT_ID`, `sales_page_link`, and `payhip_link` pre-configured.

**Certificate** (`certificate.ts`): A PDF using pdf-lib with A4 landscape layout, SD Digital Academy logo, student name, completion date, certificate number, Coach Victor signature, and the student's handwritten signature photo.

## Troubleshooting

**Bot not responding:**
- Check webhook is set: `curl https://api.telegram.org/botTOKEN/getWebhookInfo`
- Check function logs: Supabase Dashboard → Edge Functions → Logs

**Day not unlocking:**
- Check cron job is running: Supabase Dashboard → Database → Cron Jobs
- Check `next_day_unlocks_at` and `current_step` in `amara_students` table
- Manually trigger: `curl -X POST https://PROJECT_REF.supabase.co/functions/v1/amara-day-unlock -H "Authorization: Bearer SERVICE_ROLE_KEY"`

**Gemini errors:**
- Verify `GEMINI_API_KEY` is set correctly
- Check Google AI Studio quota at [aistudio.google.com](https://aistudio.google.com)

**Screenshot verification failing:**
- Gemini vision may have trouble with blurry or dark screenshots
- Students can always ask Amara for help — she'll guide them with Gemini chat

## Support

All issues should be reported to the EEM26 admin via Telegram (ADMIN_CHAT_ID: 5870771695).
