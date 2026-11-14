# Regional coverage-aware daily dataset preparation

Implemented entry point: `packages/inference/src/regional-cli.ts`. This closes normalized geospatial preprocessing and leakage validation; it does not claim that raw VIIRS HDF/netCDF/geolocation/QA adapters or a real regional dataset have been acquired.

Run from `webplatform/`:

```powershell
npx tsx packages/inference/src/regional-cli.ts normalized-source.jsonl regional-rows.jsonl options.json
npx tsx packages/inference/src/train-cli.ts regional-rows.jsonl regional-rows.jsonl.manifest.json data/models/regional-daily
```

The options argument is optional. Default options require complete known mask coverage, operational availability cutoffs, a six-hour previous-mask window, environmental valid-time tolerance of one hour, and nearest available feature locations within25 km. Override distances/tolerance deliberately for a provider's actual sampling geometry. `retrospective:true` permits later receipt of historical observations/reanalysis, and marks the manifest accordingly. It never permits a forecast initialized after the prediction issue cutoff.

## Normalized source contract

One input JSONL line is one bounded `RegionalRecord` (TypeScript definitions in regional.ts). It provides:

- Stable record and complete-fire-event IDs, train/validation/test assignment, named region/fuel, UTC issue timestamp, target-window start/end and environmental feature valid time.
- One metric projected grid: explicit PROJ definition with `+units=m`, origin easting/northing, width/height and cell size exactly1,000 m. Maximum4,096 output cells per record. Geographic degrees or a requested finer target are rejected.
- Immutable source records containing provider, URL, dataset version, licence, SHA-256, native resolution and retrieval timestamp. Every mask/feature references one of these source IDs. Conflicting reuse of a source ID is rejected.
- Previous and target mask pixels: stable pixel ID, projected southwest corner, footprint width/height, classification `fire`, `no-fire`, `unknown` or `cloud`, quality `good`/`bad`, original observation timestamp and original receipt/availability timestamp. Those timestamps must come from source lineage, not be invented during this conversion.
- Environmental feature samples: named value and exact unit, projected location, valid/receipt timestamps, optional forecast issue timestamp, temporal kind (`observation`, `forecast`, `static`) and source ID. All coordinates must already use the declared grid CRS. Raw swath footprints and source rasters must be projected by an upstream adapter; the converter does not silently treat latitude/longitude as metres.

Records are bounded to100,000 pixels per mask and100,000 environmental samples; an input line may not exceed64 MiB. JSONL is processed one record at a time, and output honours stream backpressure. This is a bounded per-record raster assembly, not a global archive loaded into memory. Event/geographic/time identity sets remain resident for split validation.

## Labels and spatial aggregation

Each source footprint is clipped to intersecting1 km cells. Exact planar rectangle-union area computes known coverage, so overlapping footprints cannot count twice. Only good-quality explicit fire/no-fire classifications count as known. Cloud, unknown, bad QA, unobserved areas and absence of FIRMS detections never become no-fire labels.

The target means **any quality-observed active-fire footprint within the declared observation window beginning exactly24 hours after issue**. The window can be up to24 hours long and is retained per row. Known target fire produces1; a negative0 requires100% known coverage and no observed fire. Previous-fire0 obeys the same full-coverage rule. If the positive known-coverage threshold is lowered from its default1, negatives still require full coverage. Partial unknown cells without a supported label are excluded, not filled with zero.

Source masks with native resolution or footprint dimensions coarser than1 km are rejected; this pipeline does not fabricate fine labels from coarse fire detections. Weather and other feature resolutions are retained separately and may be coarser than the target. That does not create fine-resolution weather information. Environmental joins use nearest available samples within the declared bound; they do not derive fuel fractions from map imagery or claim sub-grid environmental accuracy.

Overlapping acquisitions within a window implement an any-observed-fire target; they do not reconstruct an instantaneous perimeter. Rectangular normalized footprints approximate raw swath geometry only if the upstream adapter documents that approximation. Arbitrary polygon footprint support remains outside this adapter.

## Temporal integrity and features

