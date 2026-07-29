package com.crux.client.gui;

import com.crux.client.CruxClient;
import com.crux.client.feature.Feature;
import com.crux.client.feature.FeatureCategory;
import com.crux.client.feature.FeatureManager;
import com.crux.client.gui.widget.CruxButton;
import com.crux.client.gui.widget.CruxScrollPanel;
import com.crux.client.gui.widget.ScrollEntry;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class CruxMenuScreen extends Screen {

    private final FeatureManager manager;
    private CruxScrollPanel rightPanel;
    private CruxButton hudButton;
    private CruxButton doneButton;
    private int leftWidth;
    private int savedScrollOffset = 0;

    private static final int HEADER_H = 44;
    private static final int CAT_H = 28;
    private static final int BOTTOM_H = 45;

    private final List<CatInfo> cats = new ArrayList<>();
    private int selectedCatIndex = -1;

    private static class CatInfo {
        FeatureCategory category;
        int leftY;
        int scrollTarget;

        CatInfo(FeatureCategory cat, int leftY, int scrollTarget) {
            this.category = cat;
            this.leftY = leftY;
            this.scrollTarget = scrollTarget;
        }
    }

    public CruxMenuScreen(Minecraft client) {
        super(Component.literal("Crux Client"));
        this.manager = CruxClient.getFeatureManager();
    }

    @Override
    protected void init() {
        leftWidth = this.width * 2 / 5;
        int rightX = leftWidth + 2;
        int rightW = this.width - rightX;

        rightPanel = new CruxScrollPanel(rightX, HEADER_H, rightW, this.height - HEADER_H - BOTTOM_H);
        this.addRenderableWidget(rightPanel);

        hudButton = new CruxButton(this.width / 2 - 110, this.height - 35, 100, 22, Component.literal("§lHUD"))
                .setColors(0xFF1A2A3A, 0xFF253545, 0xFF55FFFF, 0xFF55FFFF)
                .onClick(() -> Minecraft.getInstance().setScreen(new HudConfigScreen(Minecraft.getInstance(), this)));
        this.addRenderableWidget(hudButton);

        doneButton = new CruxButton(this.width / 2 + 10, this.height - 35, 100, 22, Component.literal("§lFertig"))
                .setColors(0xFF1A3A1A, 0xFF254525, 0xFF55FF55, 0xFF55FF55)
                .onClick(() -> this.onClose());
        this.addRenderableWidget(doneButton);

        buildRightPanel();
    }

    private void buildRightPanel() {
        savedScrollOffset = rightPanel.getScrollOffset();
        rightPanel.clearEntries();
        cats.clear();
        int entryIndex = 0;

        for (FeatureCategory cat : FeatureCategory.values()) {
            List<Feature> feats = manager.getByCategory(cat);
            if (feats.isEmpty()) continue;

            int scrollTarget = entryIndex * rightPanel.getEntryHeight();
            int leftY = HEADER_H + cats.size() * CAT_H;
            cats.add(new CatInfo(cat, leftY, scrollTarget));

            int enabledCount = (int) feats.stream().filter(Feature::isEnabled).count();
            String header = cat.getDisplayName() + "  §8[" + enabledCount + "/" + feats.size() + "]";
            rightPanel.addEntry(new ScrollEntry(
                    "§l§a" + header, 0xFF55FF55, () -> null, 0, () -> {}, null
            ));
            entryIndex++;

            for (Feature feature : feats) {
                Feature capturedFeature = feature;
                if (capturedFeature.isSettingsOnly()) {
                    rightPanel.addEntry(new ScrollEntry(
                            () -> "  §7" + capturedFeature.getName(),
                            0xFF888888,
                            () -> "§8Einstellungen",
                            0xFF555555,
                            () -> Minecraft.getInstance().setScreen(
                                    new FeatureSettingsScreen(Minecraft.getInstance(), capturedFeature, this)),
                            null
                    ));
                } else {
                    rightPanel.addEntry(new ScrollEntry(
                            () -> "  " + capturedFeature.getName(),
                            capturedFeature.isEnabled() ? 0xFF55FF55 : 0xFFAAAAAA,
                            () -> capturedFeature.isEnabled() ? "§aAN" : "§cAUS",
                            capturedFeature.isEnabled() ? 0xFF55FF55 : 0xFFAA4444,
                            () -> {
                                capturedFeature.toggle();
                                CruxClient.syncAndSave();
                                buildRightPanel();
                            },
                            () -> Minecraft.getInstance().setScreen(
                                    new FeatureSettingsScreen(Minecraft.getInstance(), capturedFeature, this))
                    ));
                }
                entryIndex++;
            }
        }

        rightPanel.scrollTo(savedScrollOffset);
    }

    private int getHoveredCat(int mouseX, int mouseY) {
        if (mouseX < 0 || mouseX >= leftWidth) return -1;
        for (int i = 0; i < cats.size(); i++) {
            CatInfo c = cats.get(i);
            if (mouseY >= c.leftY && mouseY < c.leftY + CAT_H) return i;
        }
        return -1;
    }

    private int getSelectedCatIndex() {
        int scrollY = rightPanel.getScrollOffset();
        for (int i = cats.size() - 1; i >= 0; i--) {
            if (scrollY >= cats.get(i).scrollTarget - 2) return i;
        }
        return 0;
    }

    @Override
    public void render(GuiGraphics g, int mouseX, int mouseY, float delta) {
        this.renderBackground(g, mouseX, mouseY, delta);
        int centerX = this.width / 2;

        g.fill(0, 0, this.width, HEADER_H, 0xE0101010);
        g.fill(0, HEADER_H, this.width, HEADER_H + 1, 0xFF55FF55);
        g.drawCenteredString(this.font, "§l§aCrux Client", centerX, 8, 0xFFFFFF);
        g.drawCenteredString(this.font, "§7v1.0.0  |  Kategorie auswählen", centerX, 24, 0xFF888888);

        g.fill(0, HEADER_H, leftWidth, this.height - BOTTOM_H, 0xC0101010);
        g.fill(leftWidth, HEADER_H, leftWidth + 1, this.height - BOTTOM_H, 0xFF444444);

        int hoverCat = getHoveredCat(mouseX, mouseY);
        int selectedIdx = getSelectedCatIndex();
        selectedCatIndex = selectedIdx;

        for (int i = 0; i < cats.size(); i++) {
            CatInfo c = cats.get(i);
            if (c.leftY + CAT_H < HEADER_H || c.leftY > this.height - BOTTOM_H) continue;

            boolean hover = (i == hoverCat);
            boolean selected = (i == selectedIdx);

            int bg;
            if (selected) bg = 0xFF1A3A1A;
            else if (hover) bg = 0xFF252530;
            else bg = 0xFF151515;

            g.fill(3, c.leftY + 1, leftWidth - 3, c.leftY + CAT_H - 1, bg);

            if (selected) {
                g.fill(leftWidth - 3, c.leftY + 1, leftWidth, c.leftY + CAT_H - 1, 0xFF55FF55);
            }

            List<Feature> feats = manager.getByCategory(c.category);
            int enabledCount = (int) feats.stream().filter(Feature::isEnabled).count();
            String label = c.category.getDisplayName();
            String count = "§8[" + enabledCount + "/" + feats.size() + "]";

            int textColor = selected ? 0xFF55FF55 : (hover ? 0xFF88FF88 : 0xFFAAAAAA);
            g.drawString(this.font, label, 10, c.leftY + (CAT_H - 8) / 2, textColor, true);

            int countX = leftWidth - 6 - this.font.width(count);
            g.drawString(this.font, count, countX, c.leftY + (CAT_H - 8) / 2, 0xFF666666, true);
        }

        super.render(g, mouseX, mouseY, delta);
    }

    @Override
    public boolean mouseClicked(double mouseX, double mouseY, int button) {
        if (mouseX < leftWidth && mouseY >= HEADER_H && mouseY < this.height - BOTTOM_H) {
            int catIdx = getHoveredCat((int) mouseX, (int) mouseY);
            if (catIdx >= 0 && catIdx < cats.size()) {
                rightPanel.scrollTo(cats.get(catIdx).scrollTarget);
                return true;
            }
        }
        return super.mouseClicked(mouseX, mouseY, button);
    }

    @Override
    public boolean shouldCloseOnEsc() { return true; }

    @Override
    public boolean isPauseScreen() { return false; }

    @Override
    public void removed() {
        if (rightPanel != null) {
            savedScrollOffset = rightPanel.getScrollOffset();
        }
    }
}
