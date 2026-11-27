# Minecraft-Schrift (Launcher-Einstellung „Minecraft")

Die vier TTFs in diesem Ordner sind aus den Vanilla-Assets von Minecraft: Java Edition
generiert und werden **mit dem Launcher ausgeliefert**. Dadurch sieht die Schriftart
auf jedem PC identisch aus – es ist keine Installation einer Systemschrift nötig.

| Datei | Schnitt |
|---|---|
| `MinecraftDefault-Regular.ttf` | normal |
| `MinecraftDefault-Bold.ttf` | fett |
| `MinecraftDefault-Italic.ttf` | kursiv |
| `MinecraftDefault-BoldItalic.ttf` | fett + kursiv |

Quelle: https://github.com/tryashtar/minecraft-ttf (Release `v1.6`, 2026-09-05),
generiert aus `Minecraft 26.3-pre-2`. Die Schrift basiert auf den Vanilla-Font-Assets
von Mojang; die Rechte daran liegen bei Mojang/Microsoft.

Die Dateien werden über `package.json` → `build.files` (`fonts/**/*`) in den Build
gepackt und in `styles.css` per `@font-face` geladen. Nicht entfernen, sonst fällt
die Einstellung „Minecraft“ auf `Courier New` zurück.
