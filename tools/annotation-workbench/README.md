# Mettle Annotation Workbench (BS1-H)

A **local, standalone developer / dataset tool** for turning a BS1-G `AnnotationBundle` JSON
into BS1-F–compatible `GroundTruthLabel` JSON. It is **not** part of the Mettle consumer app,
is not wired into `index.html` or the Android build, and makes **no network calls**.

```
tools/annotation-workbench/
  index.html                  the workbench UI (open this)
  annotation-workbench.cjs     pure data core (also used by node --test)
  annotation-workbench.test.mjs unit tests
  fixtures/synthetic-bundle.json  a SYNTHETIC 2-image bundle for trying the tool / tests
```

## Open the tool

Double-click `tools/annotation-workbench/index.html`. It is fully self-contained (inline CSS,
one classic `<script src="./annotation-workbench.cjs">`, no CDN, no remote fonts/scripts/styles,
no build step). Chrome / Edge / Firefox all open it directly from `file://`.

## Load a bundle

Use the file picker in the header, or drag a `*.json` `AnnotationBundle` onto the drop zone.
The bundle must have `schemaVersion: "annotation-bundle/1"` — a foreign schema is **rejected
cleanly** and never repaired. Try `fixtures/synthetic-bundle.json` first (1×1 placeholder PNGs,
clearly marked `SYNTHETIC — NOT USER DATA`).

## Annotate

For each image the workbench shows:

- the synchronized keyframe, **display-transformed only** to the intended human orientation
  using the entry's `rotationDegrees` + `mirrored` metadata (the JPEG bytes are never modified);
- read-only observation identity (pose, observed region, observation id, timestamp, sync,
  coherence, yaw/pitch/roll, dimensions). `EXACT_SYNCHRONIZED` is visually distinct from weaker
  sync;
- one panel per **region to label** with two `<select>`s that store **canonical BS1-F values**:
  - **HairState**: `BEARD_CONFIRMED`, `NON_BEARD_CONFIRMED`, `BOUNDARY`, `UNCERTAIN`, `UNKNOWN`
  - **AnnotationStatus**: `LABELED`, `AMBIGUOUS`, `NEEDS_REVIEW`, `EXCLUDED`, `UNKNOWN`
  - optional `annotationConfidence` (`0..1`, blank = null) and free-text notes.

Every unlabeled region starts at `HairState.UNKNOWN` / `AnnotationStatus.UNKNOWN` /
`annotationConfidence: null`. It is **never** defaulted to `NON_BEARD_CONFIRMED`.

**Keyboard:** click a region panel to make it *active*, then `1`=beard, `2`=skin/no-beard,
`3`=boundary, `4`=uncertain, `5`=unknown set that region's HairState. Shortcuts never fire
inside a text field and never navigate, so they can't advance and lose work.

`Previous` / `Next` move between images. "Completed" = every requested region on an image has
a non-`UNKNOWN` `AnnotationStatus`.

## Geometry Guide (optional, default OFF) — Stage BS1-H2

A **developer aid** that draws Mettle's **verified** lower-face landmark rails over the
keyframe so an annotator can see where the tracked jaw / chin / cheek / mouth-reference
anatomy sits. Toggle it with **Geometry Guide: OFF / ON** in the stage bar. It starts **OFF**
and the human image is always primary.

**It shows only verified geometry.** Every rendered landmark index is a member of an existing
`index.html` constant — `LOWER_FACE_DIAGNOSTIC_SETS.jawChinRail` / `cheekRailA` / `cheekRailB`
/ `mouthReference`, `ANATOMY_LANDMARKS`, `PERSON_ANATOMY_SIDES`. No landmark number is invented
by the workbench. See `accuracy/annotation-overlay-data.mjs` for the full group → index → source
table.

**It does NOT show**, and never will:

- under-jaw / neck / chin-to-neck-transition geometry (BS1-C `UNSUPPORTED_REGIONS`);
- sideburn / upper-cheek / moustache-proper geometry (no verified source set exists);
- the `index.html` derived throat point (`derivedThroatPointFromDisplay` / `drawDerivedNeck`) —
  that is a 2D display heuristic, not tracked geometry, and is explicitly excluded;
- any beard / non-beard / boundary / recommended-neckline meaning. **The overlay is anatomical
  reference only** — the caption in the tool says so. It must not bias the human toward a future
  segmentation model: manual `HairState` is decided from the **image**, not the overlay, and
  every region still starts `HairState.UNKNOWN` / `AnnotationStatus.UNKNOWN`.

