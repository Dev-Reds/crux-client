package com.crux.client.gui;

import com.crux.client.CruxClient;
import com.crux.client.config.CruxConfig;
import com.crux.client.feature.Feature;
import com.crux.client.gui.widget.ColorPickerPanel;
import com.crux.client.gui.widget.CruxButton;
import com.crux.client.gui.widget.CruxSlider;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.network.chat.Component;
import net.minecraft.util.Mth;
import org.lwjgl.glfw.GLFW;
import com.mojang.blaze3d.platform.InputConstants;

import java.util.Map;

public class FeatureSettingsScreen extends Screen {

    private final Feature feature;
    private final Screen parent;
    private CruxSlider hudXSlider;
    private CruxSlider hudYSlider;
    private ColorPickerPanel textColorPicker;
    private ColorPickerPanel bgColorPicker;
    private CruxButton resetButton;
    private CruxSlider scaleSlider;

    private int scrollOffset = 0;
    private int contentHeight = 0;
    private boolean scrollDragging = false;
    private int scrollLastMouseY = 0;
    private boolean listeningForKeyBind = false;

    private static final int HEADER_H = 44;
    private static final int BOTTOM_H = 45;
    private static final int ROW_H = 26;
    private static final int SECTION_GAP = 6;

    private int panelX, panelW;

    private boolean itemPickerOpen = false;

    private static final String[][] ITEMS = {
        {"minecraft:totem_of_undying", "Totem"},
        {"minecraft:ender_pearl", "Enderperle"},
        {"minecraft:golden_apple", "Goldapfel"},
        {"minecraft:enchanted_golden_apple", "Opferapfel"},
        {"minecraft:shield", "Schild"},
        {"minecraft:bucket", "Eimer"},
        {"minecraft:water_bucket", "Wassereimer"},
        {"minecraft:lava_bucket", "Lavaeimer"},
        {"minecraft:elytra", "Elytra"},
        {"minecraft:trident", "Dreizack"},
        {"minecraft:crossbow", "Armbrust"},
        {"minecraft:bow", "Bogen"},
        {"minecraft:arrow", "Pfeil"},
        {"minecraft:spectral_arrow", "Geisterpfeil"},
        {"minecraft:firework_rocket", "Rakete"},
        {"minecraft:ender_eye", "Auge des Ender"},
        {"minecraft:compass", "Kompass"},
        {"minecraft:recovery_compass", "Wiederbringkompass"},
        {"minecraft:clock", "Uhr"},
        {"minecraft:map", "Karte"},
        {"minecraft:saddle", "Sattel"},
        {"minecraft:name_tag", "Namensschild"},
        {"minecraft:heart_of_the_sea", "Herz des Meeres"},
        {"minecraft:nether_star", "Netherstern"},
        {"minecraft:dragon_breath", "Drachenatem"},
        {"minecraft:blaze_rod", "Glutstab"},
        {"minecraft:blaze_powder", "Glutpulver"},
        {"minecraft:netherite_ingot", "Netherit-Ingot"},
        {"minecraft:diamond", "Diamant"},
        {"minecraft:emerald", "Smaragd"},
        {"minecraft:iron_ingot", "Eisenbarren"},
        {"minecraft:gold_ingot", "Goldbarren"},
        {"minecraft:copper_ingot", "Kupferbarren"},
        {"minecraft:obsidian", "Obsidian"},
        {"minecraft:crying_obsidian", "Weinender Obsidian"},
        {"minecraft:warped_fungus_on_a_stick", "Warptrank-stab"},
        {"minecraft:carrot_on_a_stick", "Karottenstab"},
        {"minecraft:experience_bottle", "Erfahrungsflasche"},
        {"minecraft:end_crystal", "Enderkristall"},
    };

    private static final int ITEM_SLOT_SIZE = 18;
    private static final int ITEMS_PER_ROW = 8;

    public FeatureSettingsScreen(Minecraft client, Feature feature, Screen parent) {
        super(Component.literal(feature.getName() + " Einstellungen"));
        this.feature = feature;
        this.parent = parent;
    }

