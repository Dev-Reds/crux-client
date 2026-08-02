package com.torch.client.features;

import com.torch.client.TorchClientMod;
import com.torch.client.config.TorchConfig;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;

public class FullbrightFeature {
  private static double originalGamma = -1;
  private static boolean wasEnabled = false;

  public static void register() {
    ClientTickEvents.END_CLIENT_TICK.register(client -> {
      TorchConfig cfg = TorchClientMod.getConfig();
      if (cfg == null) return;
      boolean enabled = cfg.features.fullbright;
      if (enabled && !wasEnabled) {
        originalGamma = client.options.getGamma().getValue();
        client.options.getGamma().setValue(100.0);
      } else if (!enabled && wasEnabled) {
        if (originalGamma >= 0) {
          client.options.getGamma().setValue(originalGamma);
          originalGamma = -1;
        }
      }
      wasEnabled = enabled;
    });
  }
}
