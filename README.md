# Crossroads Private Line

Private lines with logins. Messages and call logs are deleted automatically after 24 hours.
Backend: Supabase project `crossroads-private-line` (already set up; `setup.sql` is kept here for reference).


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
