# Deployment

## Internal HTTPS

Run Node v22.16 or newer under a dedicated operating-system account with access to the data directory. Set `TRACEX_HOST=127.0.0.1`, `TRACEX_PORT=4318`, an absolute `TRACEX_DB`, and `TRACEX_SECURE_COOKIES=1`. Terminate TLS using a certificate trusted by the computers and Android devices. Reverse proxy the same origin, preserve the public `Host` header for origin checks, and configure a request body limit of approximately 11 MB for uploads. Avoid logging request bodies or evidence URLs with sensitive query parameters.

Provision accounts with `npm run user -- <username> <role> <unit>`, using passwords entered through the CLI prompt. Launch with `npm start`. The website and Android must use the same origin. Android release builds require HTTPS.

## Docker Compose

```sh
docker compose build
docker compose run --rm tracex node server/user.mjs demo-investigator investigator Jaipur
docker compose run --rm tracex node server/user.mjs demo-reviewer reviewer Jaipur
docker compose run --rm tracex node server/demo.mjs Jaipur
docker compose up -d
```

By default the Compose service publishes on host loopback, port 4318. Use a trusted HTTPS reverse proxy for shared deployment. The `cases` volume contains both the SQLite database and immutable originals. The Docker context uses checked-in built assets. The Android release can be distributed separately from the server.

## Backup and restore

From the configured project (or inside the container with a mounted backup target), run `npm run backup -- <new-directory>`. This takes an online SQLite snapshot, copies the content-addressed originals, and runs SQLite integrity checks. Restrict access to the backup directory as you would the case vault.

To restore, stop the server, retain the existing dataset, and point `TRACEX_DB` and `TRACEX_VAULT` at the recovered paths. Restart, sign in, and verify an original from a known case. Keep the database and its vault together. Test restores in a separate data directory before any production cutover.
