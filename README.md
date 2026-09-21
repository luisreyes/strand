# Strand

A colored thread of your working time. Strand is a small time tracker that runs in the browser, stores everything on the device, and installs as an app.

The timeline is the clock. The color at the right edge is the task you are in. Switch tasks and a new color is appended. Hover or tap a color to see its title and length. Edit a task's time and the bar redraws.

Live site: [https://luisreyes.github.io/strand/](https://luisreyes.github.io/strand/)

## Use it

1. Type a title, pick a color, and press the plus button.
2. Select the task. The clock runs and the timeline grows.
3. Select another task to append a new color. Pause or Resume sits under the clock.
4. Edit a task to add a description, change its color, or set the tracked time.
5. On a wide screen, **Float** opens a clean window (Picture-in-Picture in Chrome and Edge, a small popup elsewhere).

Times stay in this browser until you export them.

## Take your times with you

- **Export backup** downloads a JSON file. **Import backup** replaces the time on this device with that file.
- **Copy to clipboard** copies a sheet you can paste into Google Sheets, Excel, or a note.
- **Export to Google Sheets** copies the same sheet and opens a new Google Sheet so you can paste it.
- **Download CSV** saves a file Sheets and Excel can open.

A running timer is stored in the backup as paused time, so the gap between export and import is not counted. Select the task again to continue.

## Install

Strand is a progressive web app.

- **Desktop Chrome or Edge:** More → Install app, or the install icon in the address bar.
- **iPhone:** Share → Add to Home Screen.
- **Android:** the browser menu → Install app or Add to Home screen.

After the first visit it opens offline.

## Develop

```bash
cd ~/Development/strand
npm test
npm start
```

Open [http://localhost:4173](http://localhost:4173). A static server is required so the service worker can register. There is no build step.

## Data

Backups look like this:

```json
{
  "app": "strand",
  "version": 1,
  "tasks": [{ "id": "...", "title": "Design", "description": "", "color": "#ff6b4a", "createdAt": 0 }],
  "segments": [{ "id": "...", "taskId": "...", "start": 0, "end": null, "offsetMs": 0 }]
}
```

`end: null` means that block is still running. `offsetMs` is how a hand-edited duration differs from the wall clock.

## Fonts

Instrument Serif, Instrument Sans, and IBM Plex Mono are bundled under the SIL Open Font License. See `fonts/`.

The app code is [MIT](LICENSE).
