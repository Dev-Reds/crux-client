package com.torch.client;

import com.torch.client.config.TorchConfig;
import com.torch.client.features.BetterTooltipsFeature;
import com.torch.client.features.FullbrightFeature;
import com.torch.client.features.HitboxColorsFeature;
import com.torch.client.features.MotionBlurFeature;
import com.torch.client.features.ZoomFeature;
import com.torch.client.gui.TorchMenuScreen;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.util.InputUtil;
import org.lwjgl.glfw.GLFW;

public class TorchClientMod implements ClientModInitializer {
  private static TorchConfig config;

  public static TorchConfig getConfig() {
    return config;
  }

  @Override
  public void onInitializeClient() {
    config = TorchConfig.load();

    KeyBinding menuKey = KeyBindingHelper.registerKeyBinding(new KeyBinding(
      "key.torchclient.menu",
      InputUtil.Type.KEYSYM,
      GLFW.GLFW_KEY_RIGHT_SHIFT,
      "key.torchclient.category"
    ));

    ClientTickEvents.END_CLIENT_TICK.register(client -> {
      if (menuKey.wasPressed()) {
        MinecraftClient.getInstance().setScreen(new TorchMenuScreen(null));
      }
    });

    ZoomFeature.register();
    FullbrightFeature.register();
    BetterTooltipsFeature.register();
    HitboxColorsFeature.register();
    MotionBlurFeature.register();
  }
}
