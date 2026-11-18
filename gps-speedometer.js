/* Speed Lab — GPS speedometer.
 * Uses watchPosition() only. Coordinates stay in this page; nothing is sent
 * to the server. Speed blends receiver-reported Doppler speed with
 * displacement-over-time and smooths the result for a readable needle.
 */
(function () {
  "use strict";

  var KMH_PER_MS = 3.6;
  var MPH_PER_MS = 2.2369362920544;
  var FT_PER_M = 3.280839895;
  var M_PER_MILE = 1609.344;
  var IMAGE_BASE = "../assets/speed/img/";

  // Five real-world speed tiers. The unnumbered art is tier 1; images 01–04
  // follow. Ranking uses top speed in km/h, regardless of the display unit.
  var TIERS = [
    {
      min: 0, file: "tier-0.jpg", icon: "🧍", name: "Standing by",
      range: "Under 5 km/h",
      text: "Barely any motion. GPS drift can look like a slow shuffle when you are standing still."
    },
    {
      min: 5, file: "tier-1.jpg", icon: "🚶", name: "On foot",
      range: "5–24 km/h",
      text: "Walking or a very relaxed roll. GPS speed is usually steadiest once you are above 10 km/h."
    },
    {
      min: 25, file: "tier-2.jpg", icon: "🚲", name: "City pace",
      range: "25–59 km/h",
      text: "A proper city cruise — cycling, side streets and stop-and-go traffic. The needle should track cleanly."
    },
    {
      min: 60, file: "tier-3.jpg", icon: "🏎️", name: "Highway speed",
      range: "60–119 km/h",
      text: "Fast and steady. Keep your eyes on the road; the reading is for fun, not for your licence."
    },
    {
      min: 120, file: "tier-4.jpg", icon: "🚀", name: "Launch mode",
      range: "120 km/h and up",
      text: "Track speed, not the screen. This is a GPS reading, not a permission slip."
    }
  ];

  var gauge = document.querySelector("[data-gauge]");
  var els = {
    start: document.getElementById("start-gps"),
    stop: document.getElementById("stop-gps"),
    reset: document.getElementById("reset-gps"),
    status: document.getElementById("gps-status"),
    live: document.getElementById("live-badge"),
    signal: document.getElementById("signal-pill"),
    error: document.getElementById("gps-error"),
    ms: document.getElementById("m-ms"),
    msUnit: document.getElementById("m-ms-unit"),
    distance: document.getElementById("m-distance"),
    distanceUnit: document.getElementById("m-distance-unit"),
    max: document.getElementById("m-max"),
    maxUnit: document.getElementById("m-max-unit"),
    avg: document.getElementById("m-avg"),
    avgUnit: document.getElementById("m-avg-unit"),
    accuracy: document.getElementById("m-accuracy"),
    accuracyUnit: document.getElementById("m-accuracy-unit"),
    fixes: document.getElementById("m-fixes"),
    heading: document.getElementById("heading-deg"),
    compass: document.getElementById("compass-needle"),
    compassLabel: document.getElementById("compass-label"),
    elapsed: document.getElementById("elapsed"),
    ratingIcon: document.getElementById("rating-icon"),
    ratingTitle: document.getElementById("rating-title"),
    ratingText: document.getElementById("rating-text"),
    viewRank: document.getElementById("view-rank"),
    copy: document.getElementById("copy-trip")
  };

  var state = {
    unit: "metric",
    watching: false,
    watchId: null,
    startTime: null,
    lastFix: null,
    lastFixAt: 0,
    distance: 0,
    maxSpeed: 0,
    smoothSpeed: 0,
    heading: null,
    accuracy: null,
    fixes: 0,
    scaleMaxKmh: 240,
    lastRender: 0,
    staleWarned: false
  };

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function toRadians(degrees) {
    return (degrees * Math.PI) / 180;
  }

  function haversineMeters(lat1, lon1, lat2, lon2) {
    var earth = 6371008.8;
    var dLat = toRadians(lat2 - lat1);
    var dLon = toRadians(lon2 - lon1);
    var a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * earth * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function bearingDegrees(lat1, lon1, lat2, lon2) {
    var dLon = toRadians(lon2 - lon1);
    var y = Math.sin(dLon) * Math.cos(toRadians(lat2));
    var x =
      Math.cos(toRadians(lat1)) * Math.sin(toRadians(lat2)) -
      Math.sin(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.cos(dLon);
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  }

  function formatSpeed(ms) {
    var value = state.unit === "metric" ? ms * KMH_PER_MS : ms * MPH_PER_MS;
    if (!isFinite(value)) return "—";
    return value >= 100 ? String(Math.round(value)) : value.toFixed(1);
  }

  function formatSpeedWhole(ms) {
    var value = state.unit === "metric" ? ms * KMH_PER_MS : ms * MPH_PER_MS;
    if (!isFinite(value)) return "—";
    return String(Math.round(value));
  }

  function speedUnit() {
    return state.unit === "metric" ? "km/h" : "mph";
  }

  function formatSecondarySpeed(ms) {
    if (!isFinite(ms)) return "—";
    var value = state.unit === "metric" ? ms : ms * FT_PER_M;
    return value.toFixed(1);
  }

  function secondaryUnit() {
    return state.unit === "metric" ? "m/s" : "ft/s";
  }

  function formatDistance(meters) {
    if (!isFinite(meters)) return { value: "—", unit: state.unit === "metric" ? "km" : "mi" };
    if (state.unit === "metric") {
      return meters >= 1000
        ? { value: (meters / 1000).toFixed(2), unit: "km" }
        : { value: meters.toFixed(0), unit: "m" };
    }
    var feet = meters * FT_PER_M;
    return feet >= 5280
      ? { value: (feet / 5280).toFixed(2), unit: "mi" }
      : { value: feet.toFixed(0), unit: "ft" };
  }

  function formatAccuracy(meters) {
    if (meters == null || !isFinite(meters)) return { value: "—", unit: state.unit === "metric" ? "m" : "ft" };
    return state.unit === "metric"
      ? { value: Math.round(meters).toString(), unit: "m" }
      : { value: Math.round(meters * FT_PER_M).toString(), unit: "ft" };
  }

  function setError(message) {
    if (!message) {
      els.error.classList.remove("is-visible");
      els.error.textContent = "";
      return;
    }
    els.error.textContent = message;
    els.error.classList.add("is-visible");
  }

  function setStatus(text) {
    els.status.textContent = text;
  }

  function setLive(active, label) {
    state.watching = active;
    els.live.classList.toggle("is-live", active);
    els.live.textContent = label || (active ? "Live" : "Idle");
    els.start.disabled = active;
    els.stop.disabled = !active;
  }

  function signalFor(accuracy) {
    if (accuracy == null || !isFinite(accuracy)) {
      return { text: "No fix", className: "" };
    }
    var shown = formatAccuracy(accuracy);
    if (accuracy <= 15) return { text: "Strong ±" + shown.value + " " + shown.unit, className: "is-good" };
    if (accuracy <= 45) return { text: "Fair ±" + shown.value + " " + shown.unit, className: "is-weak" };
    return { text: "Weak ±" + shown.value + " " + shown.unit, className: "is-bad" };
  }

  function updateSignal() {
    var signal = signalFor(state.accuracy);
    els.signal.textContent = signal.text;
    els.signal.className = "signal-pill" + (signal.className ? " " + signal.className : "");
  }

  function updateHeading(degrees) {
    if (degrees == null || !isFinite(degrees)) {
      els.heading.textContent = "—";
      els.compassLabel.textContent = "N";
      els.compass.style.transform = "rotate(0deg) translateY(-100%)";
      return;
    }
    var normalized = ((degrees % 360) + 360) % 360;
    state.heading = normalized;
    els.heading.textContent = Math.round(normalized).toString();
    els.compassLabel.textContent = window.SpeedLab ? SpeedLab.cardinal(normalized) : "N";
    els.compass.style.transform = "rotate(" + normalized.toFixed(1) + "deg) translateY(-100%)";
  }

  function renderGauge(ms, label) {
    if (!gauge || !window.SpeedLab) return;
    var kmh = ms * KMH_PER_MS;
    if (kmh > state.scaleMaxKmh * 0.95) {
      state.scaleMaxKmh = Math.ceil((kmh * 1.1) / 60) * 60;
    }
    var shown = state.unit === "metric" ? kmh : kmh / 1.609344;
    var max = state.unit === "metric" ? state.scaleMaxKmh : state.scaleMaxKmh / 1.609344;
    SpeedLab.setGauge(gauge, max > 0 ? shown / max : 0, {
      value: formatSpeedWhole(ms),
      unit: speedUnit(),
      sub: label || "Current speed",
      scaleMax: String(Math.round(max)),
      ariaText: formatSpeedWhole(ms) + " " + speedUnit() + ", " + (label || "current speed")
    });
  }

  function renderTrip() {
    var speed = state.smoothSpeed || 0;
    if (state.unit === "metric") {
      els.ms.textContent = (speed).toFixed(1);
      els.msUnit.textContent = "m/s";
    } else {
      els.ms.textContent = (speed * FT_PER_M).toFixed(1);
      els.msUnit.textContent = "ft/s";
    }

    var distance = formatDistance(state.distance);
    els.distance.textContent = distance.value;
    els.distanceUnit.textContent = distance.unit;

    els.max.textContent = state.maxSpeed > 0 ? formatSpeedWhole(state.maxSpeed) : "—";
    els.maxUnit.textContent = speedUnit();

    var elapsedMs = state.startTime ? Date.now() - state.startTime : 0;
    var avg = elapsedMs > 1000 ? state.distance / (elapsedMs / 1000) : 0;
    els.avg.textContent = state.distance > 1 ? formatSpeedWhole(avg) : "—";
    els.avgUnit.textContent = speedUnit();

    var accuracy = formatAccuracy(state.accuracy);
    els.accuracy.textContent = state.accuracy == null ? "—" : accuracy.value;
    els.accuracyUnit.textContent = accuracy.unit;

    els.fixes.textContent = String(state.fixes);
    els.elapsed.textContent = state.startTime ? "Elapsed " + SpeedLab.duration(elapsedMs) : "Elapsed 00:00";

    renderGauge(speed, "Current speed");
    updateRating();
  }

  function tierForKmh(kmh) {
    var minimums = TIERS.map(function (tier) { return tier.min; });
    return window.SpeedLab.rankFor(kmh, minimums);
  }

  function showRankResult() {
    if (!window.SpeedLab || state.fixes === 0) return;
    var kmh = (state.maxSpeed || 0) * KMH_PER_MS;
    var index = tierForKmh(kmh);
    var tier = TIERS[index];
    SpeedLab.showRankCard({
      image: IMAGE_BASE + tier.file,
      alt: "Tier " + (index + 1) + " reaction: " + tier.name,
      tier: index + 1,
      total: TIERS.length,
      kicker: "Reality rank · Top speed",
      title: tier.name,
      value: formatSpeedWhole(state.maxSpeed),
      unit: speedUnit(),
      text: tier.range + ". " + tier.text,
      accent: "#c8ff2e"
    });
  }

  function updateRating() {
    // Once tracking stops, keep the final rank pinned to the trip's top speed
    // instead of dropping back to zero.
    var kmh = (state.watching ? state.smoothSpeed : Math.max(state.smoothSpeed, state.maxSpeed)) * KMH_PER_MS;
    var rating;
    if (!state.startTime) {
      rating = { icon: "📍", title: "Waiting for a fix", text: "Speed ranks appear once you start moving." };
    } else if (state.fixes === 0) {
      rating = { icon: "🛰️", title: "Searching for GPS", text: "Waiting for the first position fix. Give it a clear view of the sky." };
    } else {
      var index = tierForKmh(kmh);
      var tier = TIERS[index];
      rating = {
        icon: tier.icon,
        title: "Tier " + (index + 1) + " · " + tier.name,
        text: tier.range + " — " + tier.text
      };
    }
    els.ratingIcon.textContent = rating.icon;
    els.ratingTitle.textContent = rating.title;
    els.ratingText.textContent = rating.text;
  }

  function onPosition(position) {
    var coords = position.coords;
    var timestamp = position.timestamp || Date.now();

    setError("");
    setLive(true, "Live");
    if (state.startTime == null) state.startTime = timestamp;
    state.lastFixAt = Date.now();
    state.fixes += 1;
    state.accuracy = coords.accuracy;

    var computed = null;
    if (state.lastFix) {
      var dt = (timestamp - state.lastFix.t) / 1000;
      if (dt > 0.25 && dt < 30) {
        var moved = haversineMeters(
          state.lastFix.lat, state.lastFix.lon,
          coords.latitude, coords.longitude
        );
        var quality = coords.accuracy == null ? 30 : coords.accuracy;
        if (quality <= 150 && moved < 2000) {
          if (moved >= 1.2 && quality <= 80) state.distance += moved;
          computed = moved / dt;
        }
        var bearing = bearingDegrees(
          state.lastFix.lat, state.lastFix.lon,
          coords.latitude, coords.longitude
        );
        if (moved >= 2) updateHeading(coords.heading != null ? coords.heading : bearing);
      }
    }

    if (coords.heading != null && isFinite(coords.heading) && coords.heading >= 0) {
      updateHeading(coords.heading);
    }

    var reported = coords.speed;
    var raw = null;
    if (reported != null && isFinite(reported) && reported >= 0) {
      raw = reported;
    }
    if (computed != null && isFinite(computed)) {
      if (raw == null) {
        raw = computed;
      } else if (raw < 1 && computed > 2) {
        // Receiver says "stationary" while fixes show real movement (common
        // when a device has no Doppler speed yet): trust displacement.
        raw = computed;
      } else {
        raw = raw * 0.65 + computed * 0.35;
      }
    }
    if (raw != null) {
      if (raw < 0.5) raw = 0;
      state.smoothSpeed = state.smoothSpeed + 0.32 * (raw - state.smoothSpeed);
      if (state.smoothSpeed < 0.2) state.smoothSpeed = 0;
      if (state.smoothSpeed > state.maxSpeed) state.maxSpeed = state.smoothSpeed;
    }

    state.lastFix = {
      lat: coords.latitude,
      lon: coords.longitude,
      t: timestamp
    };

    updateSignal();
    renderTrip();
    setStatus("Tracking — last fix " + new Date(timestamp).toLocaleTimeString("en-CA"));
    state.staleWarned = false;
    els.copy.disabled = state.fixes === 0;
    els.viewRank.disabled = state.fixes === 0;
  }

  function onError(error) {
    var message = "Location is unavailable.";
    if (error && error.code === 1) {
      message = "Location permission was blocked. Allow location for this site in your browser settings, then tap Start tracking again.";
    } else if (error && error.code === 2) {
      message = "The device could not obtain a GPS position right now. Move somewhere with a clearer view of the sky and try again.";
    } else if (error && error.code === 3) {
      message = "The GPS request timed out. Try again, and give the receiver a few seconds to settle.";
    }
    // A transient fix error must not wipe an otherwise healthy reading.
    if (state.fixes === 0) {
      setError(message);
      setStatus("No GPS fix.");
      setLive(false, "Idle");
      state.smoothSpeed = 0;
      renderGauge(0, "No GPS fix");
    } else {
      setStatus("GPS signal hiccup — keeping the last known speed.");
    }
  }

  function startTracking() {
    setError("");
    if (!window.isSecureContext) {
      setError("Location access needs a secure page. Open this page over HTTPS (or localhost) and try again.");
      return;
    }
    if (!navigator.geolocation) {
      setError("This browser does not support the Geolocation API. Try a current version of Safari, Chrome or Edge.");
      return;
    }
    if (state.watching) return;

    if (state.watchId != null) {
      navigator.geolocation.clearWatch(state.watchId);
      state.watchId = null;
    }

    if (state.startTime == null) state.startTime = Date.now();
    state.lastFix = null;
    state.scaleMaxKmh = 240;
    setStatus("Waiting for the first GPS fix…");
    setLive(true, "Live");
    updateSignal();
    renderTrip();

    state.watchId = navigator.geolocation.watchPosition(onPosition, onError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 20000
    });
  }

  function stopTracking() {
    if (state.watchId != null) {
      navigator.geolocation.clearWatch(state.watchId);
    }
    state.watchId = null;
    setLive(false, "Idle");
    setStatus("Tracking paused.");
    state.smoothSpeed = 0;
    renderGauge(0, "Tracking paused");
    renderTrip();

    // The trip has ended: show the art for the top speed reached.
    if (state.fixes > 0) {
      setTimeout(showRankResult, 420);
    }
  }

  function resetTracking() {
    state.startTime = state.watching ? Date.now() : null;
    state.lastFix = null;
    state.distance = 0;
    state.maxSpeed = 0;
    state.smoothSpeed = 0;
    state.heading = null;
    state.accuracy = null;
    state.fixes = 0;
    state.scaleMaxKmh = 240;
    state.staleWarned = false;
    els.copy.disabled = true;
    els.viewRank.disabled = true;
    setError("");
    updateHeading(null);
    updateSignal();
    renderGauge(0, "Current speed");
    renderTrip();
    els.max.textContent = "—";
    els.avg.textContent = "—";
    els.distance.textContent = "—";
    els.accuracy.textContent = "—";
    els.elapsed.textContent = "Elapsed 00:00";
  }

  function copyTrip() {
    if (state.fixes === 0) return;
    var distance = formatDistance(state.distance);
    var elapsed = state.startTime ? SpeedLab.duration(Date.now() - state.startTime) : "00:00";
    var tierIndex = tierForKmh((state.maxSpeed || 0) * KMH_PER_MS);
    var text = [
      "Speed Lab — GPS Speedometer",
      "Distance " + distance.value + " " + distance.unit,
      "Top speed " + (state.maxSpeed > 0 ? formatSpeedWhole(state.maxSpeed) + " " + speedUnit() : "—"),
      "Tier " + (tierIndex + 1) + "/" + TIERS.length + " — " + TIERS[tierIndex].name,
      "Fixes " + state.fixes + " · Elapsed " + elapsed + " · Accuracy ±"
        + (state.accuracy == null ? "—" : formatAccuracy(state.accuracy).value)
        + " " + (state.accuracy == null ? "" : formatAccuracy(state.accuracy).unit),
      "https://songtianxiang.com/gps-speedometer/"
    ].join("\n");

    var done = function () {
      els.copy.textContent = "Copied!";
      setTimeout(function () { els.copy.textContent = "Copy trip"; }, 1600);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () { fallback(text, done); });
    } else {
      fallback(text, done);
    }
  }

  function fallback(text, done) {
    var area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    try { document.execCommand("copy"); done(); } catch (error) { /* ignore */ }
    document.body.removeChild(area);
  }

  function tick() {
    if (!state.startTime) return;
    if (state.fixes === 0) {
      els.elapsed.textContent = "Elapsed " + SpeedLab.duration(Date.now() - state.startTime);
      return;
    }
    var now = Date.now();
    if (state.watching && !state.staleWarned && now - state.lastFixAt > 12000) {
      state.staleWarned = true;
      setStatus("Signal lost — waiting for the next fix.");
      updateSignal();
    }
    var distance = formatDistance(state.distance);
    els.distance.textContent = distance.value;
    els.distanceUnit.textContent = distance.unit;
    var elapsedMs = now - state.startTime;
    els.elapsed.textContent = "Elapsed " + SpeedLab.duration(elapsedMs);
    if (state.distance > 1) {
      els.avg.textContent = formatSpeedWhole(state.distance / (elapsedMs / 1000));
    }
    if (now - state.lastRender > 450) {
      state.lastRender = now;
      renderGauge(state.smoothSpeed, "Current speed");
    }
  }

  function initUnits() {
    document.querySelectorAll("[data-unit]").forEach(function (button) {
      button.addEventListener("click", function () {
        state.unit = button.getAttribute("data-unit") === "imperial" ? "imperial" : "metric";
        document.querySelectorAll("[data-unit]").forEach(function (other) {
          other.setAttribute("aria-pressed", String(other === button));
        });
        updateSignal();
        renderTrip();
      });
    });
  }

  function init() {
    if (!gauge || !window.SpeedLab) return;
    initUnits();
    updateHeading(null);
    updateSignal();
    renderTrip();
    els.start.addEventListener("click", startTracking);
    els.stop.addEventListener("click", stopTracking);
    els.reset.addEventListener("click", resetTracking);
    els.copy.addEventListener("click", copyTrip);
    els.viewRank.addEventListener("click", showRankResult);
    setInterval(tick, 500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
