---
name: angelup
description: "AngelUp (angelup.de): Angelschule/Fischerprüfung Niedersachsen. Website, Lern-App, Video- und Livekurse, Kurstermine Aurich, Kurs-Codes, Supabase, Vermarktung, Abrechnung."
---

# AngelUp – Angelschule & Lernplattform

AngelUp ist Marks Vorbereitungsangebot auf die **Fischerprüfung in Niedersachsen**
(Prüfung des Landesfischereiverbands Weser-Ems, Prüfungsort **Aurich**).
Domain: **angelup.de** · Kontakt: **kontakt@angelup.de** · Repo: `bwtschwarze-ux/angelup`.

> **Grundregel:** Preise, Termine und Prüfungsdetails stehen live auf der Website
> (`kurs.html`, `kurse.html`). Vor jeder Aussage dort gegenprüfen, nicht aus dem
> Gedächtnis antworten.

Verwandte Skills: `rechtscheck-shop-website` (Impressum/AGB/Datenschutz),
`social-media-angeln` / `marketing-strategie` (Werbung), `steuerberater` (USt),
`foerdermittel` (Zuschüsse), `app-entwicklung` (Play-Store-App).

---

## 1. Angebot

| Produkt | Inhalt | Stand (live prüfen) |
|---|---|---|
| Präsenzlehrgang + Prüfung | Ein Kurs über fünf Termine: Theorie Fr-Abend + Wochenende, Praxistag mit echtem Gerät, danach Prüfung in Aurich | 160,00 € inkl. Prüfungsgebühr |
| Nur Prüfung | Für Teilnehmer mit Lehrgang anderswo / Wiederholer | 70,00 € |
| Online-Kurs (`lernen.html`) | 7 Module, 37 Lektionen, 200+ Übungsfragen, Prüfungssimulation | – |
| Videokurse / Pakete (`videokurse.html`) | Einmal kaufen, unbegrenzt ansehen; Zugang per Code nach Zahlungseingang | – |
| Livekurs (`live.html`) | Jitsi-Raum auf meet.ffmuc.net, öffnet in neuem Tab | – |
| Sonderkurse (z. B. `aal.html`) | Themenkurse mit festem Termin | – |
| Lern-App (`app.html`) | Fragenkatalog üben, auch als Android-App im Play Store | – |
| Gratis-Werkzeuge | `fischbilder.html` (48 Fische), `schonzeiten.html` (Mindestmaße/Schonzeiten) | – |

Termine ohne festes Datum → **Vormerkliste** (`vormerken.html`), keine Buchung.

**Pflichthinweis auf allen Seiten:** AngelUp ist ein *privates Lernangebot*, keine
Behörde. Wir nehmen keine Prüfungen ab und stellen keine Fischereischeine aus.
Amtliche Quellen werden verlinkt. (Grund: Play-Store-Richtlinie „Irreführende Angaben“.)
Diesen Hinweis bei neuen Seiten nie weglassen.

**Fachliche Quelle:** Fragenkatalog und Prüfungsordnung sind die des **Landes
Niedersachsen**, nicht des Verbands. Regionale Kurswerte (Esens): Aal 28 cm,
Hecht 50 cm, Zander 45 cm, Wels 50 cm, Schonzeit 01.02.–30.04. Bei Abweichungen
zwischen Landesrecht und Gewässerordnung immer beides nennen.

---

## 2. Technik

- **Statische Website** (HTML/JS, keine Build-Pipeline), gehostet über GitHub Pages
  mit eigener Domain. Die Datei `CNAME` (Inhalt `angelup.de`) **nie löschen** –
  sonst ist die Domain weg.
- **Service Worker** `sw.js`: Konstante `CACHE = 'angelup-vNN'`. Bei **jeder**
  Änderung an HTML/JS die Versionsnummer um 1 erhöhen und im Commit nennen
  („…, Cache v59“). Sonst sehen Nutzer alte Inhalte.