    @Override
    protected void init() {
        panelX = this.width / 2 - 105;
        panelW = 210;

        if (feature.hasHudRenderer()) {
            hudXSlider = new CruxSlider(0, 0, 140, 0, this.width, feature.getHudX());
            hudYSlider = new CruxSlider(0, 0, 140, 0, this.height, feature.getHudY());

            textColorPicker = new ColorPickerPanel(panelX, 0, panelW,
                    feature.getHudTextColor(), c -> {
                        feature.setHudTextColor(c | 0xFF000000);
                        CruxClient.getConfig().setHudTextColor(feature.getName(), c | 0xFF000000);
                        CruxClient.syncAndSave();
                    });

            bgColorPicker = new ColorPickerPanel(panelX, 0, panelW,
                    feature.getHudBgColor(), c -> {
                        feature.setHudBgColor(c | 0xFF000000);
                        CruxClient.getConfig().setHudBgColor(feature.getName(), c | 0xFF000000);
                        CruxClient.syncAndSave();
                    });

            scaleSlider = new CruxSlider(0, 0, 140, 0.1, 3.0, feature.getHudScale()).setDecimal(0.1);
        }

        this.addRenderableWidget(new CruxButton(this.width / 2 - 110, this.height - 35, 100, 22, Component.literal("§lZurück"))
                .setColors(0xFF2A1A1A, 0xFF3A2525, 0xFFFF5555, 0xFFFF5555)
                .onClick(() -> {
                    CruxClient.syncAndSave();
                    Minecraft.getInstance().setScreen(parent);
                }));

        resetButton = new CruxButton(this.width / 2 + 10, this.height - 35, 100, 22, Component.literal("§lReset"))
                .setColors(0xFF2A2A1A, 0xFF3A3A25, 0xFFFFFF55, 0xFFFFFF55)
                .onClick(() -> {
                    feature.resetSettings();
                    if (feature.hasHudRenderer()) feature.resetHudPos();
                    CruxConfig config = CruxClient.getConfig();
                    config.getFeatureToggles().remove(feature.getName());
                    config.getFeatureSettings().remove(feature.getName());
                    config.getHudPositions().remove(feature.getName());
                    config.getHudTextColors().remove(feature.getName());
                    config.getHudBgColors().remove(feature.getName());
                    config.getKeyBinds().remove(feature.getName());
                    CruxClient.syncAndSave();
                    if (hudXSlider != null) hudXSlider.setValue(feature.getHudX());
                    if (hudYSlider != null) hudYSlider.setValue(feature.getHudY());
                    if (textColorPicker != null) textColorPicker.setSelectedColor(feature.getHudTextColor());
                    if (bgColorPicker != null) bgColorPicker.setSelectedColor(feature.getHudBgColor());
                    if (scaleSlider != null) scaleSlider.setValue(feature.getHudScale());
                });
        this.addRenderableWidget(resetButton);
    }

