# accuracy/ — source-side accuracy foundations (not shipped, not wired in)

Isolated, pure, dependency-free modules that advance Mettle's accuracy architecture
ahead of physical-device validation. Nothing here is imported by `index.html` or bundled
by the Cloudflare worker (`worker.js` only imports `*.html`; `wrangler.jsonc` only globs
`**/*.html`). None of it runs in the app today.

## `beard-surface-core.mjs` — Personalized Beard Surface: core model + fusion contract

Stage **BS1-A**. A compact data model and deterministic fusion primitives for a future
per-user "Personalized Beard Surface": lower-face anatomical regions, where facial hair is,
where the beard boundaries are, which observations came from scan landmark geometry vs.
semantic evidence (segmentation **or** manual ground truth — both are counted as semantic
evidence since BS1-D1), per-region confidence, multi-view support, and — explicitly — what is
unknown.

It reuses the existing `index.html` accuracy vocabulary: the six `A60_POSES` scan-pose ids,
the "face-local, **not** millimetres" 3D space used by `computeCrossPoseLowerFace3D()`, and
the deterministic `median()` / `mad()` summarisation style.

Scope guards for this stage:

- It does **not** solve beard segmentation — no model, no mask, no inference.
- It does **not** do 3D reconstruction, spline fitting, or invent hidden-surface geometry.
- It is **not** integrated with Scanner, Live Map, `registeredPointMapper`, `guardSequence`,
  the A6.0/A6.0A/A6.0B spatial-observation capture, T1, CAM1-A, ARCore, ML Kit, camera
  selection, or the UI.
- `UNKNOWN` is a first-class value everywhere; missing segmentation never becomes "no beard",
  and `readyForLiveMap` never becomes true here (defaults to `NOT_EVALUATED`).

### Run the tests

```
node --test "accuracy/*.test.mjs"
```

Runs the 10 `accuracy/` test files (245 tests as of BS1-H2.1). The bare-directory form
`node --test accuracy/` does **not** work on the current Node (it tries to load `accuracy`
itself as a test module and fails); pass the quoted glob instead. To also run the local
annotation-workbench suites: `node --test "tools/annotation-workbench/*.test.mjs"`.

(Uses Node's built-in test runner — no dependencies. Node ≥ 21 for the `--test` glob.)
