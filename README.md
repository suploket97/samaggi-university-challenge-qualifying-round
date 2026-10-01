# Samaggi University Challenge – Qualifying Round

The live quiz app for the Samaggi University Challenge qualifying round. Every team plays each question at the same moment. The app has three screens:

| Screen | URL | Who uses it |
|---|---|---|
| **Stage** | `/stage/ROOMCODE` | Projector or TV. Shows the room code and QR code, questions, timer, answer reveal, leaderboard and qualification reveal |
| **Host console** | `/admin` | You. Create rooms, run the game, import question packs |
| **Player** | `/play` | Each team's phone. Answer buttons or a text box, then CORRECT/INCORRECT and their rank |

Built with Next.js 16, Tailwind CSS 4, Supabase (question bank database + realtime updates) and
Upstash Redis (live game state). All three services have free plans.

---

## Deploy it (about 20 minutes, no coding)

### 1. Create the question bank database (Supabase)
1. Sign up at **supabase.com** and click **New project**. Choose any name and region, and save the database password somewhere.
2. When the project is ready, open **SQL Editor → New query**.
3. Open `supabase/setup.sql` from this folder, copy all of it, paste it into the editor and click **Run**.
   It should say "Success. No rows returned".
   (If you connect Supabase through Vercel's **Storage** tab instead, skip this: the app creates the
   tables itself the first time you open the host dashboard.)
4. Go to **Project Settings → API** (called "Data API" / "API Keys" in some versions) and keep that page open. You'll need:
   - the **Project URL**
   - the **anon / publishable** key
   - the **service_role / secret** key (keep this one private)

### 2. Create the live game store (Upstash Redis)
1. Sign up at **upstash.com**, click **Create Database** (Redis), pick a region near your Supabase region, and choose the free plan.
2. On the database page, scroll to **REST API** and copy **UPSTASH_REDIS_REST_URL** and **UPSTASH_REDIS_REST_TOKEN**.

### 3. Put the code on GitHub
1. Sign up at **github.com**, click **New repository**, name it `pub-quiz`, and set it to **Private**.
2. On the empty repository page, click **uploading an existing file**.
3. Unzip this project on your computer. Open the `pub-quiz` folder, select **everything inside it**, and drag it into the browser.
   Wait for all files to upload, then click **Commit changes**.

### 4. Deploy on Vercel
1. Sign up at **vercel.com** using your GitHub account.
2. Click **Add New → Project** and **Import** your `pub-quiz` repository. Vercel detects it as a Next.js app automatically.
3. Before clicking Deploy, open **Environment Variables** and add these:

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon / publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role / secret key |
| `UPSTASH_REDIS_REST_URL` | from Upstash |
| `UPSTASH_REDIS_REST_TOKEN` | from Upstash |

4. Click **Deploy** and wait for the build to finish (about 2 minutes).

> **Shortcut:** Instead of copying keys by hand, you can connect Supabase and Upstash from the **Storage / Marketplace** tab of
> your Vercel project. The app accepts the variable names they add automatically. After changing any environment variable, go to **Deployments → ⋯ → Redeploy**.

### 5. Run a test game
1. Open `https://YOUR-APP.vercel.app/admin`. On the very first visit it asks you to **create the host password** (type it twice). Do this straight after deploying, so nobody else gets there first. After that, `/admin` shows a normal login.
   If anything is misconfigured, a **Setup needs attention** box explains what to fix.
2. Click **Question bank**. Either create a pack and add a couple of questions, or open **Import from a spreadsheet**, download the **12-question sample pack** and upload it.
3. Go back to **Rooms** and click **Create room**, then **Open stage ↗** (on the projector or in a second browser tab).
4. On your phone, scan the QR code on the stage and join with a team name.
5. In the host console: **Load pack** → *(optionally pick a time)* **Start question 1** → *(add time with +10s, or press Lock answers now)* →
   **Reveal answer** → **Leaderboard** → **Next question** … → **Reveal qualified teams** → **End game**.
   If teams are level on score at the qualifying cut, the console offers **Show tie-break** first: the big
   screen compares those teams on correct answers, then time, before you reveal the qualified teams.