**Availability.** A BS1-G `AnnotationBundle` **v1** carries **no landmark coordinates** — the
BS1-F manifest and BS1-G bundle only hold an `imageRef` handle, image dimensions, pose angles
and region *names*. So on today's bundles the toggle shows **GEOMETRY GUIDE UNAVAILABLE** and
is disabled. The overlay renders only when an entry additionally carries an
`annotation-overlay-data/1` object (schema in `accuracy/annotation-overlay-data.mjs`). Populating
that object from a real transient keyframe is **future BS1-I work** — it is not implemented, and
no real keyframe resolver exists yet. `AnnotationBundle` v1 is unchanged and stays backwards
compatible: `overlayData` is an optional side field.

**Coordinate space.** Overlay points are raw keyframe pixels (`space: "IMAGE"`), the same
system as the JPEG, *before* the rotation/mirror display transform. The workbench renders the
overlay inside the **same** transformed wrapper as the `<img>`, so rotation and mirroring are
byte-identical for image and overlay. `CAPTURE_NORMALIZED` coordinates are refused, never
reinterpreted as pixels. If the image is unavailable, there is no overlay.

The geometry-guide **toggle state** (a single boolean) is the only thing added to autosave; it
never writes coordinates or pixels.

## Outer-beard contour tool (optional) — Stage BI-1Y

A **second, wholly additive evidence layer** for tracing the visible **outer beard silhouette**
— never skin, never hidden anatomy. It appears automatically when a loaded bundle entry carries
`contourTypesToAnnotate` (a BI-1W-only bundle shows nothing new; nothing about the categorical
HairState/SurfaceObservability tool above is touched).

