# Starfall – Space Shooter

A small, dependency-free space shooter built with plain HTML, CSS and JavaScript (Canvas 2D + Web Audio). No build step, no libraries, no external assets.

## Run it

Open `index.html` in any modern browser. That's it.

To test on a phone, serve the folder on your local network, for example:

```bash
python3 -m http.server 8000
```

then open `http://<your-computer-ip>:8000` on the phone.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure: canvas, HUD, start / pause / game-over screens, touch controls |
| `style.css` | Layout, responsive scaling, overlays, touch-control styling |
| `script.js` | Game logic, rendering, input, synthesized sound, best-score storage |
| `README.md` | This file |

## Controls

**Keyboard**

| Action | Keys |
| --- | --- |
| Move | `←` `→` or `A` `D` |
| Fire (hold for continuous fire) | `Space`, `↑` or `W` |
| Pause / resume | `P` or `Esc` |
| Mute / unmute | `M` |
| Start / restart | `Enter` or `Space` |

**Touch devices**

- Hold the on-screen **◀ ▶** buttons to move and **FIRE** to shoot (hold for continuous fire).
- Or drag a finger across the play area to steer the ship, and use **FIRE** with your other thumb.
- The touch buttons appear automatically on devices with a coarse pointer (phones and tablets).

The game pauses automatically when the tab loses focus or the page is hidden.

## Gameplay

- You start with **3 lives**. Colliding with an enemy or being hit by an enemy bullet costs a life, followed by 2 seconds of invulnerability (the ship blinks).
- Enemies that slip past the bottom of the screen cost nothing, but give no points either.
- Every **10 kills** raises the **level**.

| Enemy | Appears | Behaviour | Points |
| --- | --- | --- | --- |
| Scout | Level 1 | Flies straight down | 10 |
| Zigzag | Level 2 | Weaves side to side | 20 |
| Tank | Level 3 | Slow, takes 4 hits | 50 |
| Shooter | Level 4 | Fires aimed shots at you | 35 |

### Difficulty curve

As the level rises:

- enemies spawn more often (down to a minimum gap of 0.3 s) and move faster,
- harder enemy types join the mix,
- shooters fire more often and their bullets get faster,
- from level 5, enemies sometimes spawn in pairs,
- from level 4, your ship upgrades to twin cannons.

## Sound

All sound effects (shooting, hits, explosions, level up, game over) are synthesized at runtime with the Web Audio API, so there are no audio files. Browsers only allow audio after a user gesture, so sound starts on your first key press or tap. The mute setting is remembered.

## Saved data

Two values are stored in `localStorage`:

- `starfall.best` – your best score
- `starfall.muted` – `1` if sound is muted

If storage is unavailable (for example in some private-browsing modes) the game still works; the best score just won't persist between sessions. To reset your best score, run `localStorage.removeItem('starfall.best')` in the browser console.

## Tweaking the game

The main tuning values are at the top of `script.js` and in the "difficulty" section:

- `START_LIVES`, `KILLS_PER_LEVEL`, `INVULN_TIME` – basic rules
- `ENEMY_TYPES` – size, hit points, speed, score and colour of each enemy
- `spawnInterval()`, `enemySpeedBoost()`, `shooterCooldown()`, `enemyBulletSpeed()` – how difficulty scales with level

The play area is a fixed 480 × 720 logical canvas that is scaled to fit any screen, so gameplay is identical on every device.

## Browser support

Any current version of Chrome, Edge, Firefox or Safari (desktop and mobile).
