---
name: rechtscheck-shop-website
description: "Rechtscheck für Shopify-Shop, angelup.de und Marktplatz-Konten: Impressum, AGB, Widerruf, Datenschutz/Cookies, Preisangaben, Rabatte, Bewertungen, GPSR, VerpackG, Barrierefreiheit. Abmahnrisiken finden."
---

# Rechtscheck Shop & Website

Prüft Shopify-Shop, **angelup.de** und Marktplatz-Konten auf typische
Abmahnfallen im deutschen Online-Handel. Ergänzt `posting-compliance-check`
(einzelne Posts) und `wettbewerbs-markenschutz` (fremde Verstöße).

> **Wichtig:** Das ist eine strukturierte Prüfung, **keine Rechtsberatung**.
> Gesetze und Rechtsprechung ändern sich. Bei Zweifeln, Abmahnungen oder
> Fristen → Anwalt bzw. Rechtstexte-Dienst (z. B. Händlerbund, IT-Recht Kanzlei,
> Trusted Shops). Paragraphen und Stichtage vor Verwendung live prüfen.

---

## Ablauf

1. **Seite/Shop festlegen** (Shopify, angelup.de, eBay, Kaufland …).
2. Checkliste unten abarbeiten, jede Zeile mit ✅ / ⚠️ / ❌ bewerten.
3. Ergebnis als Tabelle: Fundstelle · Problem · Risiko (hoch/mittel/niedrig) · Lösung.
4. Hohe Risiken zuerst beheben. Bei angelup.de direkt im Repo ändern
   (Cache-Version in `sw.js` erhöhen, siehe Skill `angelup`).

---

## Checkliste

### 1. Impressum
- [ ] Von jeder Seite mit max. 2 Klicks erreichbar (Footer)
- [ ] Angaben nach § 5 DDG: Name, ladungsfähige Anschrift, E-Mail, schnelle
      Kontaktmöglichkeit, USt-ID (falls vorhanden)
- [ ] Bei redaktionellen Inhalten: Verantwortlicher nach § 18 Abs. 2 MStV
- [ ] Keine veralteten Verweise: „TMG“ ersetzt durch DDG; **OS-Plattform-Link
      entfernt** (EU-Plattform eingestellt 20.07.2025)
- [ ] Hinweis zur Verbraucherschlichtung (Teilnahme ja/nein)
- [ ] Marktplätze: eigenes Impressum je Konto hinterlegt

### 2. AGB & Widerruf
- [ ] AGB aktuell und passend zum Angebot (Ware, digitale Inhalte, Kurse/Termine)
- [ ] Widerrufsbelehrung + **Muster-Widerrufsformular**
- [ ] Ausnahmen korrekt: versiegelte/verderbliche Ware, nach Kundenwunsch
      angefertigte Ware (z. B. individuelle Boilie-Mischung)
- [ ] **Digitale Inhalte (Videokurse):** Widerrufsrecht erlischt nur, wenn Kunde
      ausdrücklich zustimmt und Kenntnis bestätigt (§ 356 Abs. 5 BGB) – Checkbox
      im Bestellprozess + Bestätigung per E-Mail
- [ ] **Termingebundene Kurse (Lehrgang):** Freizeit-Dienstleistung mit festem
      Termin → Ausnahme prüfen, Stornoregeln klar formulieren
- [ ] Seit 19.06.2026: **elektronische Widerrufsfunktion** („Widerrufsbutton“) für
      Online-Verträge – Umsetzung in Shopify/angelup prüfen

### 3. Bestellprozess
- [ ] Button-Lösung: „zahlungspflichtig bestellen“ o. ä. eindeutig
- [ ] Gesamtpreis, Versandkosten, Lieferzeit vor Bestellabschluss sichtbar
- [ ] Zahlungsarten vollständig genannt
- [ ] Bestellbestätigung mit Vertragstext/AGB/Widerruf (dauerhafter Datenträger)

### 4. Preisangaben (PAngV)
- [ ] Endpreise inkl. MwSt., Hinweis auf Versandkosten
- [ ] **Grundpreis** (pro kg/l) bei Boilies, Pellets, Dips, Futter – gut sichtbar
      in der Nähe des Preises, auch auf Marktplätzen und in Werbung mit Preis
- [ ] **Rabatte (§ 11 PAngV):** Bei „statt“-Preisen den niedrigsten Preis der
      letzten 30 Tage als Bezug angeben
- [ ] UVP nur als „UVP des Herstellers“ und nur wenn tatsächlich vorhanden

### 5. Werbeaussagen & Bewertungen
- [ ] Keine absoluten Aussagen ohne Beleg („bester Köder“, „fängt garantiert“)
- [ ] Umweltaussagen („nachhaltig“, „klimaneutral“) nur belegt und konkret
- [ ] **Bewertungen:** Angabe, ob und wie geprüft wird, dass sie von echten
      Käufern stammen (§ 5b UWG); keine gekauften/geschönten Bewertungen
- [ ] Influencer/Teamangler-Inhalte als Werbung gekennzeichnet

### 6. Datenschutz & Cookies
- [ ] Datenschutzerklärung nennt alle Dienste (Shopify, Supabase, Zahlung,
      Versand, Newsletter, Jitsi, Analytics, Pixel)
- [ ] Auftragsverarbeitungsverträge (AVV) mit Dienstleistern vorhanden
- [ ] Cookie-Banner: Einwilligung **vor** Tracking/Pixel (TDDDG), „Ablehnen“
      gleichwertig zu „Akzeptieren“
- [ ] Schriften/Skripte lokal statt von externen Servern (angelup: bereits umgesetzt)
- [ ] Newsletter: Double-Opt-in, Abmeldelink

### 7. Produkt-Pflichten
- [ ] **GPSR:** Hersteller (Name, Anschrift, Kontakt), ggf. EU-Verantwortlicher,
      Sicherheits-/Warnhinweise im Listing und auf dem Produkt
- [ ] **VerpackG:** LUCID-Registrierung + Systembeteiligung, EPR-Nummer bei
      Marktplätzen hinterlegt
- [ ] Futter-/Lockstoff-Kennzeichnung nach Skill `etiketten-verpackung`
- [ ] Batterien/Elektro (z. B. Bissanzeiger): BattG/ElektroG-Registrierung

### 8. Barrierefreiheit (BFSG, seit 28.06.2025)
- [ ] Gilt für Online-Shops an Verbraucher. **Ausnahme Kleinstunternehmen**
      (< 10 Beschäftigte **und** ≤ 2 Mio. € Umsatz/Bilanz) für Dienstleistungen –
      Status prüfen und dokumentieren
- [ ] Unabhängig davon sinnvoll: Alt-Texte, Kontraste, Tastaturbedienung

### 9. Spezial angelup.de
- [ ] Hinweis „privates Lernangebot, keine Behörde, keine Prüfungsabnahme“ auf allen Seiten
- [ ] Quellen: Fragenkatalog/Prüfungsordnung Niedersachsen korrekt benannt
- [ ] Jugendliche Teilnehmer: Anmeldung durch Erziehungsberechtigte

---

## Bei Abmahnung

1. **Nicht ignorieren, nicht vorschnell unterschreiben.** Frist notieren.
2. Keine modifizierte Unterlassungserklärung ohne Anwalt abgeben.
3. Beanstandeten Punkt sofort beheben (Screenshot vorher/nachher sichern).
4. Fall in `offene-faelle` aufnehmen.
