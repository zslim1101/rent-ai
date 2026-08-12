# rent-ai

A website showing rental information for buildings in Ara Damansara and Kelana Jaya.

Each building gets its own page with the rent people are asking, the monthly maintenance
fee, how long it really takes to walk to the LRT, and what residents say about living
there. One page per development.

---

## Before you start

You need **Node.js** installed on your computer. It's free, and it's what runs this
project. Download it from [nodejs.org](https://nodejs.org) and pick the version marked
"LTS".

To check it worked, open your Terminal and type:

```bash
node --version
```

If it prints a number, you're ready.

---

## Seeing the website on your own computer

Open your Terminal, go into this folder, and run these two lines:

```bash
npm install
npm run dev
```

The first line downloads the pieces the project needs. It takes a minute, and you only
do it once.

The second line starts the website. It will print a web address, usually
`http://localhost:4321`. Open that in your browser and the site is there.

To stop it, press `Ctrl+C` in the Terminal.

**You do not need a Firebase account for this.** The site reads its information from a
file in this folder, so it works straight away. The yellow bar at the top says the
numbers are fake — because right now they are. They're placeholders so you can see what
the site looks like.

---

## Where the information lives

Everything the site shows comes from one file:

```
data/buildings.json
```

Open it in any text editor. It's a list of buildings, and each one has its rent figures,
its maintenance fee, its facilities, and its available units. Change a number in there,
save, and the website updates while you're looking at it.

When you've put in real information, delete the line `"sample": true` from each building.
That's what makes the yellow warning bar disappear.

---

## Putting it on the internet

This part uses **Firebase**, a free service from Google. It does two jobs for us:

- **Firestore** is a place to keep the building information online, instead of in a file
  on your laptop.
- **Hosting** is what puts the website on the internet so other people can visit it.

You can skip this entirely while you're still experimenting. The site works fine from the
file.

### Step 1 — Make a Firebase project

Go to [console.firebase.google.com](https://console.firebase.google.com) and click
**Add project**. Give it a name. When it offers you Google Analytics, say no — you don't
need it.

### Step 2 — Make the database

In the menu on the left, click **Build → Firestore Database → Create database**.

It asks two questions:

- **Mode**: choose **Production mode**. This keeps your information locked down by
  default.
- **Location**: choose **`asia-southeast1`**. That's Singapore, the closest one to
  Malaysia, so the site will load faster here.

### Step 3 — Get your project's details

Go to **Project settings** (the gear icon, top left) → **General**. Scroll down to
**Your apps** and click the **`</>`** button to add a web app.

Firebase shows you a block of settings — a long key, a project name, and a few other
values. You need to copy these into a settings file.

In your Terminal, run:

```bash
cp .env.example .env
```

That makes a file called `.env`. Open it and paste each value from Firebase next to the
matching line.

Don't worry about these values being secret. They're designed to be visible to anyone who
visits the website. What actually protects your information is a separate rules file,
which is already set up.

### Step 4 — Get the key that lets you write

The values above only let the site *read* your information. To *put information in*, you
need a second, private key.

Go to **Project settings → Service accounts → Generate new private key**. A file
downloads. Rename it to `serviceAccount.json` and put it in this folder.

**This one is genuinely secret.** It gives complete control of your Firebase project to
anyone holding it. The project is already set up to never upload it anywhere — just don't
email it or paste it into a chat.

### Step 5 — Connect your computer to Firebase

```bash
npm install -g firebase-tools
firebase login
firebase use --add
```

The first line installs Google's Firebase tool. The second opens your browser so you can
sign in. The third asks which of your Firebase projects this folder belongs to — pick the
one you just made.

### Step 6 — Send your information to the database

```bash
npm run seed
```

This copies everything from `data/buildings.json` into Firestore. Run it again any time
you change that file and want the online copy updated.

Then send up the protection rules, which say the public can read your building
information but nobody can change it:

```bash
firebase deploy --only firestore:rules
```

### Step 7 — Tell the site to use the database

Open `.env` and change this line:

```
PUBLIC_DATA_SOURCE=firestore
```

Now the site reads from Firestore instead of the file.

### Step 8 — Publish it

```bash
npm run deploy
```

This turns the project into ordinary web pages and uploads them. When it finishes it
prints your website address. That's it — it's live.

---

## Changing what's on the site later

The site is built as a set of finished pages, which is why it loads fast and costs
nothing to run. The trade-off is that editing information in Firebase doesn't change the
live site by itself — you have to rebuild it.

So after any change:

```bash
npm run deploy
```

That takes a few seconds and pushes the new version.

---

## Two rules the site follows

**We summarise listings, we don't copy them.** Each listing shows bedrooms, bathrooms,
size, price, and whether it's furnished — then links to the original advert. No photos,
no descriptions, no agent names. Those belong to whoever published them.

**We admit when we don't know enough.** If a building only has a few listings, the
average rent is marked "low" so nobody mistakes a guess for a fact. Same with reviews —
under five, we don't show a score at all.

---

## What's in this folder

| File or folder | What it's for |
|---|---|
| `data/buildings.json` | All the building information. This is the one you'll edit. |
| `src/pages/` | The two page designs: the list, and the individual building page. |
| `src/lib/` | The code that loads and formats the information. |
| `scripts/seed-firestore.mjs` | Copies your file into the online database. |
| `firestore.rules` | Says who can read and change the online information. |
| `firebase.json` | Settings for putting the site online. |
| `.env` | Your own Firebase details. Not shared. |

---

## Commands, all in one place

| Command | What it does |
|---|---|
| `npm install` | Downloads what the project needs. Run once. |
| `npm run dev` | Shows the site on your computer while you work. |
| `npm run seed` | Copies your file into the online database. |
| `npm run deploy` | Publishes the site to the internet. |
