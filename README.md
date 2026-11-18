# GPS Speedometer

Turn a phone or laptop into a GPS speedometer. Everything runs in the browser: the page reads
position fixes from the Geolocation API and derives speed, distance, heading and accuracy from
consecutive samples — no backend, no data leaves the device.

**Live:** https://songtianxiang.com/gps-speedometer/

## What it shows

- Current speed in km/h, mph, m/s and ft/s
- Distance travelled, top speed, average speed
- Heading (compass direction) and GPS accuracy
- A live gauge plus a trip summary you can reset

## Notes

- Geolocation requires a secure context, so test it over `https://` or on `localhost` — opening the
  file directly as `file://` will not prompt for permission.
- Accuracy depends entirely on the device's GPS chip; indoors the readings will be rough.

## Running locally

Static files, no build step:

```bash
php -S 127.0.0.1:8000
```

Or serve the folder with any static server and open <http://127.0.0.1:8000/>.

## Structure

```
index.html            markup, gauge, controls
gps-speedometer.js    geolocation sampling, unit maths, gauge rendering
```

## License

MIT — see [LICENSE](LICENSE).
