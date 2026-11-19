# Roles and access

One list decides what each person sees and may do. It lives in `backend/app/catalog.py` and is used twice:

* **By the API.** Endpoints are guarded with `needs("<capability>")` (see `app/api/deps.py`), so a request is refused with 403 no matter what the UI shows.
* **By the UI.** `GET /api/v1/meta` returns an `access` block for the signed-in person (`home`, `navigation`, `pages`, `capabilities`) and a `ui` block with the page text. The sidebar, the page guard and every button read from it. The frontend has no list of pages, roles or permissions of its own.

| Role | Can additionally |
|---|---|
| Viewer | Look at everything, change nothing |
| Member | Decide approvals, connect agents, run benchmarks and recovery simulations, load demo data, add scenarios, ask the AI to explain a run |
| Admin | Edit safety rules, manage people, API keys and settings, create workspaces, see the security log |

Everyone lands on **Home**. **My work** (Member) and **Admin console** (Admin) are in the account menu, next to Settings. Navigation: six sections across the top (Home, Agents, Activity, Problems, Safety, Test & Improve), each with a few tabs, defined in `SECTIONS` and `PAGES` in `catalog.py`. Pages: **My work** needs Member, **Admin console** needs Admin, **Connect an agent** needs Member. Opening a page your role does not include shows an explanation and a button back to your home page.

## Deleting
Every delete asks first and says what will go with it. Deleting a run removes its steps, findings, risk predictions, rule decisions, approvals and recoveries together, so nothing is left behind.

| What | Who |
|---|---|
| A run, an agent (and its runs), demo and sample data | Admin (`delete_data`) |
| Your own practice situations | Member (`delete_scenario`) |
| A safety rule | Admin (`edit_policies`); past decisions stay in the log |
| A person | Admin (`manage_team`); never yourself, never the last admin |
| An API key | Admin (`manage_keys`); revoke it first, then delete it |

Every delete is written to the security log.

## Changing who can do what
Edit `CAPABILITIES` or `PAGES` in `catalog.py`. No frontend change is needed. `test_access_catalog_matches_what_the_api_enforces` checks that the UI's view and the API's behaviour agree for every role.

## Page text
All wording is served by the backend: `backend/app/ui_strings.json` (the sentences on each screen) and `UI` in `catalog.py` (pages written by hand: Scenarios, Overview, Connect, My work, Admin console, Risk, delete dialogs, login, menu). The screens read them with `useT("page")` / `useText("page")`. `npm test` fails if a sentence is written into a screen (`src/test/no-hardcoded-text.test.js`), if a screen asks for wording that does not exist, or if a screen uses an undefined variable. New screen? Write it normally, then run `npm run extract-text` and it moves the wording out. After changing wording or `catalog.py`, run `python scripts/export_catalog_fixture.py` so the UI tests see it. The only text left in the frontend is what to say when the server cannot be reached (`config/offline.js`).

## Limits
Roles apply per workspace. Page access is enforced in the browser for convenience; the real protection is the API check. Keys are generated from the first words of each sentence (for example `there_must_always_be_at`); rename them in both places if you want friendlier ones.

## Simple and Advanced mode
Chosen in the account menu (default Simple, remembered in the browser). It changes only how things are shown: plain wording versus technical wording, and whether IDs, scores and raw detail appear. The data is identical in both. In `ui_strings.json` and `UI`, a key `name@advanced` replaces `name` in Advanced mode, so every term has a plain and a technical form side by side (for example "How often were the warnings correct?" and "Precision").
