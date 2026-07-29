package com.crux.client.gui;

import com.crux.client.CruxClient;
import com.crux.client.config.CruxConfig;
import com.crux.client.feature.Feature;
import com.crux.client.feature.FeatureCategory;
import com.crux.client.gui.widget.CruxButton;
import com.crux.client.gui.widget.CruxScrollPanel;
import com.crux.client.gui.widget.ScrollEntry;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

import java.util.ArrayList;
import java.util.List;

public class FeatureListScreen extends Screen {

    private final FeatureCategory category;
    private final List<Feature> features;
    private final Screen parent;
    private CruxScrollPanel panel;

    public FeatureListScreen(Minecraft client, FeatureCategory category, Screen parent) {
        super(Component.literal(category.getDisplayName()));
        this.category = category;
        this.features = CruxClient.getFeatureManager().getByCategory(category);
        this.parent = parent;
    }

    @Override
    protected void init() {
        panel = new CruxScrollPanel(0, 44, this.width, this.height - 94);
        this.addRenderableWidget(panel);

        panel.setEntrySupplier(() -> {
            List<ScrollEntry> list = new ArrayList<>();
            for (Feature feature : features) {
                Feature capturedFeature = feature;
                boolean on = feature.isEnabled();
                list.add(new ScrollEntry(
                        feature.getName(),
                        on ? 0xFF55FF55 : 0xFFAAAAAA,
                        on ? "§aAN" : "§cAUS",
                        on ? 0xFF55FF55 : 0xFFAA4444,
                        () -> {
                            capturedFeature.toggle();
                            CruxClient.syncAndSave();
                            panel.rebuild();
                        },
                        () -> Minecraft.getInstance().setScreen(
                                new FeatureSettingsScreen(Minecraft.getInstance(), capturedFeature, this))
                ));
            }
            return list;
        });

        this.addRenderableWidget(new CruxButton(this.width / 2 - 50, this.height - 35, 100, 22, Component.literal("§lZurück"))
                .setColors(0xFF2A1A1A, 0xFF3A2525, 0xFFFF5555, 0xFFFF5555)
                .onClick(() -> Minecraft.getInstance().setScreen(parent)));
    }

    @Override
    public void render(GuiGraphics guiGraphics, int mouseX, int mouseY, float delta) {
        this.renderBackground(guiGraphics, mouseX, mouseY, delta);

        int centerX = this.width / 2;

        guiGraphics.fill(0, 0, this.width, 42, 0xE0101010);
        guiGraphics.fill(0, 42, this.width, 43, 0xFF55FF55);
        guiGraphics.drawCenteredString(this.font, "§l§a" + category.getDisplayName(), centerX, 8, 0xFFFFFF);
        guiGraphics.drawCenteredString(this.font, "§7Linksklick = An/Aus  |  Rechtsklick = Einstellungen", centerX, 24, 0xFF888888);

        super.render(guiGraphics, mouseX, mouseY, delta);
    }

    @Override
    public boolean shouldCloseOnEsc() { return true; }

    @Override
    public boolean isPauseScreen() { return false; }
}