    @Override
    public void render(GuiGraphics g, int mouseX, int mouseY, float delta) {
        this.renderBackground(g, mouseX, mouseY, delta);

        g.fill(0, 0, this.width, HEADER_H, 0xE0101010);
        g.fill(0, HEADER_H, this.width, HEADER_H + 1, 0xFF55FF55);
        g.drawCenteredString(this.font, "§l§a" + feature.getName(), this.width / 2, 8, 0xFFFFFF);
        g.drawCenteredString(this.font, "§7" + feature.getDescription(), this.width / 2, 24, 0xFF888888);

        int contentTop = HEADER_H + 4;
        int contentBottom = this.height - BOTTOM_H;

        g.enableScissor(0, contentTop, this.width, contentBottom);

        int y = contentTop - scrollOffset;

        if (!feature.isSettingsOnly()) {
            y = renderToggle(g, mouseX, mouseY, y);
        }

        if (feature.getDefaultKeyBind() != -1) {
            y = renderKeyBindRow(g, mouseX, mouseY, y);
        }

        if (feature.hasHudRenderer()) {
            y = renderSlider(g, mouseX, mouseY, y, "Position X", hudXSlider);
            y = renderSlider(g, mouseX, mouseY, y, "Position Y", hudYSlider);
            y = renderSlider(g, mouseX, mouseY, y, "Skalierung", scaleSlider);
            y = renderToggleRow(g, mouseX, mouseY, y, "Hintergrund", feature.getHudBgColor() != 0, () -> {
                if (feature.getHudBgColor() != 0) {
                    feature.setHudBgColor(0);
                } else {
                    feature.setHudBgColor(0xC0101010);
                }
                CruxClient.getConfig().setHudBgColor(feature.getName(), feature.getHudBgColor());
                CruxClient.syncAndSave();
                if (bgColorPicker != null) bgColorPicker.setSelectedColor(feature.getHudBgColor());
            });
            y += SECTION_GAP;
            y = renderColorPicker(g, mouseX, mouseY, y, "Textfarbe", textColorPicker);
            y += SECTION_GAP;
            y = renderColorPicker(g, mouseX, mouseY, y, "Hintergrundfarbe", bgColorPicker);
        }

        Map<String, Object> settings = feature.getSettings();
        if (settings.containsKey("fov")) y = renderCycleSetting(g, mouseX, mouseY, y, "FOV", "fov", 90, 10, 30, 170);
        if (settings.containsKey("strength")) y = renderCycleSetting(g, mouseX, mouseY, y, "Stärke", "strength", 5, 1, 1, 10);
        if (settings.containsKey("delay")) y = renderCycleSetting(g, mouseX, mouseY, y, "Verzögerung", "delay", 5, 1, 1, 10, "s");
        if (settings.containsKey("interval")) y = renderCycleSetting(g, mouseX, mouseY, y, "Intervall", "interval", 60, 10, 10, 300, "s");
        if (settings.containsKey("color")) y = renderColorSetting(g, mouseX, mouseY, y, "Farbe", "color");
        if (settings.containsKey("item")) y = renderItemSelector(g, mouseX, mouseY, y);

        contentHeight = y + scrollOffset - contentTop;

        g.disableScissor();

        super.render(g, mouseX, mouseY, delta);
    }

    private int renderToggle(GuiGraphics g, int mouseX, int mouseY, int y) {
        boolean on = feature.isEnabled();
        g.fill(panelX, y, panelX + panelW, y + ROW_H, 0xFF1E1E1E);
        g.drawString(this.font, "Status", panelX + 8, y + 9, 0xFFCCCCCC, true);
        g.drawString(this.font, on ? "§aAN" : "§cAUS", panelX + panelW - 30 - this.font.width(on ? "AN" : "AUS"), y + 9,
                on ? 0xFF55FF55 : 0xFFFF5555, true);
        if (mouseX >= panelX && mouseX <= panelX + panelW && mouseY >= y && mouseY <= y + ROW_H) {
            g.fill(panelX, y, panelX + panelW, y + ROW_H, 0x30FFFFFF);
        }
        return y + ROW_H + 2;
    }

    private int renderKeyBindRow(GuiGraphics g, int mouseX, int mouseY, int y) {
        g.fill(panelX, y, panelX + panelW, y + ROW_H, 0xFF1E1E1E);
        g.drawString(this.font, "Keybind", panelX + 8, y + 9, 0xFFCCCCCC, true);
        String keyName;
        if (listeningForKeyBind) {
            keyName = "§eDrücke Taste...";
        } else if (feature.getKeyBind() != -1) {
            String raw = GLFW.glfwGetKeyName(GLFW.glfwGetKeyScancode(feature.getKeyBind()), 0);
            keyName = "§a" + (raw != null ? raw.toUpperCase() : ("KEY_" + feature.getKeyBind()));
        } else {
            keyName = "§8Kein Keybind";
        }
        String stripped = keyName.replaceAll("§[0-9a-fk-or]", "");
        g.drawString(this.font, keyName, panelX + panelW - 10 - this.font.width(stripped), y + 9, 0xFF55FF55, true);
        if (mouseX >= panelX && mouseX <= panelX + panelW && mouseY >= y && mouseY <= y + ROW_H) {
            g.fill(panelX, y, panelX + panelW, y + ROW_H, 0x30FFFFFF);
        }
        return y + ROW_H + 2;
    }

