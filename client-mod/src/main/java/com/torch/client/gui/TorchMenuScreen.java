package com.torch.client.gui;

import com.torch.client.TorchClientMod;
import com.torch.client.config.TorchConfig;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.text.Text;
import net.minecraft.util.Identifier;

import java.awt.*;

public class TorchMenuScreen extends Screen {
  private static final Identifier CLOSE_ICON = Identifier.of("torch-client", "textures/gui/close.png");
  private final Screen parent;
  private int scrollOffset = 0;
  private static final int ENTRY_HEIGHT = 44;
  private static final int TOGGLE_W = 40;
  private static final int TOGGLE_H = 22;
  private static final int MARGIN = 12;

  public TorchMenuScreen(Screen parent) {
    super(Text.translatable("gui.torchclient.title"));
    this.parent = parent;
  }

  @Override
  public void render(DrawContext ctx, int mouseX, int mouseY, float delta) {
    renderBackground(ctx, mouseX, mouseY, delta);
    super.render(ctx, mouseX, mouseY, delta);

    TorchConfig cfg = TorchClientMod.getConfig();
    String bgColor = cfg != null ? cfg.theme.backgroundColor : "#0a0a0a";
    String accentColor = cfg != null ? cfg.theme.accentColor : "#0088ff";
    String textColor = cfg != null ? cfg.theme.textColor : "#ffffff";
    String secColor = cfg != null ? cfg.theme.secondaryColor : "#888888";
    String borderColor = cfg != null ? cfg.theme.borderColor : "#2a2a2a";

    int w = width, h = height;
    int panelW = Math.min(420, w - 40);
    int panelH = Math.min(480, h - 40);
    int px = (w - panelW) / 2;
    int py = (h - panelH) / 2;

    fillPanel(ctx, px, py, panelW, panelH, parseColor(bgColor, 0.95f));

    drawBorder(ctx, px, py, panelW, panelH, parseColor(borderColor, 1f), 1);

    ctx.drawText(textRenderer, Text.of("Torch Client"), px + 16, py + 14, parseColor(textColor, 1f), true);

    int closeX = px + panelW - 14;
    int closeY = py + 10;
    String closeLabel = "\u2715";
    ctx.drawText(textRenderer, Text.of(closeLabel), closeX, closeY, parseColor(secColor, 1f), true);

    int contentY = py + 44;
    int contentX = px + 12;
    int contentW = panelW - 24;

    FeatureEntry[] features = getFeatures(cfg);
    int totalH = features.length * ENTRY_HEIGHT;
    int visibleH = panelH - 60;
    scrollOffset = Math.max(0, Math.min(scrollOffset, Math.max(0, totalH - visibleH)));

    ctx.enableScissor(contentX, contentY, contentX + contentW, contentY + visibleH);

    int drawY = contentY - scrollOffset;
    for (FeatureEntry fe : features) {
      if (drawY + ENTRY_HEIGHT < contentY || drawY > contentY + visibleH) {
        drawY += ENTRY_HEIGHT;
        continue;
      }

      int rowBg = parseColor(bgColor, 0.6f);
      ctx.fill(contentX, drawY, contentX + contentW, drawY + ENTRY_HEIGHT - 2, rowBg);

      boolean on = fe.enabled;
      int toggleLeft = contentX + contentW - TOGGLE_W;
      int toggleTop = drawY + (ENTRY_HEIGHT - 2 - TOGGLE_H) / 2;
      int toggleColor = on ? parseColor(accentColor, 1f) : 0xFF444444;
      int knobLeft = on ? toggleLeft + TOGGLE_W - 20 : toggleLeft + 3;

      ctx.fill(toggleLeft, toggleTop, toggleLeft + TOGGLE_W, toggleTop + TOGGLE_H, toggleColor);
      ctx.fill(knobLeft, toggleTop + 3, knobLeft + 17, toggleTop + TOGGLE_H - 3, on ? 0xFFFFFFFF : 0xFF888888);

      ctx.drawText(textRenderer, Text.of(fe.name), contentX + 10, drawY + 6, parseColor(textColor, 1f), true);
      ctx.drawText(textRenderer, Text.of(fe.description), contentX + 10, drawY + 22, parseColor(secColor, 1f), true);

      drawY += ENTRY_HEIGHT;
    }

    ctx.disableScissor();

    if (totalH > visibleH) {
      int scrollBarH = Math.max(20, (int)(visibleH * (float)visibleH / totalH));
      int scrollBarY = contentY + (int)((float)scrollOffset / (totalH - visibleH) * (visibleH - scrollBarH));
      ctx.fill(contentX + contentW - 4, contentY, contentX + contentW, contentY + visibleH, 0x22333333);
      ctx.fill(contentX + contentW - 4, scrollBarY, contentX + contentW, scrollBarY + scrollBarH, 0x44888888);
    }
  }

