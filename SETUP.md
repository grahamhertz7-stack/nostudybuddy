# NoStudyBuddy — Setup & Deployment Guide

## What Was Updated

| File | Change |
|---|---|
| `netlify/functions/solve.js` | Calls Claude, ChatGPT, Gemini, and Grok in parallel; Claude synthesizes the best answer |
| `public/index.html` | Firebase Auth (Google + email/password), Firestore API key storage, multi-AI results UI |
| `netlify.toml` | Unchanged (already correct) |

---

## Step 1 — Create Your Firebase Project

1. Go to [https://console.firebase.google.com](https://console.firebase.google.com) and click **Add project**.
2. Name it `nostudybuddy` and follow the prompts (disable Google Analytics if you want to keep it simple).
3. Once created, click **Authentication** → **Get started** → **Sign-in method** tab:
   - Enable **Google**
   - Enable **Email/Password**
4. Click **Firestore Database** → **Create database** → choose **Production mode** → pick a region close to your users.
5. In Firestore **Rules**, paste the following and click **Publish**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /userKeys/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

6. Go to **Project settings** (gear icon) → **General** → scroll to **Your apps** → click **</>** (Web) → register the app as `nostudybuddy` → copy the `firebaseConfig` object.

---

## Step 2 — Add Firebase Config to index.html

Open `public/index.html` and find this block near the bottom:

```js
const firebaseConfig = {
  apiKey:            "REPLACE_WITH_YOUR_FIREBASE_API_KEY",
  authDomain:        "REPLACE_WITH_YOUR_AUTH_DOMAIN",
  projectId:         "REPLACE_WITH_YOUR_PROJECT_ID",
  storageBucket:     "REPLACE_WITH_YOUR_STORAGE_BUCKET",
  messagingSenderId: "REPLACE_WITH_YOUR_MESSAGING_SENDER_ID",
  appId:             "REPLACE_WITH_YOUR_APP_ID",
};
```

Replace each `REPLACE_WITH_…` value with the actual values from your Firebase project settings.

---

## Step 3 — Add Environment Variables to Netlify

Go to your Netlify dashboard → **Site settings** → **Environment variables** and add:

| Variable | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Already set — your existing key |
| `OPENAI_API_KEY` | Your OpenAI key (from [platform.openai.com](https://platform.openai.com/api-keys)) |
| `GEMINI_API_KEY` | Your Gemini key (from [aistudio.google.com](https://aistudio.google.com/app/apikey)) |
| `GROK_API_KEY` | Your Grok key (from [console.x.ai](https://console.x.ai/)) |

> **Note:** These are the site's server-side keys used for the free tier and as fallbacks. Users can also save their own keys in their profile.

---

## Step 4 — Add Authorized Domain in Firebase

1. In Firebase console → **Authentication** → **Settings** → **Authorized domains**.
2. Add `nostudybuddy.com` (and `your-site.netlify.app` if you want to test on the Netlify preview URL).

---

## Step 5 — Push to GitHub and Deploy

```bash
git add .
git commit -m "Add multi-AI support, Firebase Auth, and Firestore key storage"
git push origin main
```

Netlify will auto-deploy from your connected GitHub repo. That's it!

---

## How It Works (Summary)

### Free Tier (no login)
- Users get **5 free answers per session** using the server's Anthropic key (Claude only).
- After 5 answers, a paywall prompts them to sign in.

### Logged-In Users
- Users sign in with Google or email/password via Firebase Auth.
- They can save their OpenAI, Gemini, and Grok API keys once in their profile — stored securely in Firestore, tied to their user ID.
- All four AIs answer simultaneously; Claude synthesizes the best combined answer.
- If a user hasn't added a key for a particular AI, that AI is simply skipped.

### API Key Priority
`solve.js` uses keys in this order:
1. User's saved key (passed from frontend)
2. Server environment variable (fallback)

---

## File Structure

```
nostudybuddy/
  netlify.toml
  SETUP.md              ← this file
  public/
    index.html          ← full frontend (Firebase Auth + multi-AI UI)
  netlify/
    functions/
      solve.js          ← multi-AI backend function
```