---

## Writing your own questions

Go to **Host console → Question bank**. There's no spreadsheet needed.

1. Type a pack name (for example "Friday Round 1") and click **Create**.
2. Click **+ Add a question** and choose the answer type:
   - **One answer**: players tap one choice. Add as many choices as you need, up to 26 (A–Z), for either multiple-choice type.
   - **Several answers**: players pick all that apply, then press Submit.
   - **Typed answer**: players type the answer. Add every spelling you'll accept; the first one is shown on the big screen.
   - **Sub-questions**: one main question with several typed parts, e.g. "Name the capital of each country" → Australia / Canada / Thailand.
     Each part gets its own answer box on the phone, is marked on its own (typos and Thai handled the same way), and the points of the
     parts answered correctly are added up into one score for the question. Give a part its own points, or leave them blank to split
     the question's points evenly. The speed bonus only applies when every part is right; getting some right shows "PARTLY RIGHT".
   - **True or false**: two big buttons on the phone. Tap the one that is correct. The labels can be changed (e.g. จริง / เท็จ, Yes / No, Fact / Myth).
   - **Put in order**: write 2–10 items **in the correct order** (drag ⠿ to fix the order). Phones and the big screen show them shuffled;
     players tap them in order, first to last, and can drag ⠿ to swap places. Points are shared by the items in the right place (3 of 4 = 75%), or choose
     "Points only if everything is right".
   - **Matching**: write 2–10 pairs, each row one correct pair (e.g. Japan → Tokyo). Phones show the right-hand side shuffled; players
     tap an item, then tap its match (matched pairs share a colour). Points are shared by the correct matches, or all-or-nothing.
3. Tick the correct choice(s), set the **time to answer** and click **Add question**.
4. Drag the **⠿** handle to reorder questions (mouse or touch; or focus it and use the arrow keys), **Copy** to duplicate a question, and **Edit** to change it later. Choices and sub-question parts have the same ⠿ handle and a **Remove** button.

**Keeping and deleting packs**
Packs and their questions are saved permanently in your database and can be used for any number of games.
Ending a game or deleting a room never touches them. Only the host deletes a pack, from any device where they're logged in:
- **Question bank → Delete this pack**, or
- after a game ends, on that game's host console: **Delete this pack…** (with **Keep for next time** as the default).

A pack that's loaded in a game still in progress can't be deleted. End that game first.

**Picture, sound and video questions**
- Click **Upload a file**, or paste a picture straight into the form. Large phone photos are shrunk automatically before upload.
- Pictures appear large on the big screen and on every player's phone, where players can tap to zoom. They stay visible when the answer is revealed.
- Untick **Also show on players' phones** if the picture would give the answer away. The phone then shows "Look at the big screen".
- Sound and video play on the big screen only (MP3/M4A/WAV/OGG sound, MP4/WebM video, up to 50 MB). While the question is open, the host console has **▶ Play / ⏸ Pause / ⟲ From the start** buttons that control the big screen. Browsers block sound until someone has clicked once on the big-screen page, so click it once when you set up.
- Choices can be pictures too. Click 🖼 next to a choice (useful for "Which of these is…" rounds).

**Time per question**
- Each pack has a **default time**. Change it at the top of the pack, and use **Use Ns for every question** to apply one time to the whole pack.
- Each question can have its own time: 10, 15, 20, 30, 45, 60, 90, 120 seconds, or any number from 5 to 600.
- During the game, the host console shows the **next question** before you start it, and lets you pick a different time just for tonight.
- While a question is running you can press **+10s**, **+30s** or **−10s**. The timer never drops below 3 seconds.

**Importing from a spreadsheet (optional)**
If you already have questions in Excel or Google Sheets, open **Import from a spreadsheet** on the Question bank page.
Download the template and use one row per question:

