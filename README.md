# Crossroads Private Line

Private lines with logins. Messages and call logs are deleted automatically after 24 hours.
Backend: Supabase project `crossroads-private-line` (already set up; `setup.sql` is kept here for reference).

Names: each person can change how they appear with the **Name** button after signing in. Run `setup-names.sql` once so a user can only change their own display name.


## 1. Create the backend (free)
1. Go to **supabase.com**, sign up, and click **New project**. Pick any name and password, choose the US East region, and wait about 2 minutes.
2. Open **SQL Editor**, then **New query**. Paste all of `setup.sql` and click **Run**. It should say "Success".
3. Go to **Authentication > Sign In / Providers**:
   - Turn **OFF** "Allow new users to sign up". Only you create lines.
   - Under **Email**, turn **OFF** "Confirm email".

## 2. Connect the site
1. In Supabase, open **Project Settings > API** and copy the **Project URL** and the **anon public** key.
2. In `index.html`, paste them into the SETTINGS block near the top of the script:
   ```js
   const SUPABASE_URL      = 'https://abcd1234.supabase.co';
   const SUPABASE_ANON_KEY = 'eyJhbGciOi...';
   ```
   The anon key is meant to be public. The security rules in setup.sql protect the data.
3. Replace `messaging/index.html` on your site with this one. Keep `peerjs.min.js` in the same folder. Then deploy the same way you normally do, either by pushing to GitHub or dragging the folder into Netlify or Vercel.

## 3. Create a line for each person
In Supabase, go to **Authentication > Users > Add user > Create new user**:
- **Email:** `username@crossroadsweddingco.shop`. For example, `maria@crossroadsweddingco.shop` logs in as **maria**. The address doesn't need to be a real email.
- **Password:** whatever you choose.
- Check **Auto Confirm User**.

The line shows up in everyone's list right away. To remove a line, delete that user, and everything tied to it is deleted with it.
To rename how someone appears, go to **Table Editor > profiles** and edit `display_name`.

## How it behaves
- **Logins:** each person signs in with a username and password and stays signed in on that device.
- **History:** each person sees their own chats and call log (answered, missed, declined, and how long each call lasted) with every other line, and nobody else's.
- **24-hour wipe:** anything older than 24 hours disappears from the app immediately. The database deletes it for good every 5 minutes. Each message shows how much time it has left.
- **Self-destruct:** wipes the whole conversation and call log with that person, for both of you, right away.
- **Calls:** voice and video calls go directly between the two devices and are never recorded. The other person needs the page open to ring. If they don't, the call is logged as missed and shows up in their history.

## Good to know
- Messages are encrypted while being sent and while stored on Supabase. Because they sit on the server for up to 24 hours, you, as the project owner, could see them in the dashboard during that time.
- Supabase's free plan doesn't keep backups, so deleted messages are gone for good. Paid plans do keep daily backups, and those could hold deleted messages for a while.
- Free Supabase projects pause after a week with no activity. Open the site or the dashboard to wake one up.

## Ringing, alerts and the app
- **Ringing:** calls ring through the database's live feed, so the other person's screen rings with a ringtone (and vibrates on Android) whenever the app is open. The caller hears a ringback tone.
- **Alerts:** incoming calls, missed calls and new messages send a push notification, even when the app is closed. Message alerts never include the text.
- **Install the app:**
  - **iPhone (iOS 16.4+):** open the page in Safari, tap **Share**, then **Add to Home Screen**. Open **Private Line** from the Home Screen, sign in, and tap **Turn on**. iPhone only delivers alerts to the Home Screen app.
  - **Android / desktop Chrome:** tap **Install** in the app, or use the browser's install icon, then **Turn on** alerts.
- **Backend pieces:** `setup-push.sql` adds the device list and the alert trigger. `supabase/functions/push` is the function that sends alerts. Its signing key is generated automatically and stored in the database, so there are no secrets to manage.

## Making incoming calls ring
A website can't play a real ringtone while the phone is locked; only installed native apps can. So an incoming call "rings" by repeating the alert every 5 seconds for up to about 45 seconds. Each repeat plays the phone's notification sound and vibrates again. It stops as soon as the call is answered, declined or missed, or when you open or swipe away the alert.
- **Android / desktop:** the service worker (`messaging/sw.js`) repeats the alert. This goes live with a normal deploy.
- **iPhone:** iOS stops service workers right away, so the `push` function repeats the alert from the server. **After changing `supabase/functions/push/index.ts`, redeploy it:** `supabase functions deploy push --project-ref xppyedslhbrnqnymaaxb`, or paste the file into Supabase > Edge Functions > push > Code and click Deploy.