    private int renderToggleRow(GuiGraphics g, int mouseX, int mouseY, int y, String label, boolean state, Runnable onToggle) {
        g.fill(panelX, y, panelX + panelW, y + ROW_H, 0xFF1E1E1E);
        g.drawString(this.font, label, panelX + 8, y + 9, 0xFFCCCCCC, true);
        g.drawString(this.font, state ? "§aAN" : "§cAUS", panelX + panelW - 30 - this.font.width(state ? "AN" : "AUS"), y + 9,
                state ? 0xFF55FF55 : 0xFFFF5555, true);
        if (mouseX >= panelX && mouseX <= panelX + panelW && mouseY >= y && mouseY <= y + ROW_H) {
            g.fill(panelX, y, panelX + panelW, y + ROW_H, 0x30FFFFFF);
        }
        return y + ROW_H + 2;
    }

    private int renderSlider(GuiGraphics g, int mouseX, int mouseY, int y, String label, CruxSlider slider) {
        g.fill(panelX, y, panelX + panelW, y + ROW_H, 0xFF1E1E1E);
        g.drawString(this.font, label, panelX + 8, y + 2, 0xFF888888, true);
        slider.setPosition(panelX + 8, y + 12);
        slider.render(g, mouseX, mouseY);
        return y + ROW_H + 2;
    }

    private int renderColorPicker(GuiGraphics g, int mouseX, int mouseY, int y, String label, ColorPickerPanel picker) {
        int pickerH = picker.getHeight();
        g.fill(panelX, y, panelX + panelW, y + 16 + pickerH, 0xFF1E1E1E);
        g.drawString(this.font, label, panelX + 8, y + 2, 0xFF888888, true);
        picker.setPosition(panelX + 8, y + 16);
        picker.render(g, mouseX, mouseY, 0);
        return y + 16 + pickerH + 4;
    }

    private int renderCycleSetting(GuiGraphics g, int mouseX, int mouseY, int y, String label, String key, int def, int step, int min, int max) {
        return renderCycleSetting(g, mouseX, mouseY, y, label, key, def, step, min, max, "");
    }

    private int renderCycleSetting(GuiGraphics g, int mouseX, int mouseY, int y, String label, String key, int def, int step, int min, int max, String suffix) {
        int val = ((Number) feature.getSetting(key, def)).intValue();
        g.fill(panelX, y, panelX + panelW, y + ROW_H, 0xFF1E1E1E);
        g.drawString(this.font, label, panelX + 8, y + 9, 0xFFCCCCCC, true);
        String valStr = val + suffix;
        g.drawString(this.font, valStr, panelX + panelW - 10 - this.font.width(valStr), y + 9, 0xFF55FF55, true);
        if (mouseX >= panelX && mouseX <= panelX + panelW && mouseY >= y && mouseY <= y + ROW_H) {
            g.fill(panelX, y, panelX + panelW, y + ROW_H, 0x30FFFFFF);
        }
        return y + ROW_H + 2;
    }

    private int renderColorSetting(GuiGraphics g, int mouseX, int mouseY, int y, String label, String key) {
        int val = ((Number) feature.getSetting(key, 0xFFFFFF)).intValue();
        g.fill(panelX, y, panelX + panelW, y + ROW_H, 0xFF1E1E1E);
        g.drawString(this.font, label, panelX + 8, y + 9, 0xFFCCCCCC, true);
        String hex = String.format("#%06X", val & 0xFFFFFF);
        g.drawString(this.font, hex, panelX + panelW - 10 - this.font.width(hex), y + 9, 0xFF55FF55, true);
        g.fill(panelX + panelW - 20, y + 5, panelX + panelW - 8, y + ROW_H - 5, 0xFF000000 | val);
        if (mouseX >= panelX && mouseX <= panelX + panelW && mouseY >= y && mouseY <= y + ROW_H) {
            g.fill(panelX, y, panelX + panelW, y + ROW_H, 0x30FFFFFF);
        }
        return y + ROW_H + 2;
    }

