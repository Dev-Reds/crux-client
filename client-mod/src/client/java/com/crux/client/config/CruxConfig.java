package com.crux.client.config;

import com.google.gson.*;
import com.crux.client.CruxClient;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;

public class CruxConfig {

    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
    private static final Path CONFIG_DIR = Path.of("config");
    private static final Path CONFIG_FILE = CONFIG_DIR.resolve("cruxclient.json");

    private int hudColor = 0x55FF55;
    private int hudAlpha = 200;
    private double zoomMultiplier = 4.0;
    private boolean hudShadow = true;
    private int hudScale = 1;
    private Map<String, Boolean> featureToggles = new HashMap<>();
    private Map<String, Map<String, Object>> featureSettings = new HashMap<>();
    private Map<String, int[]> hudPositions = new HashMap<>();
    private Map<String, Integer> hudTextColors = new HashMap<>();
    private Map<String, Integer> hudBgColors = new HashMap<>();
    private Map<String, Integer> keyBinds = new HashMap<>();

    public static CruxConfig load() {
        try {
            if (Files.exists(CONFIG_FILE)) {
                String json = Files.readString(CONFIG_FILE);
                CruxConfig config = GSON.fromJson(json, CruxConfig.class);
                if (config == null) config = new CruxConfig();
                if (config.featureToggles == null) config.featureToggles = new HashMap<>();
                if (config.featureSettings == null) config.featureSettings = new HashMap<>();
                if (config.hudPositions == null) config.hudPositions = new HashMap<>();
                if (config.hudTextColors == null) config.hudTextColors = new HashMap<>();
                if (config.hudBgColors == null) config.hudBgColors = new HashMap<>();
                if (config.keyBinds == null) config.keyBinds = new HashMap<>();
                return config;
            }
        } catch (Exception e) {
            CruxClient.LOGGER.error("Failed to load config", e);
        }
        return new CruxConfig();
    }

    public void save() {
        try {
            Files.createDirectories(CONFIG_DIR);
            Files.writeString(CONFIG_FILE, GSON.toJson(this));
        } catch (IOException e) {
            CruxClient.LOGGER.error("Failed to save config", e);
        }
    }

    public int getHudColor() { return hudColor; }
    public void setHudColor(int c) { this.hudColor = c; }
    public int getHudAlpha() { return hudAlpha; }
    public void setHudAlpha(int a) { this.hudAlpha = a; }
    public double getZoomMultiplier() { return zoomMultiplier; }
    public void setZoomMultiplier(double z) { this.zoomMultiplier = z; }
    public boolean isHudShadow() { return hudShadow; }
    public void setHudShadow(boolean s) { this.hudShadow = s; }
    public int getHudScale() { return hudScale; }
    public void setHudScale(int s) { this.hudScale = Math.max(1, Math.min(4, s)); }

    public Map<String, Boolean> getFeatureToggles() { return featureToggles; }
    public void setFeatureToggles(Map<String, Boolean> t) { this.featureToggles = t; }
    public Map<String, Map<String, Object>> getFeatureSettings() { return featureSettings; }
    public void setFeatureSettings(Map<String, Map<String, Object>> s) { this.featureSettings = s; }

    public int[] getHudPosition(String name) { return hudPositions.get(name); }
    public void setHudPosition(String name, int x, int y) { hudPositions.put(name, new int[]{x, y}); }
    public Map<String, int[]> getHudPositions() { return hudPositions; }

    public int getHudTextColor(String name) { return hudTextColors.getOrDefault(name, 0x55FF55); }
    public void setHudTextColor(String name, int color) { hudTextColors.put(name, color); }
    public Map<String, Integer> getHudTextColors() { return hudTextColors; }

    public int getHudBgColor(String name) { return hudBgColors.getOrDefault(name, 0); }
    public void setHudBgColor(String name, int color) { hudBgColors.put(name, color); }
    public Map<String, Integer> getHudBgColors() { return hudBgColors; }

    public int getKeyBind(String name) { return keyBinds.getOrDefault(name, -1); }
    public void setKeyBind(String name, int key) { keyBinds.put(name, key); }
    public Map<String, Integer> getKeyBinds() { return keyBinds; }
}
