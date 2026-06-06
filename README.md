# Vocab Leitner Assistant

Vocab Leitner Assistant is a Chrome extension for learning English vocabulary while you browse.  
Select a word on any webpage, right-click, and instantly open a floating toolbox for dictionary lookup, translation, pronunciation, and Leitner-style memorization.

## What it does

- Dictionary lookup for selected English words and short phrases
- Persian translation by default, with many other target languages available
- US and UK pronunciation via text-to-speech
- Save words into a Leitner box system for spaced repetition
- Review due cards manually from the popup
- Optional in-browse review reminders while you continue surfing
- Export saved words as CSV for backup

## Main features

### 1. Selected-word toolbar

When you select text on a webpage and use the context menu, the extension shows a floating toolbar near your selection.  
It includes:

- Dictionary lookup
- Add to Leitner
- US spelling
- UK spelling
- Translation

If the selected text is near the bottom of the page, the toolbar automatically repositions itself so it stays visible inside the viewport.

### 2. Leitner review system

Saved words are organized into five Leitner boxes:

- Box 1: new
- Box 2: 1 day
- Box 3: 3 days
- Box 4: 7 days
- Box 5: 14 days

You can review cards from the popup, mark them as known or again, and the extension updates the next due date automatically.

### 3. Browsing reminders

The extension can show small review cards while you browse.  
You can control:

- Whether browsing review is enabled
- How often it checks
- How many cards to show at once

### 4. Popup dashboard

The popup gives you a quick learning dashboard:

- Daily goal progress
- Streak tracking
- Current Leitner box counts
- Due cards
- Word export
- Visual theme selection
- Translation target selection
- About section with GitHub and contact info

## How it works

1. Select a word or short phrase on a webpage.
2. Right-click and choose the Vocab Assistant context menu.
3. Use the floating toolbar to look up meaning, hear pronunciation, translate, or save it to Leitner.
4. Open the extension popup later to review due cards and track your progress.

## Data and privacy

This extension stores vocabulary and settings locally in Chrome storage.

- Saved cards, Leitner box status, review dates, settings, and streak data stay on your device
- Dictionary requests go to `dictionaryapi.dev`
- Translation requests go to `api.mymemory.translated.net` and the LibreTranslate fallback endpoint
- No ads, no analytics, and no browsing history collection

See [`PRIVACY_NOTES.txt`](PRIVACY_NOTES.txt) for the short privacy summary.

## Installation

### Load unpacked in Chrome

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click `Load unpacked`
4. Select this project folder

## Files

- `background.js` handles context menu actions, storage, dictionary lookup, translation, reminders, and Leitner review logic
- `content.js` renders the floating selected-word toolbar and inline review UI
- `popup.html`, `popup.css`, and `popup.js` power the dashboard popup
- `styles.css` styles the in-page floating UI
- `assets/` contains the logo and mascot artwork

## Stack

- Manifest V3 Chrome extension
- Vanilla JavaScript
- Chrome storage, alarms, scripting, and context menus APIs

## Contact

- GitHub: [mehdigho1994/vocab-leitner-assistant](https://github.com/mehdigho1994/vocab-leitner-assistant)
- Email: mehdigho1994@gmail.com

