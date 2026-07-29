package com.crux.client.feature;

import net.minecraft.network.chat.Component;

public enum FeatureCategory {
    HUD("HUD"),
    VISUAL("Visual"),
    WORLD("Welt"),
    UTILITY("Werkzeuge"),
    SOCIAL("Sozial"),
    CHAT("Chat"),
    COMBAT("Kampf"),
    MOTION("Bewegung"),
    SETTINGS("Einstellungen");

    private final String displayName;

    FeatureCategory(String displayName) {
        this.displayName = displayName;
    }

    public Component getComponent() {
        return Component.literal(displayName);
    }

    public String getDisplayName() {
        return displayName;
    }
}
