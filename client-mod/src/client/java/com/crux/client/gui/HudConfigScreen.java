package com.crux.client.gui;

import com.crux.client.CruxClient;
import com.crux.client.config.CruxConfig;
import com.crux.client.feature.Feature;
import com.crux.client.feature.FeatureCategory;
import com.crux.client.feature.FeatureManager;
import com.crux.client.gui.widget.CruxButton;
import com.crux.client.hud.HudRenderer;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;
import net.minecraft.util.Mth;

import java.util.ArrayList;
import java.util.List;

public class HudConfigScreen extends Screen {

    private final Screen parent;
    private final FeatureManager manager;
    private final List<Feature> hudFeatures = new ArrayList<>();

    private Feature dragging = null;
    private int dragOffsetX = 0;
    private int dragOffsetY = 0;

    public HudConfigScreen(Minecraft client, Screen parent) {
        super(Component.literal("HUD Konfiguration"));
        this.manager = CruxClient.getFeatureManager();
        this.parent = parent;
    }

    @Override
    protected void init() {
        HudRenderer.setSuppressHud(true);
        hudFeatures.clear();
        for (Feature f : manager.getByCategory(FeatureCategory.HUD)) {
            if (f.hasHudRenderer() && f.isEnabled()) hudFeatures.add(f);
        }

        this.addRenderableWidget(new CruxButton(this.width - 110, 4, 100, 22, Component.literal("§lZurück"))
                .setColors(0xFF2A1A1A, 0xFF3A2525, 0xFFFF5555, 0xFFFF5555)
                .onClick(() -> {
                    CruxClient.syncAndSave();
                    Minecraft.getInstance().setScreen(parent);
                }));
    }

    @Override
    public void render(GuiGraphics g, int mouseX, int mouseY, float delta) {
        this.renderBackground(g, mouseX, mouseY, delta);

        for (Feature f : hudFeatures) {
            renderHudElement(g, f, mouseX, mouseY);
        }

        super.render(g, mouseX, mouseY, delta);
    }

    private void renderHudElement(GuiGraphics g, Feature f, int mouseX, int mouseY) {
        int x = f.getHudX();
        int y = f.getHudY();
        int w = Math.max(f.getHudWidth(), 40);
        int h = Math.max(f.getHudHeight(), 12);

        boolean hover = mouseX >= x && mouseX <= x + w && mouseY >= y && mouseY <= y + h;

        if (dragging == f) {
            g.fill(x - 2, y - 2, x + w + 2, y + h + 2, 0x6055FFFF);
        } else if (hover) {
            g.fill(x - 2, y - 2, x + w + 2, y + h + 2, 0x4055FF55);
        }

        if (f.isEnabled()) {
            int bgColor = f.getHudBgColor();
            if (bgColor != 0) {
                g.fill(x - 2, y - 1, x + w + 2, y + h + 1, bgColor);
            }
            g.drawString(this.font, f.getName(), x, y, f.getHudTextColor(), true);
        } else {
            g.drawString(this.font, "§8" + f.getName(), x, y, 0xFF555555, true);
        }
    }

    @Override
    public boolean mouseClicked(double mouseX, double mouseY, int button) {
        if (button == 0) {
            for (int i = hudFeatures.size() - 1; i >= 0; i--) {
                Feature f = hudFeatures.get(i);
                if (f.isMouseOver((int) mouseX, (int) mouseY)) {
                    dragging = f;
                    dragOffsetX = (int) mouseX - f.getHudX();
                    dragOffsetY = (int) mouseY - f.getHudY();
                    return true;
                }
            }
        }
        if (button == 1) {
            for (int i = hudFeatures.size() - 1; i >= 0; i--) {
                Feature f = hudFeatures.get(i);
                if (f.isMouseOver((int) mouseX, (int) mouseY)) {
                    Minecraft.getInstance().setScreen(
                            new FeatureSettingsScreen(Minecraft.getInstance(), f, this));
                    return true;
                }
            }
        }
        return super.mouseClicked(mouseX, mouseY, button);
    }

    @Override
    public boolean mouseDragged(double mouseX, double mouseY, int button, double dx, double dy) {
        if (dragging != null) {
            int newX = Mth.clamp((int) mouseX - dragOffsetX, 0, this.width - dragging.getHudWidth());
            int newY = Mth.clamp((int) mouseY - dragOffsetY, 0, this.height - dragging.getHudHeight());
            dragging.setHudPos(newX, newY);
            return true;
        }
        return super.mouseDragged(mouseX, mouseY, button, dx, dy);
    }

    @Override
    public boolean mouseReleased(double mouseX, double mouseY, int button) {
        if (dragging != null) {
            CruxConfig config = CruxClient.getConfig();
            config.setHudPosition(dragging.getName(), dragging.getHudX(), dragging.getHudY());
            CruxClient.syncAndSave();
            dragging = null;
            return true;
        }
        return super.mouseReleased(mouseX, mouseY, button);
    }

    @Override
    public boolean shouldCloseOnEsc() { return true; }

    @Override
    public boolean isPauseScreen() { return false; }

    @Override
    public void removed() {
        HudRenderer.setSuppressHud(false);
    }
}
