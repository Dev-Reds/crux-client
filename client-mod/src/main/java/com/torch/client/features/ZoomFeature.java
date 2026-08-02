package com.torch.client.features;

import com.torch.client.TorchClientMod;
import com.torch.client.config.TorchConfig;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.util.InputUtil;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import org.lwjgl.glfw.GLFW;

public class ZoomFeature {
  private static final KeyBinding zoomKey = KeyBindingHelper.registerKeyBinding(new KeyBinding(
    "key.torchclient.zoom", InputUtil.Type.KEYSYM, GLFW.GLFW_KEY_C, "key.torchclient.category"
  ));
  private static boolean wasPressed = false;
  private static double currentFov = -1;
  private static final double ZOOM_FOV = 30.0;
  private static final double ZOOM_SPEED = 0.5;

  public static void register() {
    ClientTickEvents.END_CLIENT_TICK.register(client -> {
      TorchConfig cfg = TorchClientMod.getConfig();
      if (cfg == null || !cfg.features.zoom) {
        if (currentFov > 0) {
          client.options.getFov().setValue((int) currentFov);
          currentFov = -1;
        }
        return;
      }

      boolean pressed = zoomKey.isPressed();
      if (pressed && !wasPressed) {
        currentFov = client.options.getFov().getValue();
      }
      if (pressed) {
        if (currentFov > 0) {
          double newFov = Math.max(ZOOM_FOV, currentFov * (1.0 - ZOOM_SPEED));
          client.options.getFov().setValue((int) newFov);
        }
      } else if (wasPressed) {
        if (currentFov > 0) {
          client.options.getFov().setValue((int) currentFov);
          currentFov = -1;
        }
      }
      wasPressed = pressed;
    });
  }
}
