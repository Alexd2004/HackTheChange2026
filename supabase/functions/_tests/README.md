# AI function tests

Tests for the Edge Function code in `supabase/functions` (Gemini calls, resume comparison, stage picking,
answer shuffle, Keenable). The folder starts with `_` so the Supabase CLI never deploys it as a function.

Needs [Deno](https://deno.com) (`winget install DenoLand.Deno`). Open a **new terminal** after installing.

## Run

From the project root:

```
cd supabase/functions/_tests
deno task test      # offline: no API keys, no network calls to Google, takes a few seconds
deno task live      # live: calls the real Gemini and Keenable APIs, takes about 40 seconds
deno task check     # type-checks the create-plan, generate-level and revamp-resume functions
deno task tune      # timing + quality report on the full pipeline for 3 sample pairs (about 5 minutes; add -- --pair=2 for one pair)
```

The first run downloads dependencies, so it is slower.

## Offline tests (`deno task test`)

| File | Checks |
|---|---|
| `shuffle_test.ts` | The correct answer lands in A/B/C/D about 25% each; the answer text follows its index; "All of the above" style options stay in place |
| `stage_skills_test.ts` | Which skills become stages: biggest gaps first, never more than 3, review stages when there are no gaps |
| `resources_test.ts` | The AI link picker: picks are taken by number, invented or repeated numbers are ignored, max 3, falls back to the top results if the AI fails, searches again with a simpler query when there are fewer than 3 results, no resources when the search is empty |
| `revamp_test.ts` | Resume revamp rules: which skills may be added, blocked skills removed from skills, summary, bullets and headline, earned skills always added, the AI's reply never written to logs |
| `resume_store_test.ts` | The on-phone resume store (`src/lib/resumeStore.ts`) with the phone's files faked: text and PDF round trip, only a tiny pointer in AsyncStorage, null when the file is gone, one resume per plan, ids can't escape the folder |
| `resume_html_test.ts` | The page printed to the revamped-resume PDF (`src/lib/resumeHtml.ts`): all content present, name and contact laid out, HTML in resume text is escaped, nothing loaded from the internet, empty fields leave no gaps |
| `gemini_test.ts` | `callGemini` with faked Google replies: normal call, 503 retry, bad JSON retry, 429, wrong key, wrong model name |

## Live tests (`deno task live`)

They read keys from `supabase/functions/.env` (`GEMINI_API_KEY`, `GEMINI_MODEL`, `KEENABLE_API_KEY`).
A test is skipped if its key is missing.

| File | Checks |
|---|---|
| `keenable_live_test.ts` | A real search returns parsed resources |
| `fit_live_test.ts` | Sample resumes vs sample postings: PostgreSQL counts as SQL, a career changer has gaps, "Power BI or Tableau" is one skill, a strong resume has almost no gaps |
| `map_live_test.ts` | The map has 3 stages of 7 levels, and the boss questions cover the earlier levels |
| `shuffle_live_test.ts` | Shuffled multiple-choice questions still pass the verification call |
| `resources_live_test.ts` | A real search then the real AI picker returns 1 to 3 different links, all from the search results; a nonsense level doesn't crash or invent links |
| `revamp_live_test.ts` | Real Gemini revamp of a pasted resume and of a PDF: earned skill added, blocked skills absent, contact/employers/dates copied exactly, no invented numbers |
| `question_quality_live_test.ts` | Level 6 of 6 is harder than level 1 of 6, questions stay short, and the numbers are printed next to the mock level file |

The samples in `samples/` are made-up people and postings, not real data.

## Things to know

- **Live tests use your Gemini quota.** A full run is about 15 requests. The free tier allows only so many
  requests per minute, so a second run right away can fail with a 429. Wait a minute and run again.
- **Live results vary a little** because Gemini does. If one check fails by a small margin, run it again
  before treating it as a bug.
- **Override the model for one run** without editing any file (PowerShell):
  `$env:GEMINI_MODEL = "gemini-3.5-flash-lite"; deno task live`
- If Google keeps returning `503 high demand` for your model, that is Google being busy, not a code bug.
  Try another model name from AI Studio.

## Tuning report (`deno task tune`)

Runs the real create-plan and generate-level pipelines (no database) for three made-up resume and posting pairs and
prints timings against the targets (create-plan under 20 s, a level under 15 s). It flags vague concepts, more than 3
stages, levels that are not 7 per stage, concept names not on the level's list, long explanations, a flat difficulty
ramp, missing resources, and a boss that skips earlier levels. It paces itself under the 15 requests/minute free limit,
so the pauses it prints are normal. Occasional slow levels (20 s or more) are Google latency spikes, not a code problem.
