# Releasing

How a version reaches HACS users, and how HACS counts installs.

## Steps

1. Move the `## [Unreleased]` entries in CHANGELOG.md under
   `## [X.Y.Z] - YYYY-MM-DD`, and set `"version": "X.Y.Z"` in
   `custom_components/yeelight_cube/manifest.json`.
2. Commit (`Release vX.Y.Z`), tag (`git tag -a vX.Y.Z -m "vX.Y.Z"`), and push
   `main` and the tag.
3. Publish a GitHub release for the tag `vX.Y.Z` (the CHANGELOG section as
   its notes). Publishing it starts the **Release Asset** workflow
   (`.github/workflows/release.yaml`), which attaches `yeelight_cube.zip`
   to that release.

## The zip

- HACS installs the integration from `yeelight_cube.zip` on the release
  (`hacs.json`: `"zip_release": true`, `"filename": "yeelight_cube.zip"`)
  and extracts it straight into `custom_components/yeelight_cube`. The zip
  therefore holds that folder's **contents** at its root (`manifest.json` at
  the top): exactly the files git tracks there at the tag, built by
  `scripts/release-zip.py` with `git archive` (never local or untracked
  files, never `__pycache__`).
- The HACS **Downloads** figure is GitHub's download count of that file on
  the current release. Releases up to v1.3.4 have no zip; HACS installs those
  from the repository files, and those installs are never counted.
- **Never rename the file** without changing `filename` in hacs.json in the
  same release: HACS would fail to download it.
- The workflow fails, and attaches nothing, if the tag is not the
  manifest.json version with a leading `v` (tag `v1.3.5` needs version
  `1.3.5`). Fix the version, then release again.

## After publishing

- Check the release page: **Assets** lists `yeelight_cube.zip` (besides
  GitHub's own "Source code" archives). Or run
  `gh release view vX.Y.Z --json assets --jq ".assets[].name"`.
- The workflow run (**Actions → Release Asset**) shows the attached size in
  its summary. If it failed (for example a GitHub outage), open the run and
  use **Re-run jobs**: the upload replaces any partial file.
- Until the zip is attached (normally under a minute), HACS cannot install
  that release.

## Build it locally

```
python scripts/release-zip.py --tag vX.Y.Z
```

It builds `yeelight_cube.zip` from `HEAD` (or `--ref`) exactly as the
workflow does and checks it: the same files as
`git ls-files custom_components/yeelight_cube`, `manifest.json` and
`www/lib/lit-all.js` at the root, and the version against the tag. The file
is git-ignored.