Previous mask observations must lie in the declared look-back window and at/before issue. Operational rows exclude packets received after issue. Future target masks provide labels only; they never enter features. Environmental observations/static snapshots may not be valid in the future. Forecast samples may be valid in the future, but their forecast issue time and receipt time must be available at prediction issue. Feature valid times are compared against the explicit `featureValidAt`; select the issue instant or a supported future forecast instant deliberately. Source retrieval and original operational receipt are distinct provenance fields.

The named regional subset contains temperature in Celsius, relative humidity in percent, east/north wind in m/s, precipitation in mm, elevation, slope and grass/woodland/scrub/water fractions. It adds observed previous-fire state, cyclic latitude/longitude and cyclic UTC day-of-year. The same cutoff-filtered previous mask supplies eight-neighbour observed-fire/known fractions, full-context known coverage, presence of known activity, nearest known-fire cell-centre distance and east/north bearing components. Explicit presence and bearing-defined indicators distinguish zero sentinels, fire in the same cell, and unknown context. No activity outside the supplied grid is inferred. Features are never substituted from synthetic sensor truth. Specific humidity is not relabelled as relative humidity. Missing feature channels or wrong units exclude the cell; invalid numerical ranges or inconsistent land-cover fractions reject the record.

Nearest known activity is measured between declared1km aggregate cell centres, not represented as a precise satellite perimeter. The presence/coverage indicators distinguish no observed activity in a fully covered input grid from incomplete/unknown coverage. Neighbourhood fractions use only in-bounds neighbours and retain a separate known fraction. Weather histories and archived forecast uncertainty remain future feature extensions requiring actual source inputs and a versioned feature schema. No existing model is silently promoted for this new subset.

## Splits and output lineage

`validateSplits` now requires disjoint complete-event IDs **and disjoint geographic blocks** by default, including across different time blocks. The former geographic/time-pair rule alone could admit the same location in train and test at different dates. A manifest may explicitly disable geographic holdout for a labelled alternate experiment; it must not be described as geographic generalization.

The regional converter derives geographic blocks from1-degree longitude/latitude bins of transformed cell centres. It additionally enforces disjoint UTC issue-month blocks. Output rows retain event identity, projected cell bounds, WGS84 centre, observation windows, coverage fractions, chosen feature valid/receipt/issue times and source/native-resolution lineage. The manifest includes split counts, excluded-cell counts, source metadata/checksums, normalized input and output SHA-256s, units, scale, target and policy.

These checks enforce declared partitions, but do not independently establish that operator-supplied event IDs correctly join every overlapping fire. Adjacent blocks can still share spatial correlation: geographic buffer zones, temporal gaps around month boundaries and event catalogue reconciliation must be prepared upstream and reviewed before scientific validation. No blanket leakage-free accuracy claim is made.

Output is written through a temporary `.partial` file; an incomplete conversion is not committed as a training row file. A pre-existing `.partial` file is not overwritten. All three partitions must contain usable rows before finalization. This stricter default can correctly reject a previously accepted benchmark sidecar that reused geography across splits.

## Verification and remaining prerequisites

Executed focused tests (14/14 passed with Vitest5.1.0) cover previous-neighbour state/distance/bearing and unknown-context sentinels, fire/no-fire aggregation, cloud/unknown/QA/missing exclusion, overlapping footprint coverage, coarse-mask rejection, target horizon, late receipt, future forecast issuance, available future forecast values, streaming output/provenance hashes, geographic reuse and temporal holdouts. Synthetic fixtures verify software behaviour only.

Still required for a real regional experiment: VIIRS fire-mask granules plus matching geolocation and QA/coverage data with collection-specific decoding; a raw HDF/netCDF/swath adapter and documented footprint projection; source licences/checksums; a reconciled complete-event catalogue with spatial buffers and temporal gaps; historical weather or archived forecast runs with original availability timestamps; genuine terrain/land-cover extraction supplying the declared regional features; and matching-scale physical baseline probabilities. NASA/FIRMS hotspot points alone cannot supply the missing negative-label coverage. No real regional training or evaluation has been executed by this task.
