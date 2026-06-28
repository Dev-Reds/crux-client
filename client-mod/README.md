Client Mod (simple)

This is a minimal Fabric client-side mod that opens an in-game menu via a keybind (Right Shift by default).

What it contains:
- `src/main/java/com/example/clientmod/ClientMod.java` — mod initializer + keybind
- `src/main/java/com/example/clientmod/ClientMenuScreen.java` — simple menu screen with buttons
- `src/main/resources/fabric.mod.json` — mod metadata

Notes / How to build

This project is a minimal source layout. To build it you should create a Fabric Loom Gradle project (or copy these sources into an existing Fabric workspace).

Quick steps (recommended: use Fabric example mod as a base):

1. Create a Fabric Loom project or use the official example mod setup: https://fabricmc.net/wiki/tutorial:setup
2. Copy the `com.example.clientmod` package into `src/main/java` and `fabric.mod.json` into `src/main/resources`.
3. Add the Fabric API dependency to your `build.gradle` and set `minecraft` to the target version (e.g. `1.20.2`).
4. Build with Gradle: (from project root)

```bash
./gradlew build
```

The built jar will be in `build/libs/` and can be placed into your Minecraft `mods/` folder.

Customization

- Change the keybind in `ClientMod.java` (GLFW key code).
- Implement actual features in the menu button callbacks.

If you want, I can scaffold a full `build.gradle` and `gradle.properties` with Loom configuration for a specific Minecraft version; tell me which target MC version (e.g. `1.20.2` or `1.19.4`) and I'll add the build files and instructions.
