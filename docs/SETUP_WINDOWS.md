# Windows setup

Install Node.js 22.16 or newer. Open PowerShell or Command Prompt in the project folder. This repository uses one local server for both the website and REST API.

```powershell
cd 'D:\TRACEX AI\trace-x'
npm.cmd ci
npm.cmd run user -- demo-investigator investigator Jaipur
npm.cmd run user -- demo-reviewer reviewer Jaipur
npm.cmd run user -- demo-admin admin Jaipur
npm.cmd run demo -- Jaipur
.\START_TRACEX.bat
```

Choose three different passwords when prompted. There are no default passwords. Open http://127.0.0.1:4318/. The launcher checks Node and dependencies and prints the workspace and health addresses. Press Ctrl+C in the launcher to stop the server.

For a synthetic-only same-Wi-Fi test using the Android debug app, start with `.\START_TRACEX.bat -Lan`. Use the laptop's private IPv4 address printed by the launcher. The Windows firewall must allow inbound TCP 4318 on the private network. See [Android phone connection](ANDROID_PHONE_CONNECT.md).

`npm.cmd run demo -- Jaipur --reset` replaces only the marked synthetic fixture. If a real case already occupies that ID in the unit, the command refuses. Leave the reset flag off to preserve changes to the seeded case.

Use `.env.example` to choose the bind address, data location and cookies. For another port, run `.\START_TRACEX.bat -Port 4320`. The website is server-connected when started with this launcher. For the browser-local developer preview, run `npm.cmd run preview`.
