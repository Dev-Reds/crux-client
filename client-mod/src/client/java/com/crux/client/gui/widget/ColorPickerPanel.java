package com.crux.client.gui.widget;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.narration.NarrationElementOutput;
import net.minecraft.network.chat.Component;

import java.util.function.Consumer;

public class ColorPickerPanel extends AbstractWidget {

    private static final int[] PRESET_COLORS = {
        0xFF55FF55, 0xFF5555FF, 0xFFFF5555, 0xFFFFFF55,
        0xFF55FFFF, 0xFFFF55FF, 0xFFFFFFFF, 0xFFAAAAAA,
        0xFF00AA00, 0xFF0000AA, 0xFFAA0000, 0xFFAAAA00,
        0xFF00AAAA, 0xFFAA00AA, 0xFF555555, 0xFF000000,
        0xFF00FF00, 0xFF0000FF, 0xFFFF0000, 0xFFFF00FF,
        0xFF00FFFF, 0xFFFFAA00, 0xFFAAFF00, 0xFF00FFAA,
    };

    private static final int COLS = 8;
    private static final int CELL_SIZE = 14;
    private static final int GAP = 2;

    private int selectedColor;
    private Consumer<Integer> onColorSelected;

    public ColorPickerPanel(int x, int y, int width, int currentColor, Consumer<Integer> onColorSelected) {
        super(x, y, width, ((PRESET_COLORS.length + COLS - 1) / COLS) * (CELL_SIZE + GAP) + GAP, Component.empty());
        this.selectedColor = currentColor & 0xFFFFFF;
        this.onColorSelected = onColorSelected;
    }

    @Override
    public void renderWidget(GuiGraphics g, int mouseX, int mouseY, float delta) {
        int cols = Math.min(COLS, PRESET_COLORS.length);
        for (int i = 0; i < PRESET_COLORS.length; i++) {
            int col = i % cols;
            int row = i / cols;
            int cx = getX() + col * (CELL_SIZE + GAP);
            int cy = getY() + row * (CELL_SIZE + GAP);
            int color = PRESET_COLORS[i];

            boolean hover = mouseX >= cx && mouseX <= cx + CELL_SIZE && mouseY >= cy && mouseY <= cy + CELL_SIZE;
            boolean selected = (selectedColor & 0xFFFFFF) == (color & 0xFFFFFF);

            if (selected) {
                g.fill(cx - 1, cy - 1, cx + CELL_SIZE + 1, cy + CELL_SIZE + 1, 0xFFFFFFFF);
            }

            g.fill(cx, cy, cx + CELL_SIZE, cy + CELL_SIZE, 0xFF000000 | color);

            if (hover) {
                g.fill(cx, cy, cx + CELL_SIZE, cy + CELL_SIZE, 0x40FFFFFF);
            }
        }
    }

    @Override
    public boolean mouseClicked(double mouseX, double mouseY, int button) {
        if (button != 0) return false;
        int cols = Math.min(COLS, PRESET_COLORS.length);
        for (int i = 0; i < PRESET_COLORS.length; i++) {
            int col = i % cols;
            int row = i / cols;
            int cx = getX() + col * (CELL_SIZE + GAP);
            int cy = getY() + row * (CELL_SIZE + GAP);
            if (mouseX >= cx && mouseX <= cx + CELL_SIZE && mouseY >= cy && mouseY <= cy + CELL_SIZE) {
                selectedColor = PRESET_COLORS[i] & 0xFFFFFF;
                if (onColorSelected != null) onColorSelected.accept(selectedColor);
                return true;
            }
        }
        return false;
    }

    public int getSelectedColor() { return selectedColor; }
    public void setSelectedColor(int c) { this.selectedColor = c & 0xFFFFFF; }

    @Override
    protected void updateWidgetNarration(NarrationElementOutput output) {}
}
