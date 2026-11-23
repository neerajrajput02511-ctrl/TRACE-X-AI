# TRACE-X

Team SHYNE's telecom investigation workspace for Rajasthan Police Hackathon PS03. The website opens a synthetic Jaipur case. The Android field app bundles the same console and works offline from its first launch. The installable web app works offline after its first successful online load.

## Try the case

1. Open the workspace and select **Case assistant**. Ask **Which contacts do A and B share?**
2. Open citation **R102**, then its original source row in the first operator file. **R109** is the corresponding B-to-X observation from the second operator.
3. Ask **Did A call B directly?** The supplied case cannot establish that conclusion.
4. Save a cited answer as a finding. Under **Reports & audit**, review the evidence, sign the current version, and choose **Print / Save PDF**. A subsequent change to the findings or evidence requires fresh sign-off.
5. To try importing, download the sample ZIP from the website, extract it, create another case and import the four CSV/TSV files. The upload result lists accepted, duplicate and rejected rows. Ambiguous IP sessions retain their data-quality flags.

## Local website

Requires Node.js 22.16 or newer with the built-in SQLite module. The application has no npm runtime dependencies.

```sh
npm run preview
```

Open http://127.0.0.1:4317/. Device-mode cases are stored in the browser's IndexedDB. Each browser profile and Android installation has its own case store. Clearing app or browser data removes its cases. Web app installation requires HTTPS or loopback and a supporting browser.

## Shared team server

Run these commands in the project root to provision two distinct accounts in the same unit. The CLI prompts for each password.

```sh
npm run user -- analyst investigator Jaipur
npm run user -- reviewer reviewer Jaipur
npm start
```

Open http://127.0.0.1:4318/console.html. Use the analyst account to create a case, import records and save findings. The reviewer can sign the report from a separate session. The server stores unit-scoped case revisions in `.runtime/team.sqlite`, validates the uploaded sources and returned findings, enforces independent review and retains a record of prior approvals. Concurrent stale updates return a conflict.

The server defaults to loopback. Set `TRACEX_DB` for a different database path and `TRACEX_PORT` for a different port. For internal network deployment use a TLS reverse proxy, `TRACEX_SECURE_COOKIES=1`, and an appropriate `TRACEX_HOST`. Back up the SQLite database using SQLite's backup mechanism. Hosted device mode and the packaged Android app do not automatically connect to this team database.

Both device and team modes answer supported queries locally with citations. The on-device intent classifier can suggest an approved question for a paraphrase. The user confirms that suggestion before the query runs. Team mode optionally accepts `TRACEX_OLLAMA_MODEL` for a locally installed Ollama model served on loopback port 11434. Only allowlisted question vocabulary with party placeholders can reach the model through the standard UI. The query engine calculates the answer and its record IDs.

## Android and verification

Install `dist/downloads/trace-x.apk` on Android 8.0 or later. Use the system file picker to import evidence. Signed reports use the Android print dialog. The APK contains the example case and requests no network permission.

```sh
npm test
npm run build:offline
```

To make another Android release on Windows, use JDK 17, Android SDK platform 36 and build-tools 36.0.0, then run `android/build-demo.ps1 -GradlePath <path-to-gradle.bat>`. The signing key and its protected credential live under the current user's local application data, outside the source tree. Back up the signing materials before distributing updates. Build the offline shell again whenever files in `dist` change.

Use synthetic data for hackathon demonstrations. TRACE-X records analytical leads. Assessment of the original data and the interpretation of a finding remain with the investigator and reviewer.