- **Inhalte:** `kursinhalt.js` (Lektionen, Fragen), `fische.js` (Fischdaten),
  `folien.js` (Folienbetrachter, pdf.js vom eigenen Server).
- **Backend:** Supabase (Projekt `vqjpwhqpcybpblgtjuxw`). Rollen in `profile.rolle`
  (`ausbilder`, `admin`). SQL-Änderungen als datierte Datei in `_supabase/sql/`
  ablegen, idempotent schreiben (`create … if not exists`).
- **Kurs-Codes:** Tabellen `videokurs_kurscode` und `videokurs_kurscode_einloesung`,
  Zugriff nur über Funktionen (RLS ohne Policies). Ein Code pro Kurs(termin),
  unbefristet, Einlösen in „Mein Bereich“ (`mein.html`), Verwaltung im Studio.
- **Zahlung:** Überweisung (IBAN auf `kurs.html`, `videokurs.html`, `aal.html`).
  Freischaltung nach Zahlungseingang.
- Externe Skripte/Schriften lokal hosten (Datenschutz). Neue Drittanbieter
  immer in `datenschutz.html` ergänzen.

### Änderungs-Checkliste
1. Inhalt ändern
2. `sw.js` Cache-Version +1
3. Betroffene Seiten in `sitemap.xml` prüfen
4. Bei neuen Diensten: Datenschutz anpassen
5. Commit mit klarer Beschreibung + Cache-Version

---

## 3. Typische Aufgaben

**Neuer Lehrgangstermin**
1. Termin + Preis in `kurs.html` und `kurse.html` eintragen (beide gleich halten).
2. Alte Termine ausblenden, nicht stehen lassen.
3. Werbung auf den neuen Termin umstellen (Startseite, Social Media).
4. Kurs-Code für den Termin im Studio anlegen.

**Frage im Fragenkatalog korrigieren**
- Richtige Antwort gegen den amtlichen Fragenkatalog Niedersachsen prüfen.
- In `kursinhalt.js` ändern, Cache +1, Korrektur im Commit begründen.

**Anmeldung/Teilnehmer**
- Anmelde-PDF: `Anmeldung-Angelscheinkurs-AngelUp.pdf`.
- Zahlungseingang prüfen → Zugang freischalten → Bestätigungsmail.

---

## 4. Vermarktung

- **Saison:** Nachfrage vor Saisonbeginn (Winter/Frühjahr) am höchsten. Januar-
  Lehrgang ab Herbst bewerben.
- **Zielgruppe:** Einsteiger, Eltern mit Kindern/Jugendlichen, Rückkehrer.
  Region Ostfriesland / Weser-Ems.
- **Kanäle:** Google (lokale Suche „Angelschein Aurich/Ostfriesland“),
  Instagram/Facebook, Aushang und Hinweis im Laden **Zur Kiepe**, Vereine.
- **Querverkauf:** Teilnehmer sind Neukunden für Zur Kiepe (Einsteiger-Set,
  Gutschein nach bestandener Prüfung) und später Full Run Baits.
- Gratis-Seiten (Schonzeiten, Fischbilder) sind SEO-Magneten → aktuell halten.

---

## 5. Buchhaltung & Steuer (mit Steuerberater klären)

- Impressum nennt Mark Schwarze mit USt-ID → läuft im **Einzelunternehmen SHV**.
  In `unternehmens-kontext` ist AngelUp noch nicht als Sparte geführt → Einnahmen
  getrennt als eigene Sparte/Kostenstelle „AngelUp“ buchen.
- **Prüfungsgebühr** im Paketpreis: klären, ob durchlaufender Posten (Weitergabe
  an den Verband) oder eigene Leistung.
- **Umsatzsteuer:** Unterrichtsleistungen können nach § 4 Nr. 21 UStG befreit sein,
  meist nur mit Bescheinigung. Nicht selbst entscheiden → `steuerberater`.
- Digitale Kurse an Privatkunden in anderen EU-Ländern → OSS beachten.
