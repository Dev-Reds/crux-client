package com.example.clientmod.hud;

import com.example.clientmod.config.ModConfig;
import net.fabricmc.api.EnvType;
import net.fabricmc.api.Environment;
import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawableHelper;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.text.LiteralText;

@Environment(EnvType.CLIENT)
public class HudRenderer {
    private static long lastFrameTime = -1;
    private static int fps = 0;

    public static void init() {
        HudRenderCallback.EVENT.register(HudRenderer::onHudRender);
    }

    private static void onHudRender(MatrixStack matrices, float tickDelta) {
        MinecraftClient mc = MinecraftClient.getInstance();
        if (mc == null || mc.player == null) return;

        // FPS calc
        long now = System.nanoTime();
        if (lastFrameTime > 0) {
            long diff = now - lastFrameTime;
            if (diff > 0) fps = (int) Math.round(1_000_000_000.0 / diff);
        }
        lastFrameTime = now;

        int x = 5;
        int y = 5;

        if (ModConfig.showFps) {
            DrawableHelper.drawTextWithShadow(matrices, mc.textRenderer, new LiteralText("FPS: " + fps), x, y, 0xFFFFFF);
            y += 10 + mc.textRenderer.fontHeight;
        }

        if (ModConfig.showCoords) {
            PlayerEntity p = mc.player;
            String coords = String.format("XYZ: %.1f, %.1f, %.1f", p.getX(), p.getY(), p.getZ());
            DrawableHelper.drawTextWithShadow(matrices, mc.textRenderer, new LiteralText(coords), x, y, 0xFFFFFF);
        }
    }
}