## Ringing your real phone (Twilio)
A website can't ring the phone's own call screen, so this rings it the old-fashioned way. If an in-app call is still ringing after 8 seconds, Twilio dials the person's real phone number. It rings in their normal Phone app, even locked or asleep, and a voice says "Jake is calling you on Private Line. Open Private Line to answer the voice call." Opening the app shows the incoming call. The phone call hangs up by itself the moment the in-app call is answered, declined or missed. The conversation itself still happens in the app, encrypted; Twilio only carries the wake-up ring.

Turning it on:
1. **Twilio:** create an account at twilio.com and upgrade it (trial accounts can only call numbers you've verified, and play a trial notice first). Buy one phone number with **Voice**. A local Indiana number is fine. Outgoing voice calls don't need A2P/10DLC registration; that's for texting.
2. **Database:** run `setup-phone.sql` in Supabase > SQL Editor.
3. **Secrets:** in Supabase > Edge Functions > Secrets (or `supabase secrets set ... --project-ref xppyedslhbrnqnymaaxb`), add `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` (both on the Twilio console home page) and `TWILIO_FROM_NUMBER` (the number you bought, like `+18125550123`). Optional: `PHONE_WAKE_AFTER_SECONDS` (default 8).
4. **Redeploy the `push` function** (command above).
5. **Each person** opens the menu > **Ring my phone** and enters their number. Only they can see it. "Turn off phone ringing" removes it.

Cost: Twilio bills each wake-up as a short outgoing call, about 1 to 2 cents in the US, plus about $1.15 a month for the number. Calls answered in the app within 8 seconds never dial. Without the secrets, or for someone with no number saved, nothing changes. Add the Twilio number to your contacts as "Private Line" so it shows by name.

Phone settings that silence alerts:
- **iPhone:** the Ring/Silent switch or Action Button must be on Ring, and no Focus or Do Not Disturb can be on. Go to Settings > Notifications > Private Line and turn on **Sounds**.
- **Android:** go to Settings > Apps > Private Line (or Chrome, if it isn't installed) > Notifications, open the alert category, and pick a **ringtone** as its sound. Android 15 and later can turn down repeated alerts: turn off Settings > Notifications > **Notification cooldown**.

## Private Line Courier (courier, purchasing and NDA portal)

`messaging/courier.html` is the courier side of the same backend. The people already on Private Line become **internal drivers**, and `jake` becomes the owner. Senders, receivers and stores get their own logins, which land on the courier portal and never see the internal lines.

Try it first with nothing set up: open `/messaging/courier.html?demo=1`. It runs on sample data in your browser only, and you can switch between customer, dispatch, driver and store.

### Turn it on
1. **SQL Editor:** run `setup-courier.sql` once (it is safe to run again). Run it after the other setup files.
2. **Edge Functions:** deploy `supabase/functions/courier-admin` (it lets the owner create logins from the Admin screen) and redeploy `supabase/functions/push` (it now sends job alerts).
3. **Sign in as jake** at `/messaging/courier.html` and sign the NDA. Every person signs it once, drivers included.
4. **Admin:** add each customer company and each store, then create their logins. A store gets a catalog id so its listing shows "In our network".
5. **Drivers:** each one signs in, signs the NDA, taps **Go on duty**, and turns on alerts.

### Who sees what
| Role | Sees |
| --- | --- |
| Owner, dispatcher | Every job, the fleet map, quotes, store prices, both message threads, Admin (owner only) |
| Driver | Open jobs while on duty and their own jobs. On a blind job: stops and instructions, never the cargo, the customer name, prices or drawings |
| Customer | Their own company's jobs, quotes, files, the customer thread, the custody record, the driver's live position while their job is moving and the driver isn't on another customer's job |
| Store | Their own jobs plus stock requests from other stores, with the part and job number but not who asked |

All of this is enforced in the database: the tables have no direct access, and every read goes through `cc_` functions that shape the answer by role.

### GPS and maps
- Drivers share location only while on duty, and only the latest position is kept. Going off duty erases it.
- Phones stop sharing location when the screen locks, so the driver screen asks the phone to stay awake during a run. Background tracking needs a native app later.
- Maps use OpenStreetMap, with satellite imagery from Esri. To use Google satellite instead, put a Google Map Tiles key in `GOOGLE_TILES_KEY` in `courier.js` (Google needs a billing account for that key).
- Navigation opens the Google Maps app, which needs no key.

### Updating the supplier list
Edit `courier/suppliers.mjs` (hand-checked rows) or `courier/catalog-additions.json` (rows from outside research, all marked "Call to confirm"), then run:
```
node scripts/build-courier.mjs ../Heart-Of-Columbus
```
The path is optional. With it, the Heart of Columbus snapshot is refreshed too.

### Tests
`tests/run.sh` starts a throwaway Postgres, loads every setup file twice, and runs the real SQL through a whole job as every role. It also checks that the demo answers in the same shapes as the database. `node tests/ui.mjs` drives the demo in a browser at desktop and phone width.
