# TRACE-X AI validation

Verified in the Windows workspace `D:\TRACEX AI\trace-x` using Node 24.13.1, npm 11.8.0, Edge/Chromium and an Android API 36 emulator. Case and account tests used isolated SQLite stores and synthetic evidence.

| Command or check | Observed result |
| --- | --- |
| Baseline `npm.cmd test` on `7eb328e` | 13 passed, 0 failed. |
| `npm.cmd run check` | Syntax checks across 41 JavaScript modules passed. |
| `npm.cmd run build` | Vendored Cytoscape and Leaflet were built into the static distribution. Offline app shell generated for 43 files. |
| `npm.cmd test` | 23 tests passed, 0 failed. Covered hashes, multiline provenance, role and case isolation, legacy migration, upload replay, real XLSX row numbers, missing ports, bounds, seed safety and server-generated PDF. |
| `npm.cmd run e2e` | Passed real Edge lifecycle with separate investigator and reviewer contexts: 4 multipart uploads, mapping preview, evidence integrity, interactive Cytoscape/Leaflet, original row, denied access, assignment, independent sign-off, downloaded PDF and audit event. |
| `npm.cmd run e2e:ui` | Passed real Edge checks for admin and access management, original downloads, indexed filters, date-scoped common paths, read-only mobile mode, narrow layout, offline API error and retry. |
| Static PWA smoke in Edge | At 390 px, disabled network after service worker activation. Reloaded the workspace and opened Cytoscape and Leaflet from the cache. |
| Local Ollama adapter with `TRACEX_OLLAMA_MODEL=qwen2.5:7b` | Returned `{"intent":"tower"}` for a masked sample question. Core queries have an independent deterministic path. |
| `npm.cmd audit --omit=dev` | 0 vulnerabilities reported by the npm registry at test time. |
| `START_TRACEX.bat -Port 4481` with a temporary DB | Launcher printed correct addresses. `GET /healthz` returned `{"status":"ok"}`. |
| `npm.cmd run demo -- "Windows smoke"` and `npm.cmd run backup -- <temporary-directory>` | Seed created the marked case. SQLite integrity check and hashes of the backed-up originals passed. |
| `docker compose config --quiet` | Configuration parsed. Runtime container test unavailable because Docker Desktop's Linux engine was stopped. |

## Synthetic benchmark

`npm.cmd run benchmark -- 50000` ran on Windows with an Intel Core 5 210H (12 logical CPUs). The input was 3,171,690 bytes. It imported 50,000 rows with 0 rejected, yielding 181 parties and 6,550 relationship edges. Import took **381.72 ms**, relationship and timeline analytics **1,043.44 ms**, and the cited top-contact query **20.27 ms**. The process reported **137 MB** of heap in use at completion. These are in-process measurements, without SQLite indexing, transport or browser rendering.

## Android

API 36 emulator connected to the local team service through `10.0.2.2` and authenticated against the same server as the browser. It opened `R102` and `R109`, inspected duplicate-source provenance, saved a finding, created a separate synthetic case and uploaded a CSV through Android's Documents picker. The server returned two accepted records and a SHA-256 fingerprint. A separate reviewer signed through the backend. The APK downloaded the PDF through the native Documents Save As dialog and produced a 21,910-byte file beginning with `%PDF-1.3`. This is emulator verification.

Gradle 8.14.3 completed `:app:assembleDebug` and `:app:assembleRelease`. The release build script used the installed platform 36 AAPT2 and Android build-tools verified APK signature scheme v2. In disconnected testing, the bundled case answered a question, opened `R102` and withheld write actions. The unreachable-server screen exposed connection settings and retry controls.

The signed release at `dist/downloads/trace-x.apk` has 932,953 bytes and SHA-256 `FD151952904F1D24BAFD3E82FDB30CB035396E482F07666C856DE58B944F4907`.

## Failures found during QA

- The initial Windows Gradle wrapper attempt tried to download an uncached AAPT2 package. The successful build used the installed SDK's AAPT2 path as documented.
- Initial Edge tests hit a duplicate selector and a reviewer route that only changed the URL fragment. The test now selects the file control and reloads after access changes. The corrected lifecycle passed.
- Reading the Android Downloads file before the Save As stream finished returned zero bytes. The completed file had a valid PDF header and the expected length.

## Hosted demo

Sites confirmed owner-private deployment of `c322c6f` as succeeded on 23 November 2026. The hosted build contains the browser-local synthetic experience and the signed APK. Shared team sessions run at the configured team server. The local server returned HTTP 200 from `/healthz`, and the preview server returned the signed APK with its 932,953-byte length.

## Coverage limits

The implementation extends the existing JavaScript/Node/SQLite architecture. Next.js, TypeScript checks, Tailwind, FastAPI/Pydantic and DuckDB are outside this implementation. The map runs on a local coordinate grid. XLSX supports one sheet per upload. The server verifies deterministic assistant answers and citation IDs. The independent reviewer checks the interpretation and investigator-authored report wording. Performance timing covers the engine only. Physical phones, a production police network, trusted HTTPS on an Android device, concurrent-load certification, and real operator evidence were outside the exercised environment.

## Workspace launch recovery

In Edge, the **Launch workspace** link reproduced the startup error when IndexedDB access was denied and when a full storage quota prevented saving the sample. After the fix, `npm.cmd run e2e:launch` passed with normal storage, a previously saved case, denied access, quota exhaustion, a temporary cited answer, restored access to the original case, the explicit read-only demo, a stale cached page, and an offline reload. The temporary session does not write case records.