| Column | What to put |
|---|---|
| `quiz_pack_id` / `pack_title` | Which pack. Leave blank to use the same pack as the row above. |
| `type` | `MCQ_SINGLE`, `MCQ_MULTI`, `TRUE_FALSE`, `TEXT_INPUT`, `SUB_QUESTIONS_TEXT`, `ORDERING` or `MATCHING` (blank = the app works it out; `true_false`/`tf`, `ordering`/`order` and `matching`/`match` also work) |
| `question_text` | The question |
| `choice_a` … `choice_z` | Options for multiple choice (up to 26 choices, A–Z) |
| `correct_answers` | MCQ: letters, e.g. `B` or `A\|C`. Typed answers: every accepted answer separated by `\|`; the first is shown on stage. True/false: `True` or `False` (also `T`/`F`, `A`/`B`, `จริง`/`เท็จ`). Ordering and matching: leave blank. |
| `choice_a` … for `ORDERING` | The items **in the correct order** (A first). |
| `match_1_left`, `match_1_right` … `match_10_*` | Matching: each correct pair. |
| `media_url` | Optional link to a picture, sound or video |
| `sub_1_question`, `sub_1_answers`, `sub_1_points` … `sub_20_*` | Sub-questions: each part's question, accepted answers (separated by `\|`) and optional points. Set `type` to `SUB_QUESTIONS_TEXT` (or leave it blank). |
| `time_limit_sec` | Optional, 5–600 |
| `base_points`, `multi_scoring`, `fuzzy`, `max_typos`, `explanation` | Optional |

**Thai questions**
Questions, choices and answers can be written in Thai. They display in Noto Sans Thai, a clean sans-serif without the traditional loops.
Typed answers keep Thai vowel and tone marks (so ไก่ and ไข่ stay different words), and Thai digits count the same as 0–9.

