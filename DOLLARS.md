# Dollars fork

Repository: https://github.com/arition/misskey

This is a small, release-based customization fork of https://github.com/misskey-dev/misskey. The initial production line is `dollars/2026.11.0`, based on the unmodified upstream tag `2026.11.0`. The fork's existing `develop` and `master` branches are not deployment branches and are left untouched.

## Commit discipline

Keep each feature independently reviewable and removable:

- `feat(typography): ...` owns Inter assets, its two stylesheet imports, feature documentation, and tests.
- `build(fork): ...` owns the fork image workflow and maintenance documentation.
- A future LLM translation feature must have its own commit or focused series. Do not mix it with typography, unrelated formatting, lockfile refreshes, or upstream synchronization.
- Do not rewrite published commits or force-push shared branches. Integrate a new upstream release on a new release branch instead.
- Prefer one-line integration points and feature-local implementation files. Add comments explaining non-obvious behavior, not large custom-code marker blocks throughout upstream files.

## Current feature: self-hosted Inter

Implementation and font license: `packages/frontend-shared/dollars/`.

The only changes to existing upstream UI source are one `@use` statement in each global stylesheet. Vite compiles these normally and emits content-hashed font assets. There is no post-build manifest patch and no dependency on the old container overlay.

Check the feature with:

```sh
node --test scripts/dollars/typography.test.mjs
node scripts/check-shipping.mjs --base 2026.11.0
```

A full source build and browser checks are also required before deployment. See the feature README for expected font behavior.

## Image build

The `Dollars source image` workflow runs on pushes to `dollars/**` in this fork. It:

1. Checks out the exact source revision without retaining checkout credentials.
2. Builds the upstream Dockerfile's `native-builder` stage, including both frontends and backend.
3. Runs the repository shipping checks and feature tests inside that build environment.
4. Builds the upstream runtime image from the same revision.
5. Uploads `dollars-image-<full-commit-sha>` with a compressed Docker image, image reference, source revision, and checksum manifest.

`.git` is excluded from container build contexts. Never put production settings, database exports, SMTP credentials, or API keys in this repository.

The artifact targets `linux/amd64`, matching arition-nas, and expires after three days. Keep the active image in the NAS's service-account image store; rebuild an old revision when its artifact has expired. The workflow does not publish to Docker Hub/GHCR and requires no registry credential. A remote registry can be added separately if desired.

### Deploying an approved build

- Download the successful run's artifact using authenticated GitHub access.
- Verify its checksum and source revision, then load it into the `misskey` account's rootless Podman image store, not root's store.
- Inspect the loaded image's revision label and record its exact image ID.
- Validate the image and configuration before selecting it in the existing `misskey-web` Quadlet.
- Agree on a brief application restart window. Restart only Misskey; do not restart PostgreSQL or Redis for this typography-only migration.
- Recheck HTTPS, actual font rendering, CJK fallbacks, icons, code, system-font preference, and streaming.
- Record the source commit and active image ID in the NAS deployment records.

There is no automatic production deployment. There is no scheduled backup job. Do not introduce backup procedures that interrupt services.

## Integrating a new upstream release

Use new release branches so existing deployed history remains available. For example, after fetching upstream tags:

```sh
git switch -c dollars/2026.12.0 origin/dollars/2026.11.0
git rebase --onto 2026.12.0 2026.11.0
```

Resolve each custom commit independently. Update the shipping-check base tag in the fork workflow and this guide to the selected new release. Review upstream requirements and migrations, rerun checks, and push the new branch normally. Do not force-push `develop`, `master`, or the previously deployed release branch.

Build success is not deployment approval. In particular, a future backend or database feature needs its own compatibility and recovery review before production use.

## Source availability

Keep deployed custom source accessible at this repository, identified by the image's `org.opencontainers.image.revision` label. Configure the instance's repository/source link to this fork when deploying it. Misskey code remains AGPL-3.0-only; the bundled Inter font files retain the separate SIL Open Font License.
