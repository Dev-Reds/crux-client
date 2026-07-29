package com.crux.client.gui.widget;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.AbstractButton;
import net.minecraft.client.gui.narration.NarrationElementOutput;
import net.minecraft.network.chat.Component;

public class CruxButton extends AbstractButton {

    private int bgColor = 0xFF2A2A2A;
    private int bgHover = 0xFF3A3A3A;
    private int borderColor = 0xFF55FF55;
    private int textColor = 0xFFE0E0EE;
    private int bgColorOff = 0xFF2A2A2A;
    private int borderOff = 0xFF555555;
    private Runnable onClickAction;
    private boolean toggled = false;

    public CruxButton(int x, int y, int width, int height, Component message) {
        super(x, y, width, height, message);
        this.onClickAction = () -> {};
    }

    public CruxButton onClick(Runnable action) {
        this.onClickAction = action;
        return this;
    }

    public CruxButton setColors(int bg, int bgHover, int border, int text) {
        this.bgColor = bg;
        this.bgHover = bgHover;
        this.borderColor = border;
        this.textColor = text;
        return this;
    }

    public CruxButton setToggleStyle(int bgOff, int borderOff) {
        this.bgColorOff = bgOff;
        this.borderOff = borderOff;
        return this;
    }

    public CruxButton setToggled(boolean t) {
        this.toggled = t;
        return this;
    }

    public boolean isToggled() { return toggled; }

    @Override
    public void onPress() { onClickAction.run(); }

    @Override
    public void renderWidget(GuiGraphics guiGraphics, int mouseX, int mouseY, float delta) {
        Minecraft mc = Minecraft.getInstance();
        int x = getX(), y = getY(), w = getWidth(), h = getHeight();
        boolean hover = mouseX >= x && mouseX <= x + w && mouseY >= y && mouseY <= y + h;

        int bg = toggled ? bgColor : (hover ? bgHover : bgColorOff);
        int border = toggled ? borderColor : borderOff;
        int fg = toggled ? 0xFF55FF55 : textColor;

        guiGraphics.fill(x + 1, y + 1, x + w + 1, y + h + 1, 0x40000000);
        guiGraphics.fill(x, y, x + w, y + h, bg);
        guiGraphics.fill(x, y, x + w, y + 1, border);
        guiGraphics.fill(x, y + h - 1, x + w, y + h, border);
        guiGraphics.fill(x, y, x + 1, y + h, border);
        guiGraphics.fill(x + w - 1, y, x + w, y + h, border);

        String text = this.getMessage().getString();
        int tw = mc.font.width(text);
        guiGraphics.drawString(mc.font, text, x + (w - tw) / 2, y + (h - 8) / 2, fg, true);
    }

    @Override
    protected void updateWidgetNarration(NarrationElementOutput output) {}
}
