# Orbit NAS Mobil ↔ Orbit NAS (PC) – Schnittstelle v1

Die Handy-App (PWA, https://orbitnas-mobil.github.io/) spricht **direkt mit der pCloud-API**
(Token aus der rclone.conf des PCs). Alles, was nur der PC kann (FRITZ!NAS, Speicher, Internxt, rclone-Sicherung),
läuft über **verschlüsselte Dateien in pCloud**. Es gibt keinen Server.

## 1. Gemeinsamer Ordner in pCloud

`/<BasePath>/.mobil/` der pCloud-Verbindung, die im Koppeln-Dialog gewählt wird (Standard: Haupt-Cloud, falls pCloud;
sonst erste pCloud-Verbindung). Bei BasePath "OrbitNAS" also `/OrbitNAS/.mobil/`.
Darf nie als Sicherungsziel überschrieben/gelöscht werden (liegt außerhalb jedes FolderTarget, da kein Ordner ".mobil" heißt;
bitte in der Aufräum-/Versionslogik ausnehmen).

| Datei | schreibt | Inhalt |
|---|---|---|
| `status.onm` | PC | Status, Speicherplatz, Ordnerliste, versteckte Pfade, PIN-Hash |
| `index.onm` | PC | Dateiliste aller PC-Orte (Speicher, FRITZ!NAS/Ordner-Ziele, weitere Orte) |
| `auftraege/<id>.onm` | Handy | Auftrag an den PC |
| `ergebnisse/<id>.onm` | PC | Fortschritt/Ergebnis eines Auftrags |
| `abholung/<id>/<dateiname>` | PC | **unverschlüsselt**: vom PC bereitgestellte Datei (Auftrag „bereitstellen“), PC löscht nach 7 Tagen |
| `handy.onm` | Handys | gemeinsame Handy-Daten (Upload-Register, zuletzt genutzter Ordner). PC ignoriert die Datei. |

## 2. Verschlüsselung (.onm)

* Schlüssel K: 32 zufällige Bytes, einmal erzeugt beim ersten Koppeln, am PC DPAPI-geschützt (SecretVault-Key `mobile-key`).
  „Neu koppeln (alte Handys aussperren)“ erzeugt einen neuen K und schreibt alle Dateien neu.
* Datei = `"ONM1"` (4 Bytes ASCII) + Nonce (12 Bytes zufällig) + AES-256-GCM(Klartext) + Tag (16 Bytes, hinten angehängt,
  genau wie WebCrypto). Associated Data = UTF-8 des logischen Namens: `status`, `index`, `handy`, `auftrag`, `ergebnis`.
* Klartext = GZip(UTF-8-JSON), JSON camelCase, Zeiten ISO-8601 UTC (`2026-10-23T18:00:00Z`).
* .NET: `AesGcm(key, 16)`, `Encrypt(nonce, plain, cipher, tag, aad)`, Ausgabe `ONM1|nonce|cipher|tag`.
* Testvektor: `testvektor.json` in diesem Ordner (Node-WebCrypto-erzeugt). PC-Test: entschlüsseln muss `expected` ergeben.

## 3. Koppeln (QR-Code am PC)

Einstellungen → „Handy koppeln“: PIN/Passwort abfragen (falls gesetzt), dann QR-Code zeigen (2 Minuten, dann ausblenden).
QR-Inhalt (Text): `ORBITNAS1:` + Base64url(UTF-8-JSON), ohne Padding:

```json
{ "v":1, "pc":"PC", "conn":"<CloudConnection.Id>", "host":"eapi.pcloud.com",
  "token":"<access_token aus rclone.conf>", "base":"OrbitNAS", "key":"<Base64url von K>" }
```
* `host`: Feld `hostname` der rclone-Remote (`rclone config dump`), Standard `api.pcloud.com`.
* `token`: `access_token` aus dem Token-JSON der Remote (pCloud-Tokens laufen nicht ab).
* Zusätzlich „Code kopieren“ (gleicher Text) für den Fall, dass die Kamera nicht geht. Die App kann auch ein Foto/Screenshot
  des QR-Codes lesen.

## 4. status.onm (PC schreibt: beim Start, nach jedem Vorgang, mindestens stündlich solange das Programm läuft)

```json
{ "v":1, "generated":"…Z", "pc":"PC", "appVersion":"0.5.0",
  "running": { "text":"Sichere Fotos …", "progress":0.42 } ,      // oder null
  "lastBackup": { "time":"…Z", "ok":true, "message":"" },          // oder null
  "nextBackup": "…Z",                                              // oder null
  "locations": [ { "id":"storage", "name":"Speicher", "kind":"storage|cloud|disk|extra",
                   "type":"PCloud|Internxt|HetznerStorageBox|LocalFolder|", "used":123, "total":456, "free":333,
                   "online":true, "primary":false } ],
  "folders": [ { "id":"…", "name":"Fotos", "path":"Fotos", "mode":"DiskOnly|Mirrored|CloudOnly",
                 "targets":["<cloudId>"], "lastSuccess":"…Z", "lastError":null, "offloadedBytes":0, "offloadedFiles":0 } ],
  "hidden": { "<connId oder 'storage'>": ["Pfad/relativ"] },
  "pin": "pbkdf2-sha256$600000$salt$hash",   // PasswordHash oder null
  "pinIsPin": true }
```
Location-Ids: `storage` für den Speicher, CloudConnection.Id für Clouds/Festplatten, ExtraLocation.Id für weitere Orte.

## 5. index.onm (PC schreibt: nach jeder Sicherung/Auslagerung, beim Start wenn älter als 24 h, Auftrag „index“)

```json
{ "v":1, "generated":"…Z",
  "locations": [ { "id":"storage", "name":"Speicher", "kind":"storage",
                   "e": [ [parent, "name", flags, size, mtime], … ] } ] }
```
* `parent` = Index des Elternordners in `e` (−1 = oberste Ebene). Eltern stehen immer vor ihren Kindern.
* `flags`: 1 = Ordner, 2 = versteckt, 4 = ausgelagert (nur in Cloud), 8 = gesichert.
* `size` Bytes (Ordner: 0), `mtime` Unix-Sekunden.
* Inhalt: Speicher (inkl. ausgelagerter Ordner aus der Änderungsliste/Cloud-Liste), alle LocalFolder-Verbindungen
  (FRITZ!NAS) und weitere Orte. **Nicht** die pCloud selbst (die liest das Handy live). Ordner `.orbitnas`, `.mobil`,
  `.versionen` auslassen.

## 6. Aufträge (Handy → PC)

`auftraege/<id>.onm`: `{ "v":1, "id":"…", "created":"…Z", "device":"iPhone", "type":"…", "args":{…} }`

| type | args | PC macht |
|---|---|---|
| `sichern` | `{ "folderIds":[…] }` (leer = alle) | Spiegeln wie „Jetzt sichern“ |
| `auslagern` | `{ "folderId":"…" }` | wie „Auslagern“ inkl. aller Prüfungen |
| `zurueckholen` | `{ "folderId":"…" }` | wie „Zurückholen“ |
| `bereitstellen` | `{ "location":"<id>", "path":"rel/pfad.mp4" }` | Datei nach `.mobil/abholung/<id>/<name>` kopieren |
| `verstecken` | `{ "location":"<id>", "path":"…", "hidden":true }` | HiddenPaths/Verstecken setzen |
| `index` | `{}` | index.onm und status.onm neu schreiben |

* PC prüft `auftraege/` beim Start und alle 2 Minuten, solange er läuft. Ein Auftrag vom gekoppelten Handy gilt als
  Erlaubnis (der Nutzer hat am Handy bestätigt), alle Sicherheitsprüfungen bleiben aktiv. Meldung im Protokoll + Infobereich.
* Ablauf: sofort `ergebnisse/<id>.onm` mit `state:"laeuft"` schreiben, Auftrag löschen, ausführen, Ergebnis aktualisieren.
* Ergebnis: `{ "v":1, "id":"…", "state":"laeuft|fertig|fehler", "progress":0.5, "message":"…", "updated":"…Z", "pickup":"/OrbitNAS/.mobil/abholung/<id>/x.mp4" }`
* Ergebnisse älter als 7 Tage löscht der PC; `abholung/` ebenso.
* Unbekannter `type` oder `v` > 1 → `state:"fehler"`, message „Bitte Orbit NAS am PC aktualisieren.“

## 7. Was das Handy direkt in pCloud tut

Durchsuchen, Vorschau, Video, Herunterladen, Hochladen, neuer Ordner, Umbenennen, Kopieren, Verschieben, Löschen
(pCloud-Papierkorb). **Gesperrt** für direkte Änderungen ist alles unter `/<BasePath>/` (Sicherungen des PCs);
dort zeigt die App nur an bzw. schickt Aufträge. Verstecken in pCloud = Auftrag `verstecken` mit location = connId.

## 8. Ergänzungen ab PC 0.5.1 (in status.onm)

* `"pinLength": 4` – Länge der Programm-PIN (4–6).
* `"locks": [ { "location":"storage", "path":"Privat", "hash":"pbkdf2-sha256$…", "pinLength":4 } ]` – PIN pro Ort/Ordner
  (path "" = ganzer Ort; gilt für alle Unterordner). Am Handy: nur Ansicht sperren, wie am PC.
* `"favorites": [ { "location":"storage", "path":"Fotos/Urlaub", "name":"Urlaub", "isFolder":true } ]`.

---

# Schnittstelle v2 (PC 0.5.2 ↔ Mobil 2.0) – Ergänzungen, v1 bleibt gültig

Ziel: Die Handy-App ist eine 1:1-Kopie des PC-Programms (Seiten Dateien, Sicherung, Protokoll, Einstellungen).
`v` in allen Dateien bleibt **1** (nur neue Felder/Typen; unbekannte Felder ignorieren). Neu: `"schema": 2` in status.onm.

## 9.1 status.onm – neue Felder

```json
"schema": 2,
"design": { "theme": "Orbit", "accent": "#6366F1", "dark": true },      // aktuell angewandtes Design + Akzent (aufgelöst)
"backupDeviceText": "Sichert automatisch: PC · täglich um 02:00",       // wie HomeView BackupDeviceText
"device": { "name": "PC", "backsUp": true, "dailyBackupTime": "02:00", "runMode": "OnDemand|Background|Scheduled",
            "preapprove": false, "thoroughCheck": true, "storagePath": "D:\\Daten", "storageOk": true, "storageMessage": "",
            "rclone": { "installed": "1.73.1", "latest": "1.73.1" } },
"operations": [ { "id": "…", "title": "Sichern: Fotos", "status": "Läuft|Wartet|Fertig|Fehler|Abgebrochen", "tone": "Accent|Ok|Warn|Danger",
                  "step": "Übertrage …", "percent": 42.5, "bytesText": "1,2 GB von 3 GB", "speedText": "12 MB/s",
                  "etaText": "noch 3 Min.", "currentFile": "IMG_1.jpg", "message": "", "fromPhone": true } ],   // wie HomeView „Vorgänge“, max. 10
"connections": [ { "id": "<CloudConnection.Id>", "name": "pCloud", "type": "PCloud", "typeText": "pCloud",
                   "detail": "OrbitNAS", "spaceText": "812 GB von 2 TB belegt", "status": "Verbindung in Ordnung",
                   "tone": "Ok|Warn|Danger|Muted", "primary": true, "canBePrimary": true } ],
"folders[]": zusätzlich { "lastText": "Gesichert: vor 2 Std.", "canOffload": true, "isManagedInside": false }
```
`running` aus v1 darf weiter gesendet werden (App nutzt `operations`, wenn vorhanden).

## 9.2 index.onm – neues Flag

`flags` 16 = **noch nicht gesichert** (orange am PC). Damit: 8 grün (gesichert), 16 orange, 4 blau (nur Cloud), keins grau.
Index enthält wie bisher Speicher, LocalFolder-Verbindungen, weitere Orte. Andere Clouds (Internxt, Hetzner) nicht –
die liest die App per Auftrag `liste`.

## 9.3 protokoll.onm (AAD "protokoll")

`{ "v":1, "generated":"…Z", "lines": [ ["2026-10-23T19:00:00Z", "Info|Warnung|Fehler", "Bereich", "Text"], … ] }` –
letzte 500 Zeilen, neueste zuletzt. Schreiben: mit jeder status.onm, wenn sich das Protokoll geändert hat.

## 9.4 Neue Aufträge (alle mit `location` = Id wie in status.locations, Pfade relativ mit "/")

| type | args | Ergebnis |
|---|---|---|
| `liste` | `{ location, path }` | `entries: [[name, flags, size, mtime], …]` (flags wie Index) – für Orte ohne Index (Internxt …) und „Aktualisieren“ |
| `kopieren` | `{ from: { location, path }, to: { location, folder } }` | wie Einfügen nach Kopieren am PC |
| `verschieben` | `{ from: { location, path }, to: { location, folder } }` | wie Einfügen nach Ausschneiden |
| `umbenennen` | `{ location, path, name }` | |
| `loeschen` | `{ location, path }` | PC: Papierkorb; FRITZ!NAS endgültig (App fragt vorher mit diesem Hinweis) |
| `ordnerNeu` | `{ location, path, name }` | path = Elternordner |
| `favorit` | `{ location, path, name, isFolder, on }` | Favoriten-Liste des PCs (status.favorites) |
| `pinSchutz` | `{ location, path, hash, pinLength }` | hash im Format des PasswordHasher (App rechnet PBKDF2-SHA256, 600 000 Runden) |
| `pinEntfernen` | `{ location, path }` | App fragt vorher die Ordner-PIN ab |
| `ordnerHinzufuegen` | `{ path, name, mode, targets: [connId] }` | wie Dialog „Ordner hinzufügen“ |
| `ordnerBearbeiten` | `{ folderId, name, mode, targets }` | wie „Sicherung einstellen …“ (Moduswechsel löst am PC dieselben Abläufe/Prüfungen aus) |
| `ordnerEntfernen` | `{ folderId }` | „Aus Orbit NAS entfernen (löscht keine Dateien)“ |
| `verbindungTesten` | `{ connId }` | message = Status-Text |
| `hauptCloud` | `{ connId }` | |
| `einstellungen` | `{ dailyBackupTime?, runMode?, preapprove?, thoroughCheck?, backsUp? }` | nur angegebene Felder ändern |

Mehrere Elemente = mehrere Aufträge. Geschützte Fälle (gesicherte Ordner, ausgelagerte Inhalte, PIN) → `state:"fehler"`
mit verständlichem `message`, genau wie am PC. Ids: `[A-Za-z0-9_-]{1,64}` (App: 18 Hex-Zeichen).
Nach erfolgreichen Datei-/Ordner-Aufträgen bitte index.onm (betroffener Ort) und status.onm neu schreiben.
Ergebnis darf zusätzlich `"refresh": ["storage", …]` enthalten (Orte, deren Liste neu ist).

---

# Schnittstelle v3 (geplant, erst nach Dennis' „ausführen“) – alles optional

## 10.1 status.onm
* `locations[].color`: `"#RRGGBB"`, die Quellenfarbe. Jede Quelle bekommt eine eigene Farbe.
* `folderStyles`: `[ { "location", "path", "color": "#RRGGBB", "icon": "folder|star|heart|photo|music|video|doc|work|home|lock|cloud|archive" } ]`
* `ignored`: `{ "<locationId>": ["pfad"] }`. Diese Ordner sind dauerhaft ignoriert. Sie sind immer ausgeblendet, auch wenn „Versteckte zeigen“ an ist. Aufheben geht nur unter Einstellungen → „Ignorierte Ordner“.
* `locks[]`: wie bisher. Es gilt jetzt für Ordner und ganze Laufwerke (path ""), mit 4–6 Ziffern.

## 10.2 Neue Aufträge
| type | args |
|---|---|
| `ordnerStil` | `{ location, path, color, icon }` (null = Standard) |
| `ignorieren` | `{ location, path, on }` |

## 10.3 „Alle Quellen“ und Quellenpunkte
Die App fügt alle Orte zu einer Ansicht zusammen. Gleiche Einträge haben denselben relativen Pfad und dieselbe Größe; sie erscheinen nur einmal und tragen einen Punkt je Quelle. Gleichnamige Einträge, die nicht gleich sind, bekommen die Quelle hinter den Namen.
Optional im Index: Flag 32 = „liegt auf mehreren Quellen“.
