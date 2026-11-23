# TRACE-X AI

Team SHYNE built TRACE-X AI for the Rajasthan Police Cyber Security Hackathon 2026, PS03. The workspace imports synthetic CDR/IPDR data, computes relationships and tower observations, answers approved questions with original-row citations, and exports an independently reviewed report.

## Start on Windows

From this directory, run:

    npm.cmd ci
    npm.cmd run user -- demo-investigator investigator Jaipur
    npm.cmd run user -- demo-reviewer reviewer Jaipur
    npm.cmd run user -- demo-admin admin Jaipur
    npm.cmd run demo -- Jaipur
    .START_TRACEX.bat

Open http://127.0.0.1:4318/. Accounts are provisioned with unique passwords at the interactive prompts. To connect the debug Android app over private Wi-Fi, launch with .START_TRACEX.bat -Lan. Use the address printed for the laptop.

## Verify and maintain

    npm.cmd run check
    npm.cmd run build
    npm.cmd test
    npm.cmd run e2e
    npm.cmd run e2e:ui
    npm.cmd run benchmark -- 50000

The synthetic fixture can be reset with npm.cmd run demo -- Jaipur --reset. A marked synthetic case is the only case eligible for reset. See the [validation report](VALIDATION_REPORT.md) for executed checks.

- [Windows setup](docs/SETUP_WINDOWS.md)
- [Android build](docs/ANDROID_BUILD.md) and [phone connection](docs/ANDROID_PHONE_CONNECT.md)
- [Deployment, backups and restore](docs/DEPLOYMENT.md)
- [Demo walkthrough](docs/DEMO_SCRIPT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Initial audit](CURRENT_STATUS.md) and [implementation plan](IMPLEMENTATION_PLAN.md)

The static site uses device-local storage. Shared mode uses the HTTPS or local team server, a SQLite case database and a separate originals vault. The connected Android app uses that same server and includes a read-only synthetic offline demo.
