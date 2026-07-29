package com.crux.client.gui.widget;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.narration.NarrationElementOutput;
import net.minecraft.network.chat.Component;
import net.minecraft.util.Mth;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Supplier;

public class CruxScrollPanel extends AbstractWidget {

    private List<ScrollEntry> entries = new ArrayList<>();
    private int scrollOffset = 0;
    private int maxScroll = 0;
    private boolean dragging = false;
    private int lastMouseY = 0;
    private Supplier<List<ScrollEntry>> entrySupplier;

    private static final int SCROLL_SPEED = 12;
    private static final int ENTRY_HEIGHT = 24;
    private static final int SCROLLBAR_WIDTH = 4;

    public CruxScrollPanel(int x, int y, int width, int height) {
        super(x, y, width, height, Component.empty());
    }

    public void setEntrySupplier(Supplier<List<ScrollEntry>> supplier) {
        this.entrySupplier = supplier;
        rebuild();
    }

    public void rebuild() {
        if (entrySupplier != null) {
            this.entries = entrySupplier.get();
        }
        recalcMaxScroll();
        if (scrollOffset > maxScroll) scrollOffset = maxScroll;
    }

    public void addEntry(ScrollEntry entry) {
        entries.add(entry);
        recalcMaxScroll();
    }

    public void clearEntries() {
        entries.clear();
        scrollOffset = 0;
        maxScroll = 0;
    }

    public void resetScroll() {
        scrollOffset = 0;
    }

    public void scrollTo(int target) {
        scrollOffset = Mth.clamp(target, 0, maxScroll);
    }

    public int getScrollOffset() { return scrollOffset; }
    public int getContentHeight() { return entries.size() * ENTRY_HEIGHT; }
    public int getEntryHeight() { return ENTRY_HEIGHT; }

    private void recalcMaxScroll() {
        maxScroll = Math.max(0, entries.size() * ENTRY_HEIGHT - getHeight());
    }

    @Override
    public void renderWidget(GuiGraphics guiGraphics, int mouseX, int mouseY, float delta) {
        Minecraft mc = Minecraft.getInstance();
        int x = getX(), y = getY(), w = getWidth(), h = getHeight();

        guiGraphics.enableScissor(x, y, x + w, y + h);

        guiGraphics.fill(x, y, x + w, y + h, 0xD0101010);
        int border = 0xFF444444;
        guiGraphics.fill(x, y, x + w, y + 1, border);
        guiGraphics.fill(x, y + h - 1, x + w, y + h, border);
        guiGraphics.fill(x, y, x + 1, y + h, border);
        guiGraphics.fill(x + w - 1, y, x + w, y + h, border);

        int startY = y - scrollOffset;
        for (int i = 0; i < entries.size(); i++) {
            int entryY = startY + i * ENTRY_HEIGHT;
            if (entryY + ENTRY_HEIGHT < y || entryY > y + h) continue;

            ScrollEntry entry = entries.get(i);
            boolean hover = mouseX >= x + 2 && mouseX <= x + w - SCROLLBAR_WIDTH - 4
                    && mouseY >= entryY && mouseY <= entryY + ENTRY_HEIGHT;

            guiGraphics.fill(x + 2, entryY + 1, x + w - SCROLLBAR_WIDTH - 4, entryY + ENTRY_HEIGHT - 1,
                    hover ? 0xFF353535 : 0xFF1E1E1E);

            if (i > 0) {
                guiGraphics.fill(x + 8, entryY, x + w - SCROLLBAR_WIDTH - 10, entryY + 1, 0xFF333333);
            }

            String textStr = entry.text().get();
            guiGraphics.drawString(mc.font, textStr, x + 10,
                    entryY + (ENTRY_HEIGHT - 8) / 2, entry.color(), true);

            String indStr = entry.indicator().get();
            if (indStr != null) {
                int indX = x + w - SCROLLBAR_WIDTH - 10 - mc.font.width(indStr);
                guiGraphics.drawString(mc.font, indStr, indX,
                        entryY + (ENTRY_HEIGHT - 8) / 2, entry.indicatorColor(), true);
            }
        }

        guiGraphics.disableScissor();

        if (maxScroll > 0) {
            int sbH = h - 4;
            int thumbH = Math.max(20, (int)((float)h / (h + maxScroll) * sbH));
            int thumbY = y + 2 + (int)((float)scrollOffset / maxScroll * (sbH - thumbH));
            guiGraphics.fill(x + w - SCROLLBAR_WIDTH - 1, y + 2, x + w - 1, y + h - 2, 0xFF222222);
            guiGraphics.fill(x + w - SCROLLBAR_WIDTH - 1, thumbY, x + w - 1, thumbY + thumbH, 0xFF666666);
        }
    }

    @Override
    public boolean mouseClicked(double mouseX, double mouseY, int button) {
        if (!isHovered) return false;
        int idx = getEntryAt((int) mouseY);
        if (idx >= 0 && idx < entries.size()) {
            ScrollEntry e = entries.get(idx);
            if (button == 0 && e.onClick() != null) { e.onClick().run(); return true; }
            if (button == 1 && e.onRightClick() != null) { e.onRightClick().run(); return true; }
        }
        dragging = true;
        lastMouseY = (int) mouseY;
        return false;
    }

    @Override
    public boolean mouseReleased(double mouseX, double mouseY, int button) {
        dragging = false;
        return false;
    }

    @Override
    public boolean mouseDragged(double mouseX, double mouseY, int button, double dx, double dy) {
        if (dragging) {
            scrollOffset = Mth.clamp(scrollOffset + (lastMouseY - (int) mouseY), 0, maxScroll);
            lastMouseY = (int) mouseY;
            return true;
        }
        return false;
    }

    @Override
    public boolean mouseScrolled(double mouseX, double mouseY, double scrollX, double scrollY) {
        scrollOffset = Mth.clamp(scrollOffset - (int)(scrollY * SCROLL_SPEED), 0, maxScroll);
        return true;
    }

    private int getEntryAt(int mouseY) {
        int entryY = getY() - scrollOffset;
        for (int i = 0; i < entries.size(); i++) {
            if (mouseY >= entryY + i * ENTRY_HEIGHT && mouseY < entryY + (i + 1) * ENTRY_HEIGHT) return i;
        }
        return -1;
    }

    @Override
    protected void updateWidgetNarration(NarrationElementOutput output) {}
}
