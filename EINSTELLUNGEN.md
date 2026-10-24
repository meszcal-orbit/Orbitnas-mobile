# Orbit NAS – gemeinsame Einstellungsdatei (v1)

Gilt ab PC 0.7.0 und Handy 3.0. Ersetzt den Abgleich über `.mobil/` (SCHNITTSTELLE.md ist damit hinfällig).
PC und Handy greifen jeweils selbst auf die Clouds zu. Abgeglichen werden nur Einstellungen.

## 1. Ort

- Die Datei liegt in der **Haupt-Cloud** unter `/.orbitnas/einstellungen.json`, ganz oben in der Cloud und nicht unter dem Basisordner.
- Haupt-Cloud ist **pCloud**. Gibt es kein pCloud, ist es die erste angemeldete Cloud in dieser Reihenfolge: `pcloud`, `onedrive`, `gdrive`, `dropbox`.
  Bei mehreren Konten desselben Anbieters zählt die Kennung (Abschnitt 3), sortiert nach Text.
- Die Datei ist Klartext-JSON in UTF-8. Sie enthält keine Passwörter und keine Anmeldedaten, PINs nur als Hash.
- Fehlt die Datei, legt sie das erste Gerät an, das etwas zu schreiben hat.

## 2. Inhalt

```json
{
  "v": 1,
  "updated": "2026-10-24T09:40:00Z",
  "device": "PC-Dennis",
  "design":          { "theme": "Orbit", "accent": "#7C5CFF", "t": "2026-10-24T09:40:00.000Z" },
  "autoLock":        { "minutes": 0, "t": "…" },
  "showHiddenButton":{ "on": true, "t": "…" },
  "appPin":          { "hash": "pbkdf2-sha256$600000$<salt b64>$<hash b64>", "length": 4, "t": "…", "del": false },
  "security":        { "question": "…", "salt": "<b64>", "hash": "<b64>", "iterations": 100000, "t": "…", "del": false },
  "sourceColors":    { "pcloud:123456": { "color": "#22C55E", "t": "…", "del": false } },
  "folderStyles":    [ { "cloud": "pcloud:123456", "path": "Fotos/Urlaub", "color": "#F59E0B", "icon": "photo", "t": "…", "del": false } ],
  "favorites":       [ { "cloud": "…", "path": "…", "name": "Urlaub", "isFolder": true, "t": "…", "del": false } ],
  "hidden":          [ { "cloud": "…", "path": "…", "t": "…", "del": false } ],
  "ignored":         [ { "cloud": "…", "path": "…", "t": "…", "del": false } ],
  "readOnly":        [ { "cloud": "…", "path": "…", "isFolder": true, "t": "…", "del": false } ],
  "locks":           [ { "cloud": "…", "path": "…", "hash": "pbkdf2-sha256$…", "pinLength": 4, "t": "…", "del": false } ]
}
```

- `t` ist die Zeit der letzten Änderung als ISO-Zeit in UTC mit Millisekunden (`2026-10-24T09:40:00.000Z`). Verglichen wird als Zeitpunkt. `del: true` bedeutet gelöscht oder ausgeschaltet. Das Feld darf fehlen und gilt dann als `false`.
- `accent: null` bedeutet die Farbe des Designs. `theme` ist ein Name aus der gemeinsamen Theme-Liste (wie am PC), unbekannte Namen ignorieren.
- `autoLock.minutes`: 0 = aus.
- `appPin`: Programm-PIN. `length` 4 bis 6 heißt PIN mit so vielen Ziffern, 0 heißt Passwort.
  - Hash: PBKDF2-SHA256 über die Eingabe als UTF-8, ohne Umformung.
  - Format: `pbkdf2-sha256$<iter>$<salt b64>$<hash b64>`, 32 Byte. Iterationen stehen im Text.
  - `del: true` heißt: keine Programm-PIN.
- `locks[].hash` hat dasselbe Format wie `appPin.hash`.
- `security` ist die Sicherheitsfrage wie bisher.
  - PBKDF2-SHA256, 32 Byte, über die Antwort mit trim, dann NFC, dann klein (invariant).
  - `salt` und `hash` in Base64.
- `icon` ist einer von `folder|star|heart|photo|music|video|doc|work|home|lock|cloud|archive`.
- `path`:
  - beginnt ab der **Wurzel der Cloud** bzw. des Ortes;
  - Trenner `/`, ohne Schrägstrich am Anfang oder Ende;
  - `""` bedeutet die Wurzel.
- Unbekannte Felder und Einträge mit unbekannter Kennung bitte **unverändert mitschreiben**, nicht weglassen.

## 3. Kennungen (`cloud`)

| Ort | Kennung | Wer kann ihn |
|---|---|---|
| pCloud | `pcloud:<userid>` (Zahl aus `userinfo`) | PC + Handy |
| OneDrive | `onedrive:<drive.id>` (klein) | PC + Handy |
| Google Drive | `gdrive:<about.user.permissionId>` | PC + Handy |
| Dropbox | `dropbox:<account_id>` | PC + Handy |
| Box | `box:<user id>` | PC |
| iCloud Drive | `icloud:<Apple-ID>` (klein) | PC |
| MEGA | `mega:<E-Mail>` (klein) | PC |
| Proton Drive | `proton:<Benutzername>` (klein) | PC |
| Internxt | `internxt:<E-Mail>` (klein) | PC |
| WebDAV / Nextcloud | `webdav:<host/pfad>` (klein, ohne https://, ohne / am Ende) | PC |
| Hetzner Storage Box | `hetzner:<benutzer>@<server>` (klein) | PC |
| Speicher am PC (FRITZ!NAS) | `lokal:speicher` | nur PC |
| Festplatte/Ordner, Laufwerke | `lokal:<id>` | nur PC |

Das Handy ignoriert `lokal:` und alle Anbieter, die es nicht kann. Diese Einträge schreibt es trotzdem unverändert mit.

## 4. Abgleich

1. Datei lesen. Fehlt sie, gilt ein leerer Inhalt.
2. Für jeden Eintrag gewinnt der größere `t`. Bei gleichem `t` gewinnt `del: true`.
   - Einzelobjekte (`design`, `autoLock`, `showHiddenButton`, `appPin`, `security`) als Ganzes.
   - Listen-Einträge über `cloud` + `path`. Der Pfad wird ohne Groß-/Kleinschreibung verglichen.
   - `sourceColors` über den Schlüssel.
3. Eigene Änderungen bekommen `t = jetzt`. Gelöschtes bleibt als `del: true` stehen und wird nach 90 Tagen entfernt.
4. Hat sich gegenüber dem Gelesenen etwas geändert, wird die ganze Datei neu geschrieben. Davor wird sie direkt noch einmal gelesen und zusammengeführt, damit nichts verloren geht.
5. Der PC liest die Datei beim Start, alle 2 Minuten und vor jedem Schreiben. Geschrieben wird gleich nach jeder Änderung.

## 5. Was nicht abgeglichen wird

- Anmeldungen und Passwörter. Jedes Gerät meldet sich selbst bei der Cloud an.
- Passwörter verschlüsselter Ordner (rclone crypt). Das Handy zeigt solche Ordner gesperrt.
- Gerätesachen: die 24 h ohne PIN, Fenstergröße, Ansicht und Sortierung, Laufwerksbuchstaben, Sicherungspläne.
