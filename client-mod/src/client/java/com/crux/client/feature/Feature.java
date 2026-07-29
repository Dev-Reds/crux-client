package com.crux.client.feature;

import net.minecraft.client.KeyMapping;
import net.minecraft.client.gui.GuiGraphics;

import java.util.HashMap;
import java.util.Map;
import java.util.function.BiConsumer;
import java.util.function.Consumer;

public class Feature {

    private final String name;
    private final String description;
    private final FeatureCategory category;
    private boolean enabled;
    private boolean defaultEnabled = false;
    private boolean settingsOnly = false;
    private int keyBind = -1;
    private int defaultKeyBind = -1;
    private BiConsumer<GuiGraphics, Feature> hudRenderer;
    private Consumer<Feature> onToggle;
    private final Map<String, Object> settings = new HashMap<>();
    private final Map<String, Object> defaultSettings = new HashMap<>();
    private int hudX = 0;
    private int hudY = 0;
    private int defaultHudX = 0;
    private int defaultHudY = 0;
    private int hudTextColor = 0x55FF55;
    private int hudBgColor = 0;
    private int defaultHudTextColor = 0x55FF55;
    private int defaultHudBgColor = 0;
    private int hudWidth = 0;
    private int hudHeight = 0;
    private KeyMapping mappedKeyBinding = null;

    public Feature(String name, String description, FeatureCategory category) {
        this.name = name;
        this.description = description;
        this.category = category;
        this.enabled = false;
    }

    public Feature setHudRenderer(BiConsumer<GuiGraphics, Feature> renderer) {
        this.hudRenderer = renderer;
        return this;
    }

    public Feature onToggle(Consumer<Feature> callback) {
        this.onToggle = callback;
        return this;
    }

    public Feature setDefault(boolean enabled) {
        this.enabled = enabled;
        this.defaultEnabled = enabled;
        return this;
    }

    public Feature setKeyBind(int key) {
        this.keyBind = key;
        this.defaultKeyBind = key;
        return this;
    }

    public void setKeyBindDirect(int key) {
        this.keyBind = key;
    }

    public Feature setSettingsOnly(boolean v) {
        this.settingsOnly = v;
        return this;
    }
    public boolean isSettingsOnly() { return settingsOnly; }

    public Feature setSetting(String key, Object value) {
        settings.put(key, value);
        if (!defaultSettings.containsKey(key)) defaultSettings.put(key, value);
        return this;
    }

    public void resetSettings() {
        settings.clear();
        settings.putAll(defaultSettings);
        this.enabled = defaultEnabled;
    }

    public void resetHudPos() {
        this.hudX = defaultHudX;
        this.hudY = defaultHudY;
        this.hudTextColor = defaultHudTextColor;
        this.hudBgColor = defaultHudBgColor;
        this.keyBind = defaultKeyBind;
    }

    public Feature setDefaultHudPos(int x, int y) {
        this.defaultHudX = x;
        this.defaultHudY = y;
        return this;
    }

    @SuppressWarnings("unchecked")
    public <T> T getSetting(String key, T defaultValue) {
        Object val = settings.get(key);
        if (val == null) return defaultValue;
        try { return (T) val; } catch (ClassCastException e) { return defaultValue; }
    }

    public Map<String, Object> getSettings() { return settings; }

    public void toggle() {
        this.enabled = !this.enabled;
        if (onToggle != null) onToggle.accept(this);
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
        if (onToggle != null) onToggle.accept(this);
    }

    public void renderHud(GuiGraphics guiGraphics) {
        if (hudRenderer != null && enabled) {
            float scale = getHudScale();
            if (scale != 1.0f) {
                guiGraphics.pose().pushPose();
                guiGraphics.pose().translate(hudX, hudY, 0);
                guiGraphics.pose().scale(scale, scale, 1);
                guiGraphics.pose().translate(-hudX, -hudY, 0);
            }
            hudRenderer.accept(guiGraphics, this);
            if (scale != 1.0f) {
                guiGraphics.pose().popPose();
            }
        }
    }

    public Feature setHudPos(int x, int y) {
        if (defaultHudX == 0 && defaultHudY == 0) {
            defaultHudX = x;
            defaultHudY = y;
        }
        this.hudX = x;
        this.hudY = y;
        return this;
    }

    public void updateHudBounds(int x, int y, int w, int h) {
        this.hudX = x; this.hudY = y; this.hudWidth = w; this.hudHeight = h;
    }

    public boolean isMouseOver(int mouseX, int mouseY) {
        return enabled && hudWidth > 0 && mouseX >= hudX && mouseX <= hudX + hudWidth
                && mouseY >= hudY && mouseY <= hudY + hudHeight;
    }

    public String getName() { return name; }
    public String getDescription() { return description; }
    public FeatureCategory getCategory() { return category; }
    public boolean isEnabled() { return enabled; }
    public int getKeyBind() { return keyBind; }
    public int getDefaultKeyBind() { return defaultKeyBind; }
    public void setMappedKeyBinding(KeyMapping km) { this.mappedKeyBinding = km; }
    public KeyMapping getMappedKeyBinding() { return mappedKeyBinding; }
    public int getHudX() { return hudX; }
    public int getHudY() { return hudY; }
    public int getHudWidth() { return hudWidth; }
    public int getHudHeight() { return hudHeight; }
    public boolean hasHudRenderer() { return hudRenderer != null; }

    public Feature setHudTextColor(int c) {
        if (hudTextColor == defaultHudTextColor && c != 0x55FF55) defaultHudTextColor = c;
        this.hudTextColor = c;
        return this;
    }
    public int getHudTextColor() { return hudTextColor; }

    public Feature setHudBgColor(int c) {
        if (defaultHudBgColor == 0 && c != 0) defaultHudBgColor = c;
        this.hudBgColor = c;
        return this;
    }
    public int getHudBgColor() { return hudBgColor; }

    public float getHudScale() {
        Object val = settings.get("_hudScale");
        if (val instanceof Number n) return n.floatValue();
        return 1.0f;
    }

    public void setHudScale(float s) {
        setSetting("_hudScale", (double) s);
    }
}
