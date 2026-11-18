/**
 * Joylashuv yordamchilari (mobil tashrif va sotuv uchun).
 */

/* Sotuv mijoz nuqtasidan shuncha metrdan uzoqda qilinsa — "uzoqdan sotuv"
   deb belgilanadi (bloklanmaydi: GPS shahar ichida 50–150 m adashadi). */
const SOTUV_RADIUS_M = parseInt(process.env.SOTUV_RADIUS_M, 10) || 300;

/** Ikki koordinata orasidagi masofa (metrlarda) — Haversine formulasi */
function masofaMetr(lat1, lng1, lat2, lng2) {
  if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) return null;
  const [a1, o1, a2, o2] = [lat1, lng1, lat2, lng2].map(Number);
  if ([a1, o1, a2, o2].some(v => !Number.isFinite(v))) return null;
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(a2 - a1);
  const dLng = toRad(o2 - o1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a1)) * Math.cos(toRad(a2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

/** Mobil so'rovdan koordinata o'qiydi: { lat, long } yoki { lat, lng } / { latitude, longitude } */
function koordinata(body = {}) {
  const lat = body.lat ?? body.latitude;
  const lng = body.long ?? body.lng ?? body.lon ?? body.longitude;
  const a = parseFloat(lat), o = parseFloat(lng);
  if (!Number.isFinite(a) || !Number.isFinite(o) || (a === 0 && o === 0)) return null;
  if (Math.abs(a) > 90 || Math.abs(o) > 180) return null;
  return { lat: a, lng: o };
}

module.exports = { SOTUV_RADIUS_M, masofaMetr, koordinata };
