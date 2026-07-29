package com.crux.client.hud;

import com.crux.client.feature.Feature;
import com.crux.client.feature.FeatureManager;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;

public class HudRenderer {

    private static boolean suppressHud = false;

    public static void setSuppressHud(boolean suppress) { suppressHud = suppress; }

    public static void render(GuiGraphics guiGraphics, FeatureManager manager) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.player == null || mc.level == null) return;
        if (suppressHud) return;

        for (Feature feature : manager.getAll()) {
            if (feature.hasHudRenderer() && feature.isEnabled()) {
                feature.renderHud(guiGraphics);
            }
        }
    }
}