    private int renderItemSelector(GuiGraphics g, int mouseX, int mouseY, int y) {
        String itemId = feature.getSetting("item", "totem_of_undying");
        String[] itemParts = itemId.split(":");
        Item currentItem = BuiltInRegistries.ITEM.get(ResourceLocation.parse(itemId)).get().value();
        String displayName = itemParts[itemParts.length - 1];

        g.fill(panelX, y, panelX + panelW, y + ROW_H, 0xFF1E1E1E);
        g.drawString(this.font, "Item", panelX + 8, y + 2, 0xFF888888, true);
        g.renderItem(new ItemStack(currentItem), panelX + 8, y + 12);
        g.drawString(this.font, displayName, panelX + 26, y + 14, 0xFF55FF55, true);
        String arrow = itemPickerOpen ? "§7▲" : "§7▼";
        g.drawString(this.font, arrow, panelX + panelW - 16, y + 14, 0xFFCCCCCC, true);
        if (mouseX >= panelX && mouseX <= panelX + panelW && mouseY >= y && mouseY <= y + ROW_H) {
            g.fill(panelX, y, panelX + panelW, y + ROW_H, 0x30FFFFFF);
        }
        y += ROW_H + 2;

        if (itemPickerOpen) {
            int rows = (int) Math.ceil((double) ITEMS.length / ITEMS_PER_ROW);
            int gridH = rows * ITEM_SLOT_SIZE;
            g.fill(panelX, y, panelX + panelW, y + gridH + 4, 0xFF1E1E1E);

            for (int i = 0; i < ITEMS.length; i++) {
                int col = i % ITEMS_PER_ROW;
                int row = i / ITEMS_PER_ROW;
                int sx = panelX + 4 + col * ITEM_SLOT_SIZE;
                int sy = y + 2 + row * ITEM_SLOT_SIZE;
                ResourceLocation regName = ResourceLocation.parse(ITEMS[i][0]);
                Item item = BuiltInRegistries.ITEM.get(regName).get().value();
                ItemStack stack = new ItemStack(item);
                boolean selected = ITEMS[i][0].equals(itemId);
                if (selected) {
                    g.fill(sx - 1, sy - 1, sx + ITEM_SLOT_SIZE - 1, sy + ITEM_SLOT_SIZE - 1, 0xFF55FF55);
                }
                g.fill(sx, sy, sx + ITEM_SLOT_SIZE - 2, sy + ITEM_SLOT_SIZE - 2, 0xFF2A2A2A);
                g.renderItem(stack, sx, sy);
                g.renderItemDecorations(this.font, stack, sx, sy);
            }
            y += gridH + 4;
        }
        return y;
    }

    private int calcHudSectionHeight() {
        if (!feature.hasHudRenderer()) return 0;
        int h = 0;
        h += (ROW_H + 2) * 2;
        h += SECTION_GAP;
        h += 16 + textColorPicker.getHeight() + 4;
        h += SECTION_GAP;
        h += 16 + bgColorPicker.getHeight() + 4;
        return h;
    }

