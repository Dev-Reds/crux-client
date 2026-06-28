package com.example.clientmod.config;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import net.fabricmc.loader.api.FabricLoader;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

public class ModConfig {
    public static final Path CONFIG_PATH = FabricLoader.getInstance().getConfigDir().resolve("clientmod-config.json");
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

    public static boolean showFps = true;
    public static boolean showCoords = true;

    public static void load() {
        try {
            if (Files.exists(CONFIG_PATH)) {
                final String txt = Files.readString(CONFIG_PATH);
                final ModConfigData d = GSON.fromJson(txt, ModConfigData.class);
                if (d != null) {
                    showFps = d.showFps;
                    showCoords = d.showCoords;
                }
            } else {
                save();
            }
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    public static void save() {
        try {
            Files.createDirectories(CONFIG_PATH.getParent());
            final ModConfigData d = new ModConfigData();
            d.showFps = showFps;
            d.showCoords = showCoords;
            Files.writeString(CONFIG_PATH, GSON.toJson(d));
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    private static class ModConfigData {
        public boolean showFps = true;
        public boolean showCoords = true;
    }
}
