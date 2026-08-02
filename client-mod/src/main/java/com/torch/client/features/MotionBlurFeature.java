package com.torch.client.features;

import com.torch.client.TorchClientMod;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.minecraft.client.MinecraftClient;
import net.minecraft.util.Identifier;

import java.lang.reflect.Method;

public class MotionBlurFeature {
  private static final Identifier MOTION_BLUR_ID = Identifier.of("torchclient", "shaders/post/motion_blur");
  private static double prevYaw, prevPitch;
  private static double prevX, prevY, prevZ;
  private static long lastToggle = 0;
  private static boolean loaded = false;
  private static int stillTicks = 0;
  private static final int STILL_THRESHOLD = 10;
  private static final long TOGGLE_COOLDOWN = 300;
  private static Method loadPostProcessor;

  public static void register() {
    try {
      loadPostProcessor = net.minecraft.client.render.GameRenderer.class
        .getDeclaredMethod("loadPostProcessor", Identifier.class);
      loadPostProcessor.setAccessible(true);
    } catch (Exception e) {
      e.printStackTrace();
      return;
    }

    ClientTickEvents.END_CLIENT_TICK.register(client -> {
      if (TorchClientMod.getConfig() == null) return;
      boolean enabled = TorchClientMod.getConfig().features.motionBlur;
      if (client.player == null || client.world == null) return;

      double yaw = client.player.getYaw();
      double pitch = client.player.getPitch();
      double dx = client.player.getX() - prevX;
      double dy = client.player.getY() - prevY;
      double dz = client.player.getZ() - prevZ;
      double dyaw = yaw - prevYaw;
      double dpitch = pitch - prevPitch;

      prevYaw = yaw;
      prevPitch = pitch;
      prevX = client.player.getX();
      prevY = client.player.getY();
      prevZ = client.player.getZ();

      if (!enabled) {
        if (loaded) {
          client.gameRenderer.disablePostProcessor();
          loaded = false;
        }
        return;
      }

      double movement = Math.sqrt(dx * dx + dy * dy + dz * dz) + Math.abs(dyaw) * 0.1 + Math.abs(dpitch) * 0.1;
      long now = System.currentTimeMillis();

      if (movement > 0.3 && !loaded && now - lastToggle > TOGGLE_COOLDOWN) {
        try {
          loadPostProcessor.invoke(client.gameRenderer, MOTION_BLUR_ID);
          loaded = true;
          stillTicks = 0;
          lastToggle = now;
        } catch (Exception e) {
          e.printStackTrace();
        }
      } else if (movement < 0.05 && loaded) {
        stillTicks++;
        if (stillTicks > STILL_THRESHOLD && now - lastToggle > TOGGLE_COOLDOWN) {
          client.gameRenderer.disablePostProcessor();
          loaded = false;
          stillTicks = 0;
          lastToggle = now;
        }
      } else if (movement >= 0.05) {
        stillTicks = 0;
      }
    });
  }
}