Three contour types, each an **open polyline** (never forced into a closed polygon):
`OUTER_BEARD_UNDERSIDE`, `OUTER_BEARD_UNDER_JAW_LEFT`, `OUTER_BEARD_UNDER_JAW_RIGHT` (left/right
ordering matches the project's established `UNDER_JAW_LEFT`/`UNDER_JAW_RIGHT` convention). Click
**Trace**, then click along the visible BEARD-to-AIR/BACKGROUND edge from one end to the other
(never the natural/desired neckline — stop the line where the visible edge stops), **Undo last
point** to fix a slip, **Finish** to mark it `TRACED` (needs 2+ points), or **Not traceable** /
**Unknown** if the image doesn't show it reliably — both always clear any points, since neither
legitimately carries coordinates.

Every contour instance starts in a fourth, non-final internal state, `UNSET` — "nobody has
reviewed this yet" — never the real answer `UNKNOWN`, which only appears once the annotator
explicitly clicks **Unknown**. **Export Contour JSON** stays disabled until every requested
contour instance across the whole bundle has one of the three explicit decisions
(`TRACED`/`NOT_TRACEABLE`/`UNKNOWN`); an `UNSET` instance can never be exported.

Points are captured in the same raw-image-pixel space as the geometry overlay below (`space:
"IMAGE"`, pre display-transform), converted from the click's on-screen position using the real
`<img>` `naturalWidth`/`naturalHeight` — never the CSS/display size — so a contour never shifts
when the window resizes or the zoom slider changes. Points are stored and exported in the exact
order clicked; nothing is smoothed, resampled, or auto-closed.

Autosaves under a **separate** `localStorage` key
(`mettle.annotation-workbench.contour-autosave.v1`), fingerprint-gated the same fail-closed way
as the categorical autosave, and exports via its own **Export Contour JSON** button to
`{ contourWorkbenchVersion, bundleFingerprint, sourceMethod: "MANUAL_GROUND_TRUTH", summary,
contours[] }` — each `contours[]` row carries full raw-observation identity, `contourType`,
`annotationStatus` (`TRACED`/`NOT_TRACEABLE`/`UNKNOWN`), ordered `points`, `coordinateSpace`, and
`imageWidth`/`imageHeight` for exact pixel reproducibility. Validation fails closed (never
repairs) on an unresolvable identity, a `TRACED` contour with too few points or no dimensions, an
out-of-bounds point, a duplicate `contourId`, a missing timestamp, or the sealed BI-1W holdout
identity appearing anywhere.

**Coordinate calibration.** Before collecting real contour GT, open
`tools/annotation-workbench/coordinate-self-test.html` (a separate, removable developer-only
page — no autosave, no data, not wired into anything) and click through its 5 crosshair targets
under a few display states (default, zoomed, mirrored, rotated, after a window resize). Every
target should read PASS with a pixel error near 0; it exercises the exact same
`annotation-workbench.cjs` + `#imgStack > #img` transform structure as this page, so a pass there
is a real confirmation of the click → canonical-coordinate path, not just of the underlying ratio
math (which is separately unit-tested).

## Assisted beard-boundary review (optional) — Stage BI-1Y2

A **third, wholly additive evidence layer**: MACHINE PROPOSES → USER REVIEWS → USER DRAGS/CORRECTS
→ USER APPROVES. Appears when a loaded bundle entry carries `assistedReviewTargets` (currently
one target, `VISIBLE_BEARD_SILHOUETTE` — BI-1Y's own bake-off found a single closed beard
silhouette a far more reliable review primitive than three independent open lines, which is what
made BI-1Y's manual open-edge traces hard to get right in the first place).

Click **Generate proposal** to run a small, dependency-free, CPU-only pipeline
(`beard-proposal.cjs`: Otsu darkness threshold inside a rough prior region, binary morphology,
largest-connected-component, Moore boundary trace, Ramer–Douglas–Peucker simplification) entirely
in the browser against the real decoded image. The prior region comes from `priorHintPoints` —
old BI-1Y traces, if present, used **only** as a coarse search-region hint, never as the answer.
Drag any handle to correct it (arrow keys nudge 1 image px, Shift+arrow 5px, with a live magnified
crop of the selected point), **Add point** / **Delete selected point** / **Undo** / **Reset to
proposal** as needed, then **Approve as-is** (zero edits made), **Approve corrected**, **Reject
proposal**, or **Not traceable**. A proposal is never GroundTruth by itself — only an explicit
approval is, and **Export Assisted Review JSON** stays disabled until every requested item has an
explicit decision. Every export row keeps the original dense machine proposal AND the human-final
points as separate fields (`sourceMethod: "HUMAN_VERIFIED_ASSISTED_GROUND_TRUTH"`, `isGroundTruth`
computed from the review status) so future accuracy metrics (proposal-to-human distance, percent
accepted unchanged, etc.) can be computed without re-deriving anything.

**Self-describing dimensions (BI-1Y3 fix).** The real decoded `imageWidth`/`imageHeight` are
captured once per image (from the same `naturalWidth`/`naturalHeight` used to run the proposal
pipeline) and now travel into every export row — a BI-1Y2-era bug read the bundle entry's own
(always-null) `imageWidth`/`imageHeight` metadata instead. `validateAssistedReviewExport` fails
closed on any GroundTruth row missing valid positive dimensions, since IMAGE-coordinate
GroundTruth without them cannot be reproduced later. **Telemetry caution:** `editCount`/
`pointsMoved` count every `pointermove` event fired during a drag (hundreds per gesture) — never
read them as "number of corrections". `dragGestureCount`, `distinctHandlesMovedCount`,
`netVertexDisplacementPx`, and `totalVertexDisplacementPx` (recorded once per completed drag, via
`recordDragGesture`) are the honest human-effort metrics for sessions recorded after this fix.

## Autosave

After every change the workbench writes to `localStorage` under
`mettle.annotation-workbench.autosave.v1`:

- your labels / statuses / confidence / notes and the current image position;
- a small **identity-only** bundle fingerprint (`schemaVersion|bundleId|datasetId|
  datasetRevision` + per-entry `sourceScanObservationId|timestamp|imageRef|pose|sync`).

It **never** stores `rawImagePayload` / base64 / any pixels. On reload, load the same bundle
JSON again — if its fingerprint matches the autosave, your labels reattach; if it does not,
the workbench **fails closed** and does not attach saved labels to a different dataset.

## Export

`Export GroundTruth JSON` downloads `{ workbenchVersion, exportedAt, bundleFingerprint,
bundleId, datasetId, datasetRevision, sourceMethod: "MANUAL_GROUND_TRUTH", summary, labels }`.
Each `labels[]` row is BS1-F `GroundTruthLabel`–shaped: `labelId`, `scanSessionId`,
`sourceScanObservationId`, `imageRef`, `nativeFrameTimestampNs`, `poseId`, `observedPoseRegion`,
`anatomicalRegion`, `hairState`, `annotationStatus`, `annotationConfidence`, `syncStatus`,
`sourceMethod = MANUAL_GROUND_TRUTH`, `revision`, `notes`. **No raw image / base64.** All
requested regions are exported (including unfinished `UNKNOWN` ones) — BS1-F handles ambiguous /
needs-review / excluded / unknown fail-closed, so nothing is silently discarded.

## Downstream flow

```
AnnotationBundle (BS1-G)
  -> this workbench
  -> export.labels[]           (BS1-F GroundTruthLabel shape)
  -> accuracy/ground-truth-dataset.mjs  assembleGroundTruthDataset(scanPackage, labels.map(makeGroundTruthLabel))
  -> accuracy/semantic-evaluation.mjs   evaluateSemanticProducer(predictions, groundTruthDatasetToEvaluationEntries(ds).scoredEntries)
```

## What this tool does NOT do

No model, no segmentation, no beard/skin inference, no polygon / pixel-mask tool, no landmark /
mesh / contour / neckline overlay, no image editing (crop / resize / filter / re-encode), no
network, no analytics, no cloud upload, no Android/production integration. It is intentionally
minimal and aligned to exactly what BS1-E can score today: **per-observation, per-AnatomicalRegion
HairState**.

## Tests

```
node --test tools/annotation-workbench/annotation-workbench.test.mjs
```
