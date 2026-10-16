import json, pathlib, collections
here = pathlib.Path(__file__).parent
# Official MECEE-BL grid (syllabus 3rd revision, Apr 2026); ids fixed in SPEC2.md
GRID = {
  "Physics": {"phy-mechanics": 10, "phy-heat": 7, "phy-waves-optics": 8, "phy-electrostatics": 4, "phy-current-magnetism": 9, "phy-modern": 12},
  "Chemistry": {"chem-physical": 17, "chem-inorganic": 10, "chem-organic": 17, "chem-applied": 3, "chem-analytical": 3},
  "Zoology": {"zoo-evolution": 3, "zoo-diversity": 4, "zoo-tissues": 4, "zoo-selected-animals": 6, "zoo-human-biology": 15, "zoo-diseases-immunology": 4, "zoo-medical-applied": 2, "zoo-environment": 2},
  "Botany": {"bot-basic": 2, "bot-biodiversity": 9, "bot-ecology": 4, "bot-cell": 5, "bot-genetics": 6, "bot-anatomy": 3, "bot-physiology": 6, "bot-developmental": 2, "bot-applied": 3},
  "MAT": {"mat-verbal": 5, "mat-numerical": 5, "mat-logical": 5, "mat-spatial": 5},
}
FILES = {"Physics": ["physics-a", "physics-b"], "Chemistry": ["chemistry-a", "chemistry-b"], "Zoology": ["zoology-a", "zoology-b"], "Botany": ["botany-a", "botany-b"], "MAT": ["mat"]}
N_SERIES = 5
# Not in the 2026 syllabus (xenon compounds, sucrose hydrolysis, cockroach heart, honeybee drones)
DROP = {"chem-047", "chem-074", "zoo-023", "zoo-069",
        "phyA-228", "zooB-147", "zooB-144"}  # last three: same question already in another subject

subjects, problems = [], []
for subj, files in FILES.items():
    topics, qs = {}, []
    for f in files:
        d = json.load(open(here / "bank2" / f"{f}.json"))
        for t in d["topics"]:
            topics[t["id"]] = t
        qs += [q for q in d["questions"] if q["id"] not in DROP]
    for tid, w in GRID[subj].items():
        if tid not in topics:
            problems.append(f"{subj}: unit {tid} has no topic entry")
            topics[tid] = {"id": tid, "name": tid, "concepts": []}
        topics[tid]["weight"] = w
    for q in qs:
        assert q["topic"] in GRID[subj], (q["id"], q["topic"])
        assert len(q["o"]) == 4 and len(set(q["o"])) == 4 and 0 <= q["a"] <= 3, q["id"]
    subjects.append({"subject": subj, "topics": [topics[t] for t in GRID[subj]], "questions": qs})

ids = [q["id"] for s in subjects for q in s["questions"]]
dupes = [i for i, c in collections.Counter(ids).items() if c > 1]
assert not dupes, dupes

# Series papers: each unit contributes its exact grid count. Questions on the most-repeated concepts go to Series 1, then down the list.
series = [{"name": f"Series {k + 1}", "ids": []} for k in range(N_SERIES)]
short = []
for s in subjects:
    for tid, w in GRID[s["subject"]].items():
        pool = [q for q in s["questions"] if q["topic"] == tid]
        pool.sort(key=lambda q: (-(q.get("rep") or 0), -max(q.get("yrs") or [0]), q["id"]))
        if len(pool) < N_SERIES * w:
            short.append(f"{tid} {len(pool)}/{N_SERIES * w}")
        for k in range(N_SERIES):
            series[k]["ids"] += [pool[(k * w + j) % len(pool)]["id"] for j in range(w)] if pool else []
for p in series:
    assert len(p["ids"]) == 200, (p["name"], len(p["ids"]))

meta = json.load(open(here / "meta.json"))
bank = json.dumps({"meta": meta, "subjects": subjects, "series": series}, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
page = (here / "template.html").read_text().replace("__BANK__", bank)
head = ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
        '<meta name="description" content="Free MECEE-BL (MBBS entrance, Nepal) practice: syllabus-based MCQs, series papers, spaced review and a projected score.">'
        '<link rel="manifest" href="manifest.webmanifest"><meta name="theme-color" content="#E8ECE7">'
        '<link rel="icon" type="image/png" href="icons/favicon-32.png"><link rel="apple-touch-icon" href="icons/apple-touch-icon.png">'
        '<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes">'
        '<meta name="apple-mobile-web-app-title" content="MECEE 2083"><meta name="apple-mobile-web-app-status-bar-style" content="default">'
        '<script>window.__PWA__ = 1</script>'
        '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>')
html = head + page + "</html>\n"
(here.parent / "index.html").write_text(html)
# offline worker: a new cache name per build, so phones pick up each new version
import hashlib
ver = hashlib.sha1(html.encode()).hexdigest()[:10]
(here.parent / "sw.js").write_text((here / "sw.template.js").read_text().replace("__VER__", ver))
for s in subjects:
    c = collections.Counter(q["topic"] for q in s["questions"])
    print(s["subject"], len(s["questions"]), {t: c[t] for t in GRID[s["subject"]]})
print("total", len(ids), "| repeat-tagged", sum(1 for x in subjects for q in x["questions"] if q.get("rep")), "|", len(html) // 1024, "KB")
print("units short of 5 unique papers (questions reused across series):", short or "none")
print("problems:", problems or "none")
