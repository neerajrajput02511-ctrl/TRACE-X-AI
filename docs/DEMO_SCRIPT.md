# Five-minute PS03 demo

Use the synthetic `CASE-RJ-001`, or download and extract the sample ZIP from the landing page and upload the individual files to a new case. For independent review on a new case, select Case details, Manage access and add your separate reviewer.

1. **Import.** Upload both operator exports, the IPDR CSV and tower list as one selection. Show the field-mapping preview. Confirm and read the import QA.
2. **Analyze.** Open Link analysis and select shared contact X. Inspect the directed A-to-X and B-to-X edges. In Tower timeline, choose A and show the cited observations. Coordinates show the tower site.
3. **Verify.** Ask “Which contacts do A and B share?” Open `R102` and `R109` in the seeded fixture. They show A–X and B–X. The baseline record IDs in a new case may differ if files were imported in a different order. Ask “Did A call B directly?” and show the evidence limit.
4. **Show uncertainty.** Ask “What IPDR matches have missing port information?” The seeded fixture cites `R116`. Ask “Show night calls” on the expanded seeded fixture to see three dated records. The seed includes a duplicated source observation and one rejected CSV row.
5. **Review.** Save a cited assistant answer. Use a separate account to review the source records and sign the report. Download the PDF and show the export activity. Add a finding from the investigator account and demonstrate that review is needed again.
6. **Android.** Connect the debug app to the same authorized demo server over the private LAN, or use a release build with trusted HTTPS. Sign in and open the same case and citations. In the offline synthetic workspace, ask the same supported question and inspect the local evidence independently.