  @Override
  public boolean mouseClicked(double mx, double my, int button) {
    if (button == 0) {
      TorchConfig cfg = TorchClientMod.getConfig();
      int w = width, h = height;
      int panelW = Math.min(420, w - 40);
      int panelH = Math.min(480, h - 40);
      int px = (w - panelW) / 2;
      int py = (h - panelH) / 2;

      int closeX = px + panelW - 14;
      int closeY = py + 10;
      if (mx >= closeX - 10 && mx <= closeX + 30 && my >= closeY - 5 && my <= closeY + 20) {
        close();
        return true;
      }

      int contentY = py + 44;
      int contentX = px + 12;
      int contentW = panelW - 24;

      FeatureEntry[] features = getFeatures(cfg);
      for (int i = 0; i < features.length; i++) {
        int feY = contentY + i * ENTRY_HEIGHT - scrollOffset;
        if (my >= feY && my < feY + ENTRY_HEIGHT) {
          int toggleLeft = contentX + contentW - TOGGLE_W;
          int toggleTop = feY + (ENTRY_HEIGHT - 2 - TOGGLE_H) / 2;
          if (mx >= toggleLeft && mx <= toggleLeft + TOGGLE_W && my >= toggleTop && my <= toggleTop + TOGGLE_H) {
            features[i].enabled = !features[i].enabled;
            setFeature(cfg, i, features[i].enabled);
            cfg.save();
            return true;
          }
        }
      }
    }
    return super.mouseClicked(mx, my, button);
  }

  @Override
  public boolean mouseScrolled(double mx, double my, double horizontal, double vertical) {
    int w = width, h = height;
    int panelW = Math.min(420, w - 40);
    int panelH = Math.min(480, h - 40);
    int px = (w - panelW) / 2;
    int py = (h - panelH) / 2;

    int contentY = py + 44;
    int visibleH = panelH - 60;
    FeatureEntry[] features = getFeatures(TorchClientMod.getConfig());
    int totalH = features.length * ENTRY_HEIGHT;

    scrollOffset = (int) Math.max(0, Math.min(scrollOffset - vertical * 20, Math.max(0, totalH - visibleH)));
    return true;
  }

  public void close() {
    client.setScreen(parent);
  }

  private void fillPanel(DrawContext ctx, int x, int y, int w, int h, int color) {
    ctx.fill(x, y, x + w, y + h, color);
  }

  private void drawBorder(DrawContext ctx, int x, int y, int w, int h, int color, int thickness) {
    ctx.fill(x, y, x + w, y + thickness, color);
    ctx.fill(x, y + h - thickness, x + w, y + h, color);
    ctx.fill(x, y, x + thickness, y + h, color);
    ctx.fill(x + w - thickness, y, x + w, y + h, color);
  }

  private int parseColor(String hex, float alpha) {
    try {
      hex = hex.replace("#", "");
      int r = Integer.parseInt(hex.substring(0, 2), 16);
      int g = Integer.parseInt(hex.substring(2, 4), 16);
      int b = Integer.parseInt(hex.substring(4, 6), 16);
      int a = Math.min(255, Math.max(0, (int)(alpha * 255)));
      return (a << 24) | (r << 16) | (g << 8) | b;
    } catch (Exception e) {
      return 0xCC0a0a0a;
    }
  }

  private FeatureEntry[] getFeatures(TorchConfig cfg) {
    if (cfg == null || cfg.features == null) return new FeatureEntry[0];
    return new FeatureEntry[] {
      new FeatureEntry("Zoom", "Smooth zoom with C key", cfg.features.zoom),
      new FeatureEntry("Fullbright", "Night vision brightness boost", cfg.features.fullbright),
      new FeatureEntry("Better Tooltips", "Enhanced item durability & container tooltips", cfg.features.betterTooltips),
      new FeatureEntry("Colored Hitboxes", "Entity hitboxes with team colors", cfg.features.hitboxColors),
      new FeatureEntry("Motion Blur", "Camera motion blur effect", cfg.features.motionBlur),
    };
  }

  private void setFeature(TorchConfig cfg, int index, boolean value) {
    if (cfg == null || cfg.features == null) return;
    switch (index) {
      case 0: cfg.features.zoom = value; break;
      case 1: cfg.features.fullbright = value; break;
      case 2: cfg.features.betterTooltips = value; break;
      case 3: cfg.features.hitboxColors = value; break;
      case 4: cfg.features.motionBlur = value; break;
    }
  }

  private static class FeatureEntry {
    final String name, description;
    boolean enabled;
    FeatureEntry(String name, String description, boolean enabled) {
      this.name = name;
      this.description = description;
      this.enabled = enabled;
    }
  }
}
