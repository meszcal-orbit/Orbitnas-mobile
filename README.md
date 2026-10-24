# Orbit NAS Mobil

Die iPhone- und iPad-App zu **Orbit NAS**. Ab Version 3.0 eigenständig: Sie greift selbst auf die Clouds zu
(pCloud, OneDrive, Google Drive, Dropbox) und sieht aus wie die App „Dateien“ von Apple. Sie läuft als Web-App
aus Safari („Zum Home-Bildschirm“) – ohne App Store, ohne Werbung, ohne eigenen Server.

* Adresse: https://orbitnas-mobil.github.io/ (die alte Adresse https://meszcal-orbit.github.io/Orbitnas-mobile/ zeigt einen Umzugshinweis)
* Anmeldungen bleiben verschlüsselt auf dem Gerät. Mit dem PC werden nur Einstellungen abgeglichen:
  `/.orbitnas/einstellungen.json` in der Haupt-Cloud, Format in [EINSTELLUNGEN.md](EINSTELLUNGEN.md).
* FRITZ!NAS: Web-Apps dürfen nicht ins Heimnetz (SMB). Die App führt durch das Einbinden in „Dateien“ und nutzt dann die Dateiauswahl und das Teilen-Menü von iOS.

## Aufbau

Jede Quelle ist ein eigener Baustein in `js/sources/` mit denselben Funktionen (siehe Kommentar in `base.js`):
`pcloud.js`, `onedrive.js`, `gdrive.js`, `dropbox.js`, `demo.js`; Anmeldung über `oauth.js`, Liste der Quellen in `registry.js`.
Die Oberfläche (`files.js`, `settings.js`, `addcloud.js`, `fritz.js`, `picker.js`, `player.js`) kennt nur diese Bausteine.
So lässt sich später eine native App (App Store) mit denselben Bausteinen bauen.

Vor jeder Veröffentlichung `python3 tools/stamp.py` ausführen (trägt die Dateiliste für den Offline-Modus ein).
