# Phase 0: v31 Baseline Protection

## Baseline identity

- Physically accepted application version: **v31**
- Baseline branch at Phase 0 verification: `master`
- Baseline Git commit: `3974023` (`fix(scanner): add phone landmark diagnostics`)
- The existing web application at this baseline is the rollback target throughout the native Android migration.
- Creating code, passing automated checks, or creating a commit does not change the physically accepted version.
- Phase 0 does not change `APP_VERSION` or any visible version label.

At Phase 0 verification, the worktree already contained Wrangler-generated runtime changes under `.wrangler/`. Those files are not part of Phase 0 and must not be included in its commit.

## Current v31 web architecture

The working product remains a browser application deployed through Cloudflare:

- `index.html` contains the current v31 user interface, browser camera scanner, MediaPipe face tracking, style selection, preview presentation, and Live Beard Map.
- `worker.js` is the Cloudflare Worker entry point and serves the web application and current backend behavior.
- `wrangler.jsonc` configures the Worker, static HTML text rule, compatibility date, `workers_dev`, and the remote Workers AI binding.
- `package.json` contains the current local development, deployment, and validation commands.
- `package-lock.json` locks the current Node dependency graph.

Phase 0 does not alter scanner behavior, Live Map behavior, preview behavior, Worker behavior, or Cloudflare configuration.

## Existing development and Cloudflare commands

Run commands from the repository root.

| Purpose | Command |
| --- | --- |
| Install locked dependencies | `npm ci` |
| Start local Cloudflare development server | `npm run dev` |
| Validate the Worker with a Cloudflare dry run | `npm run check` |
| Deploy the Worker | `npm run deploy` |

The package scripts resolve to:

- `npm run dev` -> `wrangler dev`
- `npm run check` -> `wrangler deploy --dry-run`
- `npm run deploy` -> `wrangler deploy`

There is currently no separate build, unit-test, lint, or type-check script in `package.json`. The existing automated web/Cloudflare check is the Wrangler deployment dry run. A real deployment is not part of Phase 0.

## Additive native Android boundary

The future native Android application will be introduced additively and in isolation:

- It will live under a dedicated top-level `android/` Gradle project when Phase 1 is approved.
- It will not replace or relocate the existing root web application.
- Android dependencies, build files, generated output, tests, and native source will remain inside the Android project.
- Shared native/web contracts may be added later through explicitly versioned schemas.
- The existing Cloudflare backend and deployable v31 web application remain independently buildable and usable.
- Native features must be capability-gated so the accepted web baseline remains a fallback and rollback path.
- Phase 0 creates no Android project and introduces no native dependency.

## Approved privacy rules

- Scan operation is session-only by default.
- Completing a scan does not grant permission to persist biometric-like data.
- Raw burst photographs, candidates, landmarks, meshes, matrices, temporary images, object URLs, preview caches, fusion intermediates, personalized models, and live registration state must not automatically persist beyond the session.
- The 8-10 retained photographs per pose are temporary working inputs for validation and model fusion. Raw photographs no longer required must be released after successful model construction and validation.
- The default flow must not permanently retain the complete 48-60-photo scan set.
- Persistent encrypted local storage is permitted only after the explicit user action **Save My Face Profile on This Device**.
- **Delete Scan / Start Over** must immediately clear raw burst images, retained candidates, landmarks, matrices, the fused model, preview caches, temporary files, object URLs, and live registration state.

## Approved versioning rules

- The current physically accepted version remains **v31**.
- Creating code does not advance the accepted version.
- Passing automated checks or creating a commit does not advance the accepted version.
- A phase advances the accepted version only after implementation, automated checks, an isolated phase commit, physical-phone testing, and explicit user approval.
- Failed, incomplete, or rejected phases do not receive a version bump.
- The first physically approved upgrade after v31 becomes v32; subsequent approved upgrades advance sequentially.
- A future phase must establish one `APP_VERSION` source of truth for all visible labels. Phase 0 must not change the current value.

## Approved image-export rules

- Export is allowed only after the user intentionally presses **Save Image** from **Photo Preview** or **Live Mirror**.
- Only the deliberately exported image receives a small, tasteful **BEARD TRIM MAP** watermark burned into its bottom-left corner.
- Scanner frames, burst frames, model-building images, AI working images, temporary previews, and diagnostic captures must not be watermarked.
- No image may be exported or written to the gallery automatically.

## Approved preview-provider rule

- Level 1 is a deterministic personalized preview that is identity-safe by construction.
- Level 2 is optional AI refinement constrained to a localized edit region, followed by protected-pixel restoration and output validation, with deterministic Level 1 fallback.
- No AI provider is a permanent production dependency yet.
- Provider selection occurs only after beard-specific comparison testing for identity preservation, realism, beard-style accuracy, mask leakage, boundary accuracy, latency, reliability, and cost.

## Mandatory phase gate

Implementation proceeds one phase at a time. After every implementation phase:

1. Run the phase-specific automated checks.
2. Review the complete diff and confirm its scope.
3. Commit only that phase with a phase-specific commit message.
4. Stop development.
5. Provide explicit physical-phone test steps and report automated results.
6. Wait for physical-phone testing and explicit user approval before beginning the next phase.

The accepted version does not advance at the commit boundary. It advances only after the complete gate above has succeeded and the user explicitly approves the phase.

## Phase 0 scope guarantee

Phase 0 may add documentation only under `docs/native-architecture/`. It must not modify:

- `index.html`
- `worker.js`
- `wrangler.jsonc`
- `package.json` or `package-lock.json`
- `APP_VERSION`
- Scanner, Live Map, preview, or Cloudflare behavior
- Any Android project or native source