    @Override
    public boolean mouseClicked(double mouseX, double mouseY, int button) {
        int contentTop = HEADER_H + 4;
        int contentBottom = this.height - BOTTOM_H;

        if (mouseY >= contentTop && mouseY <= contentBottom) {
            if (textColorPicker != null && textColorPicker.mouseClicked(mouseX, mouseY, button)) return true;
            if (bgColorPicker != null && bgColorPicker.mouseClicked(mouseX, mouseY, button)) return true;

            if (feature.hasHudRenderer() && hudXSlider != null && hudYSlider != null) {
                if (hudXSlider.mouseClicked(mouseX, mouseY, button)) return true;
                if (hudYSlider.mouseClicked(mouseX, mouseY, button)) return true;
                if (scaleSlider != null && scaleSlider.mouseClicked(mouseX, mouseY, button)) return true;
            }

            int y = contentTop - scrollOffset;
            if (!feature.isSettingsOnly()) {
                if (mouseX >= panelX && mouseX <= panelX + panelW && mouseY >= y && mouseY <= y + ROW_H) {
                    feature.toggle();
                    CruxClient.syncAndSave();
                    return true;
                }
                y += ROW_H + 2;
            }

            if (feature.getDefaultKeyBind() != -1) {
                if (mouseX >= panelX && mouseX <= panelX + panelW && mouseY >= y && mouseY <= y + ROW_H) {
                    listeningForKeyBind = true;
                    return true;
                }
                y += ROW_H + 2;
            }

            if (feature.hasHudRenderer()) {
                y += (ROW_H + 2) * 2;
                y += SECTION_GAP;
                y += 16 + textColorPicker.getHeight() + 4;
                y += SECTION_GAP;
                y += 16 + bgColorPicker.getHeight() + 4;
            }

            Map<String, Object> settings = feature.getSettings();
            if (handleCycleClick(mouseX, mouseY, y, "fov", settings, 90, 10, 30, 170)) return true;
            if (settings.containsKey("fov")) y += ROW_H + 2;
            if (handleCycleClick(mouseX, mouseY, y, "strength", settings, 5, 1, 1, 10)) return true;
            if (settings.containsKey("strength")) y += ROW_H + 2;
            if (handleCycleClick(mouseX, mouseY, y, "delay", settings, 5, 1, 1, 10)) return true;
            if (settings.containsKey("delay")) y += ROW_H + 2;
            if (handleCycleClick(mouseX, mouseY, y, "interval", settings, 60, 10, 10, 300)) return true;
            if (settings.containsKey("interval")) y += ROW_H + 2;
            if (handleColorClick(mouseX, mouseY, y, "color", settings)) return true;
            if (settings.containsKey("color")) y += ROW_H + 2;
            if (handleItemClick(mouseX, mouseY, y)) return true;
        }

        if (button == 0) {
            scrollDragging = true;
            scrollLastMouseY = (int) mouseY;
        }

        return super.mouseClicked(mouseX, mouseY, button);
    }

    private boolean handleCycleClick(double mouseX, double mouseY, int y, String key, Map<String, Object> settings, int def, int step, int min, int max) {
        if (!settings.containsKey(key)) return false;
        if (mouseX >= panelX && mouseX <= panelX + panelW && mouseY >= y && mouseY <= y + ROW_H) {
            int val = ((Number) feature.getSetting(key, def)).intValue();
            val += step;
            if (val >= max) val = min;
            feature.setSetting(key, val);
            CruxClient.syncAndSave();
            return true;
        }
        return false;
    }

    private boolean handleColorClick(double mouseX, double mouseY, int y, String key, Map<String, Object> settings) {
        if (!settings.containsKey(key)) return false;
        if (mouseX >= panelX && mouseX <= panelX + panelW && mouseY >= y && mouseY <= y + ROW_H) {
            int c = ((Number) feature.getSetting(key, 0xFFFFFF)).intValue();
            c = (c + 0x111111) & 0xFFFFFF;
            feature.setSetting(key, c);
            CruxClient.syncAndSave();
            return true;
        }
        return false;
    }

