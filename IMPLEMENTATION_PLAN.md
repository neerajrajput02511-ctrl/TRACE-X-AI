# Implementation plan

1. Preserve baseline commit `7eb328e` and existing offline workflow. Keep Node/SQLite and the native WebView to preserve tested logic and avoid a framework migration on the demo path.
2. Extend authorization and persistence first. Introduce versioned schema, assigned-case access, lifecycle, server indexes, original verification and auditable source access.
3. Build confirmed ingestion and metadata UI against those contracts. Keep the normalizer and citation resolution shared between device and server.
4. Complete the investigation loop with richer approved queries, signed server PDF, downloadable samples and a safe synthetic seed/reset.
5. Connect the Android wrapper to the same server via a configured origin, with read-only offline demo and tested session recovery.
6. Run automated and browser lifecycle tests, large synthetic benchmark and Android build/smoke. Record commands and limitations. Document Windows startup, phone connection and secure deployment.
