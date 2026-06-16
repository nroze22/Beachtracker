// GPS position + device compass heading.
//
// On iOS both require an explicit, user-gesture-triggered permission. We expose
// the latest fix as a shared object that the fusion layer reads each frame.

export const geo = {
  lat: null,
  lon: null,
  accuracy: null,
  heading: null, // degrees clockwise from true north, 0..360
  hasHeading: false,
  hasFix: false
};

let watchId = null;

export async function startGeo() {
  // --- Position ---
  if ('geolocation' in navigator && watchId == null) {
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        geo.lat = pos.coords.latitude;
        geo.lon = pos.coords.longitude;
        geo.accuracy = pos.coords.accuracy;
        geo.hasFix = true;
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
  }

  // --- Compass heading ---
  const handler = (e) => {
    // iOS Safari exposes a true-north heading via webkitCompassHeading.
    let h = null;
    if (typeof e.webkitCompassHeading === 'number') {
      h = e.webkitCompassHeading;
    } else if (typeof e.alpha === 'number') {
      // Generic deviceorientation: alpha is counter-clockwise from north-ish.
      h = (360 - e.alpha) % 360;
    }
    if (h != null && !Number.isNaN(h)) {
      geo.heading = h;
      geo.hasHeading = true;
    }
  };

  try {
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === 'function') {
      const res = await DOE.requestPermission();
      if (res === 'granted') {
        window.addEventListener('deviceorientation', handler, true);
      }
    } else if (DOE) {
      window.addEventListener('deviceorientationabsolute', handler, true);
      window.addEventListener('deviceorientation', handler, true);
    }
  } catch {
    /* heading unavailable — fusion will just skip bearing checks */
  }
}

// Great-circle bearing from (lat1,lon1) to (lat2,lon2), degrees from true north.
export function bearingTo(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

// Haversine distance in km.
export function distanceKm(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dφ = toRad(lat2 - lat1);
  const dλ = toRad(lon2 - lon1);
  const a =
    Math.sin(dφ / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dλ / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Smallest signed difference between two bearings, in degrees (-180..180).
export function angleDiff(a, b) {
  let d = ((a - b + 540) % 360) - 180;
  return d;
}
