# Rodinný Rozpočet — kontext projektu

## Co to je
PWA aplikace pro sdílený rodinný rozpočet Thomase a Anny (2 iPhony).
Denní zapisování výdajů proti měsíčnímu plánu po kategoriích, synchronizace
mezi telefony v reálném čase. Instaluje se přes Safari → „Přidat na plochu".

- **Produkce:** https://thomasriefler.github.io/rozpocet/ (GitHub Pages, repo ThomasRiefler/rozpocet)
  — dřív rodrozpocet.netlify.app (opuštěno 1. 8. 2026: Netlify blokoval deploye kvůli kreditům)
- **Jazyk UI:** čeština
- **Uživatelé:** 2 (Thomas, Anna) — nejde o veřejný produkt

## Stack
- Jeden soubor `index.html` — vanilla HTML/CSS/JS, ŽÁDNÝ build step, žádné závislosti
- `sw.js` — service worker (offline + aktualizace)
- `manifest.json` + ikony — PWA instalace
- Synchronizace: Google Apps Script web app (Thomasův účet riefler.thomas@gmail.com;
  data v souboru rozpocet-riefler-data.json na jeho Drive; server sám slučuje přes doPost).
  Dřív jsonblob.com — opuštěn, mazal bloby. POST z appky jde s Content-Type text/plain (CORS).
- Graf: ruční kreslení na `<canvas>` (donut s popisky a vodicími čarami)

## Datový model — NIKDY NEMĚNIT KLÍČE (rozbila by se data i párování!)
localStorage klíče:
- `budgetState` — `{ plan: {catKey: {v,ts}}, tx: {id: {id, amt, cat, who, note, d, ts, del?, fund?}}, labels?: {labelKey: {v:string[], ts}} }`
  - `fund` (volitelné, fondové kategorie `dovolena` a `vzdelani`): `'in'` = odklad do fondu (počítá se do měsíčního plánu),
    `'out'` = čerpání z fondu (NEPOČÍTÁ se do útraty měsíce). Záznam bez `fund` = chová se jako `'in'`.
  - `labels` — vlastní rychlé štítky; labelKey = catKey, u fondových kategorií `catKey:in` / `catKey:out`.
    Merge per klíč podle `ts` (jako plan). Bez záznamu platí DEFAULT_LABELS v kódu.
- `familyUrl` — exec URL rodinné Apps Script web appky (klíč zachován z historických důvodů)
- `myName` — "Thomas" | "Anna"
- `syncOptOut` — "1" po ručním odpojení; blokuje auto-připojení (appka se jinak sama připojí
  k výchozímu rodinnému blobu `FAMILY_JOIN_DEFAULT` v index.html)

Merge při synchronizaci: per-záznam podle `ts` (novější vyhrává). Mazání = tombstone `del:true`.
Kategorie (klíče neměnit): bydleni, jidlo, zdravi, sporeni, vzdelani, dovolena, auta, zabava.

## Design systém
Paleta: espresso #352C22, zlatá #C8924A / #F0CB7E, krémová #F6F1E8, inkoust #241D14.
Barvy kategorií: bydleni #D96B4F, jidlo #DFA23E, zdravi #9268C7, sporeni #3BA372,
vzdelani #4A7FC1, dovolena #35A6A0, auta #7D8899, zabava #D2617E.
Vlastní zlatá numerická klávesnice (bottom sheet) místo iOS klávesnice.
Fonty: systémové (-apple-system) kvůli rychlosti. Vstupy min. 16px (jinak iOS zoomuje).

## Nasazení — POKAŽDÉ dodržet
1. Před každým nasazením **zvednout verzi cache v `sw.js`** (`rozpocet-vN` → `rozpocet-vN+1`),
   jinak se aktualizace nepropíše do nainstalovaných PWA.
2. `git add -A && git commit && git push` — GitHub Pages nasadí automaticky z větve main
   (build trvá ~1 minutu; gh CLI je přihlášené jako ThomasRiefler).
3. Po nasazení ověřit: `curl -s https://thomasriefler.github.io/rozpocet/sw.js | head -1`
   (musí vracet novou verzi cache) + rozlišovací text nové verze v index.html.
4. Změny se v telefonech projeví po zavření a druhém otevření appky.
   Pozn.: GitHub Pages ignoruje netlify.toml hlavičky — sw.js se cachuje max 10 min, to stačí.

## Zásady
- Zpětná kompatibilita dat je svatá: existující `budgetState` a `familyUrl` musí fungovat i po změnách.
- Žádné frameworky, žádný build — jeden HTML soubor drží aplikaci jednoduchou a rychlou.
- Mobile-first (iPhone 16 Pro), safe-area insets, nic se nesmí překrývat.
- Viditelná zpětná vazba při ukládání (tlačítko → ✓, toast, sync indikátor v hlavičce).
- Popisky koláče nesmí kolidovat (slot algoritmus po stranách).
- Komunikace s Thomasem: česky, stručně, výsledky místo vysvětlování.
