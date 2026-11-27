# Legal Leaf Market staff delivery preview

Open [the browser preview](messaging/legal-leaf-delivery-preview.html) locally. It runs offline with a fictional market tote and postcard order in Columbus. Use **Preview role** to switch between Jacob on dispatch, Nic and Anthony as staff drivers, and two access-test roles. The sample resets on reload or with **Reset sample**.

1. From **Orders sheet**, choose a driver and the window agreed with the recipient. **Test a retry** simulates a timeout or a sheet writeback failure after job creation. Retry to recover the same job reference.
2. Switch to the assigned driver, record pickup and complete the handoff. To try a failure, select a reason and record it, then switch to dispatch to reschedule or cancel. Check that the driver who no longer owns a reassigned job loses access.
3. Back in dispatch, record the ID result and the amount collected. A matched ID, completed handoff and exactly $21.40 are required for the sample sale to appear in delivered sales.

## SQL verification

The sample UI simulates the Orders sheet and uses in-memory data. The separate [staging SQL](setup-legal-leaf-preview.sql) exercises Supabase authorization and the order-to-job mapping on a disposable Postgres database. A database-owned roster and intake allowlist restrict the path to explicitly provisioned Legal Leaf staff and sample-format order references. Job details and custody events stay in a private schema outside external courier, public tracking and file APIs. The test uses the existing alert table with generic content and a stubbed network trigger.

From the repository root, with the same PostgreSQL 16 and psql setup used by the existing courier SQL tests:

```sh
bash tests/pg.sh
psql -h 127.0.0.1 -p 54329 -U postgres -d postgres -v ON_ERROR_STOP=1 -f setup-legal-leaf-preview.sql
node --test tests/legal-leaf-preview.test.mjs
```

The live Google sheet, customer checkout, Supabase project, and push endpoint are outside this preview. A hosted staging connection needs a staff sign-in and sheet adapter, plus an isolated push endpoint. Verify the in-house operating policy and applicable product and cash requirements before enabling any real order.

## Future fleet opportunity

The Columbus DoorDash pickup operation is a starting point for exploring a company-managed fleet. Workshop the operating model with LegalEase before expanding. The design goals are to reduce liability, give drivers meaningful control over their work, and give participating local businesses a say in how pickups and deliveries run.
