# Orbit NAS Mobil ↔ Orbit NAS (PC) – Schnittstelle v1

Die Handy-App (PWA, https://meszcal-orbit.github.io/Orbitnas-mobile/) spricht **direkt mit der pCloud-API**
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
