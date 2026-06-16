# 🏖️ BeachTracker

A live, on-device computer-vision spotter for the shoreline — built for a beach
house week on **Vashon Island**. Point your iPhone at the water and it detects
and **counts** seagulls, ships and planes in real time, then (when you have
internet) tells you the **actual name of the ship** and the **flight number of
the plane** you're looking at by fusing the camera with live AIS and ADS-B data.

It's a **Progressive Web App** — no App Store, no Xcode, no developer account.
Open it in Safari, tap *Add to Home Screen*, and it runs like a native app.

---

## What it does

| Feature | How |
| --- | --- |
| 🐦 / 🚢 / ✈️ **Detection** | TensorFlow.js **COCO-SSD** runs on the phone GPU (WebGL). Works fully offline. Detects seagulls (`bird`), ships (`boat`), planes (`airplane`), plus beach regulars: kites 🪁, surfboards 🏄, beach umbrellas ⛱️, people & dogs. |
| 🎣 **Vessel types** | A generic `boat` is promoted to its real type — **fishing boat, sailboat, ferry, cargo ship, tanker, tug, military** — using the AIS ship-type code, with its own emoji, colour and counter. |
| 🔢 **Counting** | A **SORT-style IoU tracker** gives every object a stable ID across frames, so you get honest *unique* counts (live on-screen **and** cumulative) instead of double-counting the same gull every frame. |
| 🛰 **Ship identity** | Live **AIS** via [aisstream.io](https://aisstream.io) — name, type, destination, speed. |
| 🛰 **Plane identity** | Live **ADS-B** via the free, key-less [adsb.lol](https://api.adsb.lol) — flight, aircraft type, altitude. |
| 🧭 **"What am I pointing at?"** | Uses GPS + the phone **compass** to compute the bearing of each detected ship/plane and match it to the live transponder target in that direction — painting the real identity right onto the box. |
| 🦭 **Seals & otters** | Not in COCO's 80 classes (and no free in-browser model exists), so there are one-tap **🦭 / 🦦 log buttons**. A custom-model slot lets you drop in your own TF.js detector later. |
| 📋 **Sighting log** | Every confirmed detection + manual tag is logged with time and GPS, exportable to **CSV**. |
| 📴 **Offline-first PWA** | Service-worker caches the app and model, so after the first load it works with no signal. |

---

## Use it on your iPhone (fastest path)

1. **Enable GitHub Pages** for this repo: *Settings → Pages → Build and deployment → Source: **GitHub Actions***.
2. Push to the branch — the included workflow builds and deploys automatically.
3. On your iPhone, open **`https://nroze22.github.io/Beachtracker/`** in Safari.
4. Tap **Share → Add to Home Screen**. Launch it from the icon.
5. Tap **▶ Start**, allow **Camera** (and **Motion & Location** if you want ship/plane ID).

> Camera access requires HTTPS — GitHub Pages provides it for free, which is why
> this route "just works" on iOS.

### Turn on real-world identification

Open **⚙️ Settings**:

- **Ships (AIS):** toggle on, paste a **free API key** from
  [aisstream.io](https://aisstream.io/) (sign up → create key).
- **Planes (ADS-B):** toggle on — no key needed.
- **"Use GPS + compass to match what I'm pointing at":** toggle on for the
  magic overlay. Set **Field of view** to match your camera (~65° is right for
  the standard iPhone rear lens; lower it if matches drift sideways).

---

## Run locally (for development)

```bash
npm install
npm run dev      # then open the printed https/localhost URL
```

To test the camera on your phone over your LAN you need HTTPS. Easiest options:

- Deploy to GitHub Pages (above), **or**
- run `npm run build && npm run preview` and expose it with an HTTPS tunnel
  (e.g. `cloudflared tunnel --url http://localhost:4173`).

Build for a non-Pages host (served from root):

```bash
BASE_PATH=/ npm run build
```

---

## How the pieces fit

```
camera ─▶ detector.js (COCO-SSD) ─▶ tracker.js (IoU/SORT, counting)
                                          │
        geo.js (GPS + compass) ───────────┤
        ais.js  (AISStream WS)  ──┐        ▼
        adsb.js (adsb.lol REST) ──┴▶ fusion.js ─▶ overlay.js + ui.js
```

- `src/detector.js` — loads COCO-SSD, filters to the classes we care about.
- `src/tracker.js` — the multi-object tracker + unique counting logic.
- `src/ais.js` / `src/adsb.js` — live vessel / aircraft tables.
- `src/geo.js` — GPS fix + true-north compass heading (with iOS permission flow).
- `src/fusion.js` — bearing math that ties a box on screen to a real-world target.
- `src/overlay.js` — canvas boxes, labels and identity lines.
- `src/ui.js` / `src/store.js` — counters, sighting log, settings (localStorage).

---

## Honest limitations

- **Seals/otters** rely on manual tagging — COCO can't see them and there's no
  off-the-shelf in-browser model. The `customModelUrl` setting accepts a
  COCO-SSD-format TF.js model if you train one.
- **Ship/plane matching** needs GPS + a calibrated compass and a clear line of
  bearing; far-off or clustered targets can mismatch. Tune the FOV slider.
- COCO-SSD labels a `boat` — sailboats, ferries, kayaks and freighters all read
  as "boat" until AIS names them.
- First load needs internet to fetch the model (~few MB); it's cached after that.

---

## Privacy

Everything runs in your browser. Your AIS key and settings live in
`localStorage`. The only outbound calls are to aisstream.io (ships) and
adsb.lol (planes), and only when you enable those toggles.

Made for spotting the Salish Sea. 🌊
