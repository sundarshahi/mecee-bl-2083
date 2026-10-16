# MECEE-BL 2083

Free practice app for Nepal's Medical Education Common Entrance Examination – Bachelor Level (MECEE-BL, MBBS/BDS).

**Open it:** https://sundarshahi.github.io/mecee-bl-2083/

- 2,628 original MCQs on the 32 units of the official MEC syllabus (3rd revision, April 2026), with the official number of questions per unit.
- 730 questions test concepts that repeat in recalled 2078–2082 papers, marked "Asked 2079, 2081…".
- Full series papers on the exam pattern: 200 questions, 3 hours, −0.25 per wrong answer.
- Adaptive practice, spaced review, confidence marking, unit notes and a projected score.
- Progress is saved in your browser on each device.

The questions are written for this app. MEC does not publish past papers; the "Asked in" years come from student-recalled papers and are a guide, not official data.

## Update the question bank

Edit the JSON files in `src/bank2/`, then run:

```
cd src && python3 build.py
```

This rebuilds `index.html`.

## Install as an app

- **Android / Chrome / Edge:** open the site and tap **Install** on the Home screen card (or the browser's install icon).
- **iPhone / iPad:** open the site in Safari, tap **Share**, then **Add to Home Screen**.

After the first visit it works offline. New versions download in the background and show the next time you open it.
