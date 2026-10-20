# SoundDrive – Motorsound für den Tesla-Browser

Eine reine Webseite (HTML/CSS/JS, keine Abhängigkeiten, kein Server-Code), die im
Tesla-Browser einen Verbrennermotor-Sound erzeugt, der zur gefahrenen Geschwindigkeit passt.

## Wie der Sound entsteht

Es werden **keine Aufnahmen** abgespielt – der Klang wird in Echtzeit physikalisch
modelliert (AudioWorklet, 48 kHz):

- **Zündimpulse** mit echter Zündfolge und echten Zündabständen je Motor
  (Crossplane-V8 mit ungleichen Abständen pro Bank, Flatplane, V10, V12, Boxer, Wankel …)
- **Krümmer je Zylinder** als Wellenleiter mit Reflexionen – ungleich lange Krümmer
  ergeben z. B. das typische Boxer-Grollen
- **Sammler, X-/H-Rohr und zwei Endrohre** → echtes Stereo (linke/rechte Zylinderbank)
- **Schalldämpfer** mit Resonanzen und Klappe, die mit Last und Drehzahl öffnet
- Ansauggeräusch, Mechanik, **Turbo** (Pfeifen, Blow-Off, Flattern), **Kompressor-Heulen**
- **Schubknallen/Blubbern** beim Gaswegnehmen, Zündunterbrechung beim Schalten, Drehzahlbegrenzer
- Anlasser und Startvorgang mit Drehzahl-Flare
- **Subwoofer-Ebene:** Zündfrequenz sowie Halb- und Viertelordnungen, gewichtet auf den
  Bereich des Tesla-Subwoofers, plus Karosserie-Eigenmoden (~42/71 Hz), die bei passender
  Drehzahl dröhnen
- **Ausgangsstufe:** Bass-Shelf, Innenraum-Hall (Futter für Teslas Immersive Sound),
  Lautheit auf Musik-Niveau und ein Limiter ohne Vorlauf (also ohne zusätzliche Latenz)
- Virtuelles **Getriebe** mit realen Übersetzungen, Hand-, Doppelkupplungs- oder Automatik-Charakteristik,
  Zwischengas beim Runterschalten, Komfort- und Sport-Schaltprogramm

## Modi

| Modus | Wofür |
|---|---|
| **GPS-Fahrt** | Im Auto: Geschwindigkeit kommt per GPS, Last wird aus der Beschleunigung geschätzt |
| **Simulator** | Im Stand ausprobieren: Gas- und Bremspedal auf dem Bildschirm (oder Pfeiltasten am PC) |
| **Standgas** | Leerlauf, mit dem Gaspedal hochdrehen bis in den Begrenzer |

## Lokal testen (am PC)

```bash
node tools/serve.js
```

Dann <http://localhost:8080> öffnen, **START** klicken, Simulator wählen und mit ↑ Gas geben.

## Online stellen (nötig für den Tesla)

Der Tesla-Browser braucht eine **HTTPS-Adresse** (sonst gibt es kein GPS). Es reicht
ein kostenloser Static-Hoster – hochgeladen werden `index.html` sowie die Ordner `css/`
und `js/` (der Ordner `tools/` ist nur zum lokalen Testen).

**Am einfachsten – Netlify Drop (ohne Konto-Einrichtung in 1 Minute):**
1. <https://app.netlify.com/drop> öffnen
2. Den ganzen Projektordner per Drag & Drop hineinziehen
3. Du bekommst eine Adresse wie `https://irgendwas.netlify.app` – fertig.
   (Mit kostenlosem Konto bleibt die Seite dauerhaft und du kannst den Namen ändern.)

**Alternativ:** GitHub Pages oder Cloudflare Pages – Ordner als Repository hochladen,
Pages aktivieren, fertig.

## Im Tesla benutzen

1. Im Tesla den Browser öffnen und deine Adresse aufrufen (Tipp: als Favorit speichern).
2. **Motor wählen**, Modus **GPS-Fahrt**, **START** tippen.
3. Die Standortabfrage **erlauben**.
4. Der Browser muss im Vordergrund geöffnet bleiben. Lautstärke am Auto regeln.

**Hinweise**

- GPS liefert etwa einmal pro Sekunde einen Wert. Dazwischen wird hochgerechnet, und eine
  einstellbare **Vorhersage** gleicht die Eigenverzögerung des GPS-Empfängers aus. Das Tempo
  folgt so mit nur ~0,2 s Versatz; Gas geben/wegnehmen wird nach ca. 1–1,5 s erkannt. Schneller
  geht es mit GPS nicht – Tesla gibt Webseiten keinen Zugriff auf Gaspedal oder Tacho.
- Die Statuszeile zeigt GPS-Takt (Hz) und Audio-Latenz (ms) – praktisch, um im Auto zu sehen,
  was der Tesla-Browser liefert.
- Für vollen Klang im Tesla unter *Audio* „Immersive Sound“ und den Subwoofer aufdrehen.
- „GPS: Volllast ab“ in den Einstellungen bestimmt, wie stark du beschleunigen musst, damit der
  virtuelle Motor Vollgas gibt.
- Der Sound ist nur im Innenraum hörbar (Fahrzeuglautsprecher), nicht außen.
- Einstellungen und der zuletzt gewählte Motor werden im Browser gespeichert.
- Bedienung bitte nur im Stand – während der Fahrt nicht am Bildschirm herumtippen.

## Dateien

```
index.html          Seite
css/style.css       Gestaltung (für den Tesla-Touchscreen optimiert)
js/engine-dsp.js    Klangsynthese (läuft als AudioWorklet)
js/profiles.js      Motoren: Zündfolge, Krümmer, Auspuff, Getriebe, Drehzahlen
js/vehicle.js       Getriebe-Logik, GPS-Auswertung, Simulator
js/audio.js         Audio-Kette (Bass, Kompressor, Lautstärke)
js/app.js           Bedienoberfläche, Drehzahlmesser
tools/serve.js      Mini-Webserver zum lokalen Testen
```

Eigene Motoren lassen sich in `js/profiles.js` ergänzen – einfach ein Profil kopieren und
Zündfolge, Krümmerlängen, Drehzahlen und Übersetzungen anpassen.
