package com.crux.client.gui.widget;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;

public class CruxSlider {

    private int x, y, width;
    private double min, max, value;
    private boolean dragging = false;
    private boolean decimalMode = false;
    private double step = 1.0;

    public CruxSlider(int x, int y, int width, double min, double max, double value) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.min = min;
        this.max = max;
        this.value = Math.max(min, Math.min(max, value));
    }

    public CruxSlider setDecimal(double step) {
        this.decimalMode = true;
        this.step = step;
        return this;
    }

    public void setPosition(int x, int y) {
        this.x = x;
        this.y = y;
    }

    public void render(GuiGraphics g, int mouseX, int mouseY) {
        int barY = y + 4;
        int barH = 8;
        boolean hover = mouseX >= x && mouseX <= x + width && mouseY >= barY && mouseY <= barY + barH;

        g.fill(x, barY, x + width, barY + barH, hover ? 0xFF3A3A3A : 0xFF252525);

        double ratio = (value - min) / (max - min);
        int fillW = (int)(ratio * width);
        g.fill(x, barY, x + fillW, barY + barH, 0xFF55FF55);

        int thumbX = x + fillW - 2;
        int thumbColor = dragging ? 0xFF88FF88 : 0xFF55FF55;
        g.fill(thumbX, barY - 2, thumbX + 4, barY + barH + 2, thumbColor);

        String valStr = decimalMode ? String.format("%.1f", value) : String.valueOf((int) value);
        Minecraft mc = Minecraft.getInstance();
        g.drawString(mc.font, valStr, x + width + 5, barY - 1, 0xFFAAAAAA, true);
    }

    public boolean mouseClicked(double mouseX, double mouseY, int button) {
        if (button == 0 && mouseX >= x && mouseX <= x + width && mouseY >= y && mouseY <= y + 16) {
            dragging = true;
            updateValue(mouseX);
            return true;
        }
        return false;
    }

    public boolean mouseDragged(double mouseX, double mouseY) {
        if (dragging) {
            updateValue(mouseX);
            return true;
        }
        return false;
    }

    public boolean mouseReleased(int button) {
        if (button == 0 && dragging) {
            dragging = false;
            return true;
        }
        return false;
    }

    private void updateValue(double mouseX) {
        double ratio = Math.max(0, Math.min(1, (mouseX - x) / (double) width));
        double raw = min + ratio * (max - min);
        if (decimalMode) {
            value = Math.round(raw * 10.0) / 10.0;
        } else {
            value = Math.round(raw);
        }
    }

    public double getValue() { return value; }
    public int getIntValue() { return (int) value; }
    public void setValue(double v) { this.value = Math.max(min, Math.min(max, v)); }
    public boolean isDragging() { return dragging; }
}
