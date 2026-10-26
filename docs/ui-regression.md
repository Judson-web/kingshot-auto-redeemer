# UI accessibility and visual regression checks

The UI regression suite runs against a local Vite production preview so it tests the exact candidate build, not a possibly stale production deployment. All service/API calls are replaced with fixed, non-sensitive fixtures; no real user account, support ticket, gift code, or database row is touched.

## What is checked

- WCAG 2.0/2.1/2.2 A/AA rules with axe-core. Critical and serious findings fail CI; moderate and minor findings are reported as warnings for incremental cleanup.
- Five deterministic Chromium/mobile screenshots: home, open Support Centre, signed-out Profile, signed-out Developer API, and the protected player database.
- Pixel differences against committed PNG baselines, with a small antialiasing tolerance.
- Horizontal overflow at 320, 360, 393, 768, and 1280 CSS pixels; Support panel viewport bounds; and collisions between notification and Support launchers when both are visible.
- Expected route state and uncaught browser JavaScript errors.

## Run locally

Use Node 24, install the app dependencies, then install the pinned test-only tools and Chromium:

    npm ci
    npm exec --yes --package=playwright@1.64.1 --package=axe-core@4.14.0 --package=pixelmatch@6.0.0 --package=pngjs@7.0.0 -- playwright install chromium
    TEST_MODULES="$(npm exec --yes --package=playwright@1.64.1 --package=axe-core@4.14.0 --package=pixelmatch@6.0.0 --package=pngjs@7.0.0 -- sh -c 'dirname "$(dirname "$(realpath "$(command -v playwright)")")"')"
    export UI_TEST_MODULES="$TEST_MODULES"
    npm run build
    npm run preview -- --host 127.0.0.1 --port 4173

In a second terminal, run:

    UI_TEST_BASE_URL=http://127.0.0.1:4173 npm run test:ui

The test command writes JSON reports and any screenshot/difference images to test-results/ui-regression/.

## Updating intentional visual changes

After reviewing the UI change in a browser, run the same test command with UI_UPDATE_SNAPSHOTS=1. It updates the PNG baselines under tests/visual/snapshots/. Commit those files with the intentional design change. Do not update baselines just to silence a regression.


## Refresh baselines using the CI renderer

Local/remote browser font rasterization can differ from GitHub's pinned Chromium environment. To refresh the PNGs using the exact CI browser, create a **deliberate commit** whose commit message contains `[update-visual-snapshots]`. The workflow switches to snapshot-generation mode for that run, still executes the axe accessibility and responsive checks, uploads the report/diff artifact, and only commits the generated PNGs if the full UI job passes. The bot's follow-up commit does not contain the marker, so it runs the normal pixel-diff checks.

Do not add that marker to an ordinary feature commit. It intentionally records the UI as the new baseline, so review the uploaded snapshots and the resulting bot commit.