## Checking answers before the reveal (host review)
While a question is open, and after answers lock, the host console shows **Check answers before the reveal**: every answer that
has arrived, with identical answers grouped (capitals, accents, spacing and punctuation don't split a group). Each group shows how
many teams sent it, which teams, and how it was marked automatically ("Exact match", "Accepted with 1 typo", "No accepted answer matched").

- **✔ Right / ✘ Wrong** changes the marking for the whole group, including teams that send the same answer later. **↺ Undo** goes back to automatic marking.
- Typed answers accepted only because of the typo allowance are labelled **typo accepted: check it** (e.g. "Austria" for "Australia").
- Multiple choice: marking a choice right or wrong changes the answer key for that question (e.g. accept a second correct choice).
- Sub-questions: each part is reviewed on its own.
- Ordering and matching: identical answers are grouped. Part-right answers (½) keep their share of the points automatically;
  **✔ Right** gives full points and **✘ Wrong** gives none.
- Changes are allowed only before **Reveal answer**. The reveal button shows how many changes will be applied, and the big screen lists
  answers the host accepted as "Also accepted by the judges".
- Every change is written to the **Competition log** at once (Timeline and full report), and each team's answer sheet says
  "Marked correct by the host during the review (automatic marking: …)".

## Correcting a question after the reveal (challenge upheld)
Between questions (after a reveal, or on the leaderboard) the console shows **Challenge upheld? → ✏️ Correct a revealed question**.
Pick the question, then mark a group of answers right or wrong exactly as in the review. That question is re-scored for every
team straight away and the leaderboard is adjusted; a note shows whose points changed (e.g. "Team A 0 → 100").
Corrections close once the tie-break or the qualified teams are shown (go back to the leaderboard to reopen them). Each one is
logged as "Correction after the reveal", with the points before and after, and the saved results for that question are replaced.

## Managing teams
Press **⋯** next to a team in the console:
- **Rename** fixes a typo in a team name (the leaderboard and log follow).
- **Move to a new device** gives a one-time 6-digit code (valid 10 minutes). On the new device the team opens the join page,
  enters the room code and taps **Use the code from the host**. The team keeps its score and answers; the old device is signed out.
- **Remove this team** takes a test entry or duplicate out of the game (not possible once the tie-break or qualified teams are shown).
All three are written to the competition log.

## How scoring works
When you create a room, choose one of three scoring modes (fixed for that game, and saved in the competition log):

| Mode | Right answer | Speed |
|---|---|---|
| **Classic** (default) | base points (100) | bonus +20 within 5 s, +10 within 10 s |
| **Accuracy only** | base points, whenever it arrives before time is up | no bonus |
| **Speed decay** | base points × a time factor: 100% for an instant answer, falling steadily to 50% at the buzzer (time added with +10s counts) | no separate bonus |

Only the server's clock counts. Part marks (pick-all-that-apply, sub-questions, ordering, matching) are worked out first, then the mode is applied.

- **Pick-all-that-apply:** each correct pick earns a share of the points and each wrong pick loses a share (never below 0), so selecting every option doesn't pay off. The speed bonus only applies to fully correct answers.
- **Text answers:** capital letters, accents, punctuation, spacing and a leading "the/a/an" are ignored.
  Typos are forgiven by length: exact spelling up to 4 letters, 1 typo for 5–8 letters, 2 typos for 9 or more.
  Numbers (like years) must be exact.
- **Ordering / matching:** the share of items in the right place, unless the question is set to all-or-nothing.
- **Ties** (in every scoring mode) are decided by more correct answers, then less total time spent on correct answers.
  Teams still tied at the qualifying cut-off all go through. On the final leaderboard, teams on the same score
  share a position ("4="), so the table doesn't give the tie-break away; the tie-break step shows it.

## Anti-cheat
While a question is open, a player who leaves the quiz screen (switches app or tab) for longer than the
allowed time (3 seconds by default) is flagged in your console. By default, their answer for that question is voided. You can
choose **flag only** when creating a room. Copying, pasting and long-press menus are blocked on the player screen.
On a computer, another window in front of a quiz page that is still visible (for the same allowed time) is **flagged only**
("another window in front"), never voided, because a click on the taskbar or address bar looks the same; judges decide.
This detection runs on the player's device, so it deters casual searching but can't prove someone cheated.

## Free plan limits
A typical night of 50 teams and 30 questions uses a small fraction of each free plan
(roughly 50–60k Upstash commands, 25–30k Vercel function calls and about 10k Supabase realtime messages).
If you run many large games each month, keep an eye on Upstash's monthly command limit.

## The host password
- **First visit:** `/admin` asks you to create it. It's stored only as a salted scrypt hash in your Redis database, never as plain text.
- **Change it:** Host console → **Host password → Change password** (needs the current one). This signs out every other device.
- **Guessing protection:** after 10 wrong passwords from one device in 15 minutes, that device has to wait.
- **Forgot the host password:** open Upstash (Vercel → Storage → your Redis database → **Open in Upstash** → **Data Browser**), delete the key `admin:auth`, then visit `/admin` and create a new one.
  Or add an `ADMIN_PASSWORD` environment variable in Vercel and redeploy. If it's set, it takes priority over the stored password.

## Troubleshooting
- **"Setup isn't finished" on /admin:** the page lists which database settings the project has. Connect Supabase and Upstash for Redis on the project's **Storage** tab, then **Deployments → ⋯ → Redeploy**. Remember that each Vercel Drop upload creates a new project that needs connecting again.
- **The build fails on Vercel:** open the failed deployment's **Build Logs** and send me the red error lines.
- **"Setup needs attention" says tables are missing:** refresh /admin. The app creates the tables automatically when Vercel's `POSTGRES_URL` is available; otherwise run `supabase/setup.sql` in the Supabase SQL editor.
- **Screens show "Syncing" instead of "Live":** the app still works and catches up every 3 seconds.
  To restore instant updates, check that `NEXT_PUBLIC_SUPABASE_ANON_KEY` is correct. Then, in Supabase, open **Realtime → Settings** and make sure
  public channels are allowed (i.e. "private channels only" is **off**).
- **Rooms disappear:** rooms are removed automatically 12 hours after their last change. Question packs are kept permanently.
- **Uploads fail:** run `supabase/setup.sql` again. It creates the `quiz-media` storage area, which the app also creates automatically on the first upload.
- **A picture shows "Picture couldn't load":** the link is broken or the site blocks sharing. Upload the file instead of linking to it.

---

## For developers
```
app/            pages (/, /play, /play/[code], /stage, /stage/[code], /admin, /admin/room/[code], /admin/bank) + API routes
components/     UI (stage, player, admin, leaderboard, qualification reveal)
lib/game/       engine: state machine, scoring, Redis store, per-screen projections (framework-free, unit-testable)
lib/server/     env, Redis/Supabase clients, auth (admin cookie + signed team tokens), realtime publisher
lib/client/     hooks: room sync (realtime + heartbeat), server-synced countdown, auto-tick, anti-cheat
lib/bank/       CSV/Excel row conversion (browser) and JSON-Schema validation (server)
schemas/        question-bank.schema.json
supabase/       setup.sql
```
Local development: `npm install`, copy `.env.example` to `.env.local` and fill in the values, then run `npm run dev`.

**Design notes**
- The server is the only thing that changes game state. Each change increases a version number and is broadcast once on
  the Supabase Realtime channel `room:{code}`. Every screen shows its own view of the same snapshot and ignores older versions.
- Answers stay in Postgres behind Row Level Security (with no read policies). They leave the server for the first time when the answer is revealed.
- An answer submission is one Redis `HSETNX`: there's no locking, and a duplicate submission is rejected atomically. Scores are calculated
  once, at reveal, and saved together with the state change in a single compare-and-set write.
- The server stores each question's start and end times, and each screen runs its own countdown. When the timer hits 0, any screen may call `/tick`;
  the server ignores the call until its own clock agrees.

---

## Competition log and exports

**Every game is recorded automatically** (admin → **Competition log**). Nothing to switch on. The log is saved in the question
database (Supabase) as the game runs, a question at a time, so it survives even if the game is cut short or the room is deleted.
Each record keeps:

- every question exactly as it was asked (later edits to the pack don't change it)
- each team's answer exactly as typed, the server time it arrived, and **how it was marked** (exact match, accepted with a typo,
  no match), points and speed bonus
- anti-cheat events (left the screen, paste attempts) and host actions (time added/removed, answers locked early)
- standings after each reveal, the qualification cut and how ties were broken

Records also show the **order answers arrived** for each question ("3rd of 11", using the server's clock) and the **first team to
answer correctly**. Order doesn't change scores: the speed bonus and tie-breaks use time taken, not position.

Records are read-only and stay until you delete them. Open one to see **Standings**, **Teams' answers** (search a team to settle
a challenge on the spot), **Questions** (how many got each one right, common wrong answers) and **Timeline**.

Downloads and printouts (use the browser's *Save as PDF* for a PDF; Thai prints correctly):
- **Qualified list**: one page to hand to the afternoon organisers, with signature lines
- **Full report**: standings, question summary, anti-cheat and host actions
- **One team's answer sheet**: from the Teams' answers tab
- **Excel** (tabs: Standings, Answers, Questions, Timeline) and **CSV** (every answer)

Each report shows a **check code**. Export the same record again later: the same code means nothing in it has changed.

**Whole question bank backup** (Question bank → *Back up the whole bank*): every pack in one CSV or Excel file, in the Import
columns. Importing it back recreates the packs; the same question ids update in place.

**Question packs** (Question bank → open a pack → *Export*): CSV or Excel in the same columns as Import, so you can edit a pack
in a spreadsheet and import it back; question ids are kept, so re-importing updates questions instead of duplicating them.
Also a printable **question sheet**, with answers for the host and judges, or questions only as a paper backup.

**Keeping Supabase awake:** free Supabase projects pause after a week without use. The app includes a daily Vercel cron job
(`vercel.json` → `/api/cron/keepalive`) that makes one tiny read each day, so the question bank is ready on the day of the event.
