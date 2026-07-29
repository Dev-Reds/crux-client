package com.crux.client.gui.widget;

import java.util.function.Supplier;

public record ScrollEntry(
        Supplier<String> text,
        int color,
        Supplier<String> indicator,
        int indicatorColor,
        Runnable onClick,
        Runnable onRightClick
) {
    public ScrollEntry(String text, int color, String indicator, int indicatorColor, Runnable onClick, Runnable onRightClick) {
        this(() -> text, color, () -> indicator, indicatorColor, onClick, onRightClick);
    }

    public ScrollEntry(String text, int color, Supplier<String> indicator, int indicatorColor, Runnable onClick, Runnable onRightClick) {
        this(() -> text, color, indicator, indicatorColor, onClick, onRightClick);
    }

    public ScrollEntry(String text, int color, String indicator, int indicatorColor, Runnable onClick) {
        this(() -> text, color, () -> indicator, indicatorColor, onClick, null);
    }

    public ScrollEntry(String text, int color, Runnable onClick, Runnable onRightClick) {
        this(() -> text, color, () -> null, 0, onClick, onRightClick);
    }
}
