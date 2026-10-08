# Maintaining Card Documentation

User-facing prose, feature tables and YAML examples in [README.md](../README.md)
are hand-maintained. Automation replaces **only** the image tables between
`<!-- card-docs:KIND:GROUP:start -->` and matching `end` markers. Keep manual
text outside these blocks. Missing, duplicate or reversed markers fail the run.

## Coverage

[The scenario catalogue](../tests/card-docs-catalogue.json) registers runtime
variations and editor panels for Clock, Native Effects and Lamp Preview.
It supplies image names, captions, theme, width and actual card settings.
The README galleries are derived from the same catalogue. Add scenarios there
without manually adding image links. Editor IDs must match the real editor;
missing panels fail capture rather than silently producing a placeholder.
An editor entry is either its caption (`"general": "Global Settings"`) or
`{ "title": ..., "config": {...} }` when the panel only renders its settings
with a non-default option, such as `show_device_orientation: true`. Every
foldable editor section of the three cards is registered.

A new scenario has no screenshot until the Documentation Screenshots workflow
captures it, so `npm run docs:check` (and `npm run check`) lists it as
"pending capture" instead of failing. A scenario already in the README whose
image is missing still fails.

The other cards' historical images and Preview's extra layout examples are
still manual. To migrate another card, register its scenarios, load its actual
module and supply representative synthetic state in
[the browser fixture](../tests/card-docs-browser.js), then add gallery markers
inside its existing foldable sections. Prose is deliberately never inferred
from screenshots or rewritten by the job.

## Capture Fidelity

The runner opens the real Home Assistant frontend, intercepting card asset
requests to serve workspace files. HA supplies its real fonts, icons, theme
and components; the integration supplies the native font maps. Only lamp state
and favourites are synthetic. Fixture service/API calls are blocked. Dashboard,
lamp and profile settings are not saved; theme changes are in-memory only.

Each image is captured in fresh Chromium processes until two captures match:
normally twice. When the first two differ, a third capture decides, so a
single odd capture is outvoted and logged as a warning; three different
captures fail the run. Their captures and a diff image (magenta: real change,
yellow: rendering noise) go to `test-results/card-docs/`, which CI uploads as
the `card-documentation-diagnostics` artifact.

"Match" is defined in `tests/card-docs-compare.cjs`: same size, no pixel
channel more than 24 levels apart, and at most 0.5% of pixels different at
all. It is deliberately not byte-exact: Chromium's software rasterizer is not
bit-exact between processes for anti-aliased edges at fractional sizes, and an
exact compare failed CI on a different random image almost every run. Animation
phases, missing icons/fonts and layout shifts still fail. A newly verified
image that matches the committed one is not rewritten, so the publish job
never commits rendering noise. Checks also cover card bounds, lower-image content, overflow,
preview frames and required controls. Clock time and preview phase are fixed;
CSS transitions are disabled. Software rendering, greyscale text smoothing and
sRGB avoid compositor variation. Compare images using the same OS, HA and pinned
Playwright/Chromium versions; cross-platform antialiasing can differ.

## Local Commands

Use Node 22 and Python 3, then `npm ci` and `npx playwright install chromium`.
On Linux use `npx playwright install --with-deps chromium`.

For a fresh disposable HA on localhost:8123 (POSIX shell):

```sh
DOCS_HA_ONBOARD=1 npm run docs:update
```

Onboarding is restricted to localhost and creates an ephemeral user. Never use
it against an existing installation. Alternatively, log in directly using
`npx playwright codegen --save-storage=.ha-docs-auth.json http://YOUR_HA:8123`
and close that window after the dashboard loads. Then set `DOCS_HA_URL` and
`DOCS_HA_STORAGE_STATE=.ha-docs-auth.json` and run `npm run docs:update`.
This ignored file contains credentials: never upload, share or commit it;
delete it after use. The runner does not deploy anything to HA.

PowerShell uses `npm.cmd`, `npx.cmd` and `$env:NAME = 'value'`. Set `PYTHON` to
an executable path when needed. `DOCS_FILTER` selects matching image-name
substrings for focused capture; unset it for a complete run.

- `npm run docs:screenshots`: capture registered images, writing only after all comparisons pass.
- `npm run docs:readme`: refresh gallery blocks using existing images.
- `npm run docs:check`: fail if galleries are stale or images are missing.
- `npm run docs:update`: capture, then refresh galleries.
- `node --test tests/card-docs.test.mjs`: verify preservation of manual content and marker validation.

## Automatic Updates

[Documentation Screenshots](../.github/workflows/documentation-screenshots.yaml)
runs on relevant PRs, pushes to main, weekly and on manual dispatch. Changes to
integration code/assets, catalogue/tooling, package locks, README, SERVICES or
this guide trigger it. CI boots a disposable pinned HA container; no personal
HA credentials or physical lamps are required.

PR runs have read-only access and publish screenshot artifacts, not commits.
After successful main/scheduled/manual runs, a separate contents-write job
downloads the verified images and regenerates galleries against the checked-out
README. It commits **only README gallery changes and generated images** directly
to main. It never changes prose, versions, tags or releases. Unchanged output
produces no commit. Runs whose source revision is no longer main are skipped;
a concurrent push also causes the normal non-force git push to fail safely.
The bot commit marker prevents capture loops.

Branch protection must permit this bot push. If repository policy blocks it,
the publish job fails visibly and the verified artifacts remain available;
automation does not bypass protections. Remove retired scenario PNGs in the
same reviewed change that removes their catalogue entries; unrelated assets
are never deleted automatically.