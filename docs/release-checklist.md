# Release Checklist

Use this checklist before publishing any Lami.js package.

## Local Verification

```bash
pnpm install
pnpm typecheck
pnpm test:all
pnpm test:e2e
pnpm pack:smoke
pnpm perf:report
pnpm audit --prod
```

`pnpm pack:smoke` is the release gate. It builds all publishable packages,
packs them, installs the tarballs into a fresh consumer, typechecks imports,
and verifies runtime imports.

## CI Verification

Wait for all GitHub Actions jobs to pass:

- Node 20, 22, and 24 verification
- Performance smoke
- Package smoke
- Chromium, Firefox, and WebKit example flows

## Package Review

Check each publishable package:

- package versions match the intended release version
- package metadata is accurate
- `exports` and `types` point at `dist`
- `files` contains only publishable assets
- dependencies do not contain unresolved `workspace:` specs after packing
- package README and root docs describe the current behavior

For a final dry run before publishing:

```bash
pnpm -r publish --dry-run --no-git-checks
```

## Automated npm Release

The GitHub Actions release workflow lives at
`.github/workflows/release.yml`. It builds, verifies, packs, uploads release
tarballs as an artifact, and publishes the public packages in dependency order:

1. `@lami.js/runtime`
2. `@lami.js/compiler`
3. `@lami.js/ssr`
4. `@lami.js/web-component`
5. `@lami.js/vite`

Before the first automated release, configure npm trusted publishing for each
public package:

- GitHub owner/user: `Vheissu`
- Repository: `lami.js`
- Workflow filename: `release.yml`

The workflow also supports an `NPM_TOKEN` repository secret as a fallback for
the first publish or for accounts that are not using trusted publishing yet.
Prefer trusted publishing for normal releases. If a fallback token is needed,
use a granular npm token with read/write package access, the longest expiry npm
allows for the account, and 2FA bypass enabled only when the account or packages
require 2FA for publishing from CI. npm currently caps write tokens at 90 days,
so schedule rotation before the expiry date.

After copying the token locally, set it as a GitHub Actions secret without
printing it:

```bash
pbpaste | gh secret set NPM_TOKEN --repo Vheissu/lami.js
```

To test the release workflow without publishing, run **Release Packages** from
the GitHub Actions tab and leave `dry_run` enabled.

To publish a real release:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The workflow refuses to publish unless the git tag version matches the package
versions.

## Performance Report

Regenerate the report when performance-sensitive code changes:

```bash
pnpm perf:report
```

Run the report by itself, without package builds, browser runs, or publish dry
runs happening in parallel on the same machine.

Review `docs/assets/performance-report.md` and
`docs/assets/performance-report.svg` before referencing numbers in release
notes. Treat the report as a local smoke benchmark, not a formal framework
shootout.
