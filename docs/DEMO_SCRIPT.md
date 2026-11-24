# Five-minute PS03 demo

Select **Run Jaipur demo** to open the synthetic `CASE-RJ-001` and follow its guided steps. For a fresh import, download and extract the sample ZIP from the landing page and upload the individual files to a new case. [Open the public judge demo](https://trace-x-ai-shyne.vercel.app/)

1. **Import.** Upload both operator exports, the IPDR CSV and tower list as one selection. Show the field-mapping preview. Confirm and read the import QA.
2. **Analyze.** Open Link analysis and select shared contact X. Inspect the directed A-to-X and B-to-X edges. In Tower timeline, choose A and show the cited observations. Coordinates show the tower site.
3. **Verify.** Ask “Which contacts do A and B share?” Open `R102` and `R109` in the seeded fixture. They show A–X and B–X. The baseline record IDs in a new case may differ if files were imported in a different order. Ask “Did A call B directly?” and show the evidence limit.
4. **Show uncertainty.** Ask “What IPDR matches have missing port information?” The seeded fixture cites `R116`. Ask “Show night calls” on the expanded seeded fixture to see three dated records. The seed includes a duplicated source observation and one rejected CSV row.
5. **Review.** Save a cited assistant answer. In the browser demo, enter a reviewer name and sign the current local demo revision. In the team workspace, assign the case to a separate reviewer account and have that account sign. Download the PDF and show the export event. Add a finding and demonstrate that the new revision needs review.
6. **Android.** Connect the debug app to the same authorized demo server over the private LAN, or use a release build with trusted HTTPS. Sign in and open the same case and citations. In the offline synthetic workspace, ask the same supported question and inspect the local evidence independently.

## PS03 acceptance checks

| Official scope | Demonstration |
| --- | --- |
| Two CDR formats and one IPDR input | Import the north operator CSV and the west operator TSV with the IP-session CSV. Inspect the per-file QA and the original rows. |
| Contact graph and common-number analysis | Compare A and B. Open the A–X–B path and inspect its cited calls. |
| Tower-location timeline | Import the synthetic tower register. Filter the mapped observations by subject and date. |
| Evidence-linked assistant | Ask a supported question, open `R102` or `R109`, and ask for a direct A–B call to see the evidence limit. |
| Bonus features | Device/SIM changes, night-activity analytics, supported Hindi queries, and a downloadable, version-bound PDF. |

The live page loads the project’s synthetic fixtures. Its review sign-off is local to the demo. Use the shared team server for account-based reviewer independence. [Official PS03 brief](https://rajasthanpolicehackathon.in/#ps03)