    private boolean handleItemClick(double mouseX, double mouseY, int y) {
        if (!feature.getSettings().containsKey("item")) return false;
        String itemId = feature.getSetting("item", "totem_of_undying");

        if (mouseX >= panelX && mouseX <= panelX + panelW && mouseY >= y && mouseY <= y + ROW_H) {
            itemPickerOpen = !itemPickerOpen;
            return true;
        }
        y += ROW_H + 2;

        if (itemPickerOpen) {
            int rows = (int) Math.ceil((double) ITEMS.length / ITEMS_PER_ROW);
            int gridH = rows * ITEM_SLOT_SIZE;
            if (mouseX >= panelX && mouseX <= panelX + panelW && mouseY >= y && mouseY <= y + gridH + 4) {
                for (int i = 0; i < ITEMS.length; i++) {
                    int col = i % ITEMS_PER_ROW;
                    int row = i / ITEMS_PER_ROW;
                    int sx = panelX + 4 + col * ITEM_SLOT_SIZE;
                    int sy = y + 2 + row * ITEM_SLOT_SIZE;
                    if (mouseX >= sx && mouseX <= sx + ITEM_SLOT_SIZE - 2 && mouseY >= sy && mouseY <= sy + ITEM_SLOT_SIZE - 2) {
                        feature.setSetting("item", ITEMS[i][0]);
                        CruxClient.syncAndSave();
                        itemPickerOpen = false;
                        return true;
                    }
                }
            }
        }
        return false;
    }

    @Override
    public boolean mouseDragged(double mouseX, double mouseY, int button, double dx, double dy) {
        if (feature.hasHudRenderer() && hudXSlider != null && hudYSlider != null) {
            if (hudXSlider.mouseDragged(mouseX, mouseY) || hudYSlider.mouseDragged(mouseX, mouseY)) {
                feature.setHudPos(hudXSlider.getIntValue(), hudYSlider.getIntValue());
                CruxClient.getConfig().setHudPosition(feature.getName(), hudXSlider.getIntValue(), hudYSlider.getIntValue());
                CruxClient.syncAndSave();
                return true;
            }
            if (scaleSlider != null && scaleSlider.mouseDragged(mouseX, mouseY)) {
                feature.setHudScale((float) scaleSlider.getValue());
                CruxClient.syncAndSave();
                return true;
            }
        }
        if (scrollDragging) {
            scrollOffset = Mth.clamp(scrollOffset + (scrollLastMouseY - (int) mouseY), 0, Math.max(0, contentHeight - (this.height - HEADER_H - BOTTOM_H)));
            scrollLastMouseY = (int) mouseY;
            return true;
        }
        return super.mouseDragged(mouseX, mouseY, button, dx, dy);
    }

    @Override
    public boolean mouseReleased(double mouseX, double mouseY, int button) {
        if (feature.hasHudRenderer() && hudXSlider != null && hudYSlider != null) {
            if (hudXSlider.mouseReleased(button) || hudYSlider.mouseReleased(button)) {
                feature.setHudPos(hudXSlider.getIntValue(), hudYSlider.getIntValue());
                CruxClient.getConfig().setHudPosition(feature.getName(), hudXSlider.getIntValue(), hudYSlider.getIntValue());
                CruxClient.syncAndSave();
            }
            if (scaleSlider != null && scaleSlider.mouseReleased(button)) {
                feature.setHudScale((float) scaleSlider.getValue());
                CruxClient.syncAndSave();
            }
        }
        scrollDragging = false;
        return super.mouseReleased(mouseX, mouseY, button);
    }

    @Override
    public boolean mouseScrolled(double mouseX, double mouseY, double scrollX, double scrollY) {
        int viewH = this.height - HEADER_H - BOTTOM_H;
        scrollOffset = Mth.clamp(scrollOffset - (int)(scrollY * 12), 0, Math.max(0, contentHeight - viewH));
        return true;
    }

    @Override
    public boolean keyPressed(int keyCode, int scanCode, int modifiers) {
        if (listeningForKeyBind) {
            listeningForKeyBind = false;
            if (keyCode == GLFW.GLFW_KEY_ESCAPE) {
                feature.setKeyBindDirect(-1);
            } else {
                feature.setKeyBindDirect(keyCode);
            }
            CruxClient.getConfig().setKeyBind(feature.getName(), feature.getKeyBind());
            CruxClient.syncAndSave();
            return true;
        }
        return super.keyPressed(keyCode, scanCode, modifiers);
    }

    @Override
    public void removed() {
        CruxClient.syncAndSave();
    }

    @Override
    public boolean shouldCloseOnEsc() { return true; }

    @Override
    public boolean isPauseScreen() { return false; }
}
